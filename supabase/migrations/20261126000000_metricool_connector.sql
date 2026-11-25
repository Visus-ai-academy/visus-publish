-- Visus Publish — Metricool pelo conector (MCP + OAuth), que funciona no plano Free
--
-- A conexão do Metricool de um cliente agora tem dois modos:
--   api_token: userId + token da API REST (planos Advanced/Custom)
--   oauth:     login do Metricool no servidor MCP (ai.metricool.com), qualquer plano
-- Tokens e o client_secret do OAuth ficam no Vault. Só o service_role lê.

alter table metricool_connections
  alter column metricool_user_id drop not null,
  add column auth_mode text not null default 'api_token' check (auth_mode in ('api_token', 'oauth')),
  add column oauth_client_id text,
  add column oauth_client_secret_id uuid,          -- Vault (quando o registro devolve segredo)
  add column refresh_secret_id uuid,               -- Vault
  add column access_expires_at timestamptz,
  add column mcp_tools jsonb;                      -- nomes e esquemas das ferramentas, para diagnóstico

alter table metricool_connections
  add constraint metricool_connections_mode_fields
  check ((auth_mode = 'api_token' and metricool_user_id is not null)
      or (auth_mode = 'oauth' and oauth_client_id is not null));

-- Apaga um segredo do Vault se existir
create or replace function _drop_secret(p_id uuid) returns void language sql security definer set search_path = public, vault as $$
  delete from vault.secrets where id = p_id;
$$;
revoke all on function _drop_secret(uuid) from public, anon, authenticated;

-- Guarda (ou atualiza) um segredo do Vault e devolve o id
create or replace function _put_secret(p_id uuid, p_value text, p_name text) returns uuid
language plpgsql security definer set search_path = public, vault as $$
begin
  if p_value is null then
    if p_id is not null then perform _drop_secret(p_id); end if;
    return null;
  end if;
  if p_id is null then
    return vault.create_secret(p_value, p_name || '_' || gen_random_uuid()::text);
  end if;
  perform vault.update_secret(p_id, p_value);
  return p_id;
end $$;
revoke all on function _put_secret(uuid, text, text) from public, anon, authenticated;

-- Modo token da API (substitui a versão anterior; limpa o que for do OAuth)
create or replace function store_metricool_token(p_tenant uuid, p_user_id text, p_token text, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public, vault as $$
declare c metricool_connections;
begin
  select * into c from metricool_connections where tenant_id = p_tenant for update;
  insert into metricool_connections (tenant_id, metricool_user_id, auth_mode, token_secret_id, connected_by)
  values (p_tenant, p_user_id, 'api_token', _put_secret(c.token_secret_id, p_token, 'metricool_token'), p_actor)
  on conflict (tenant_id) do update
    set metricool_user_id = excluded.metricool_user_id, auth_mode = 'api_token',
        token_secret_id = excluded.token_secret_id, connected_by = excluded.connected_by,
        oauth_client_id = null, access_expires_at = null, mcp_tools = null, updated_at = now();
  perform _put_secret(c.refresh_secret_id, null, '');
  perform _put_secret(c.oauth_client_secret_id, null, '');
  update metricool_connections set refresh_secret_id = null, oauth_client_secret_id = null where tenant_id = p_tenant;
end $$;

-- Modo OAuth: grava cliente registrado e tokens. p_refresh nulo mantém o refresh atual.
create or replace function store_metricool_oauth(
  p_tenant uuid, p_client_id text, p_access text, p_client_secret text default null,
  p_refresh text default null, p_expires_at timestamptz default null, p_actor uuid default null
) returns void language plpgsql security definer set search_path = public, vault as $$
declare c metricool_connections; v_access uuid; v_refresh uuid; v_client uuid;
begin
  select * into c from metricool_connections where tenant_id = p_tenant for update;
  if c.auth_mode = 'api_token' then
    -- trocando de modo: o token da API sai
    perform _put_secret(c.token_secret_id, null, '');
    c.token_secret_id := null;
  end if;
  v_access := _put_secret(c.token_secret_id, p_access, 'metricool_access');
  v_refresh := case when p_refresh is null then c.refresh_secret_id
                    else _put_secret(c.refresh_secret_id, p_refresh, 'metricool_refresh') end;
  v_client := case when p_client_secret is null and p_client_id is not distinct from c.oauth_client_id then c.oauth_client_secret_id
                   else _put_secret(c.oauth_client_secret_id, p_client_secret, 'metricool_client_secret') end;
  insert into metricool_connections (tenant_id, auth_mode, oauth_client_id, oauth_client_secret_id,
                                     token_secret_id, refresh_secret_id, access_expires_at, connected_by)
  values (p_tenant, 'oauth', p_client_id, v_client, v_access, v_refresh, p_expires_at, p_actor)
  on conflict (tenant_id) do update
    set auth_mode = 'oauth', metricool_user_id = null, oauth_client_id = excluded.oauth_client_id,
        oauth_client_secret_id = excluded.oauth_client_secret_id, token_secret_id = excluded.token_secret_id,
        refresh_secret_id = excluded.refresh_secret_id, access_expires_at = excluded.access_expires_at,
        connected_by = coalesce(excluded.connected_by, metricool_connections.connected_by), updated_at = now();
end $$;

-- Credenciais para o servidor (troca o retorno da versão anterior)
drop function read_metricool_credentials(uuid);
create function read_metricool_credentials(p_tenant uuid)
returns table (auth_mode text, user_id text, token text, refresh_token text, client_id text, client_secret text, expires_at timestamptz)
language sql stable security definer set search_path = public, vault as $$
  select c.auth_mode, c.metricool_user_id,
         (select decrypted_secret from vault.decrypted_secrets where id = c.token_secret_id),
         (select decrypted_secret from vault.decrypted_secrets where id = c.refresh_secret_id),
         c.oauth_client_id,
         (select decrypted_secret from vault.decrypted_secrets where id = c.oauth_client_secret_id),
         c.access_expires_at
  from metricool_connections c
  where c.tenant_id = p_tenant;
$$;

create or replace function set_metricool_tools(p_tenant uuid, p_tools jsonb) returns void
language sql security definer set search_path = public as $$
  update metricool_connections set mcp_tools = p_tools, updated_at = now() where tenant_id = p_tenant;
$$;

create or replace function delete_metricool_connection(p_tenant uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare c metricool_connections;
begin
  select * into c from metricool_connections where tenant_id = p_tenant for update;
  delete from metricool_connections where tenant_id = p_tenant;
  delete from vault.secrets where id in (c.token_secret_id, c.refresh_secret_id, c.oauth_client_secret_id);
  update ig_accounts set status = 'disconnected' where tenant_id = p_tenant and publish_via = 'metricool';
end $$;

revoke all on function store_metricool_oauth(uuid, text, text, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function read_metricool_credentials(uuid) from public, anon, authenticated;
revoke all on function set_metricool_tools(uuid, jsonb) from public, anon, authenticated;
grant execute on function store_metricool_oauth(uuid, text, text, text, text, timestamptz, uuid) to service_role;
grant execute on function read_metricool_credentials(uuid) to service_role;
grant execute on function set_metricool_tools(uuid, jsonb) to service_role;
