-- Visus Publish — Metricool como provedor de publicação (enquanto o app da Meta não é liberado)
--
-- Cada conta escolhe por onde publica (publish_via). Contas do Metricool apontam para uma
-- marca (blogId) e o token do Metricool fica no Vault, por cliente. Quando a Meta liberar,
-- a mesma conta passa a publicar direto pela Meta sem perder posts nem histórico.

create type publish_provider as enum ('meta', 'metricool');

alter table ig_accounts
  add column publish_via publish_provider not null default 'meta',
  add column metricool_blog_id text unique;          -- a mesma marca não fica em dois clientes

alter table ig_accounts
  add constraint ig_accounts_metricool_needs_blog
  check (publish_via <> 'metricool' or metricool_blog_id is not null);

alter table posts
  add column publish_provider publish_provider,      -- por onde a tentativa atual saiu
  add column external_post_id text,                  -- id do post no Metricool
  add column last_checked_at timestamptz;

-- ============ Conexão com o Metricool (uma por cliente) ============
create table metricool_connections (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  metricool_user_id text not null,
  token_secret_id uuid,                              -- Supabase Vault
  connected_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table metricool_connections enable row level security;
-- Admin do cliente vê que existe (sem o token, que está no Vault). Escrita só pelo servidor.
create policy mc_read on metricool_connections for select
  using (has_tenant_role(tenant_id, array['admin']::member_role[]));

create or replace function store_metricool_token(p_tenant uuid, p_user_id text, p_token text, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_secret uuid;
begin
  select token_secret_id into v_secret from metricool_connections where tenant_id = p_tenant for update;
  if v_secret is null then
    v_secret := vault.create_secret(p_token, 'metricool_token_' || p_tenant::text, 'Token do Metricool');
  else
    perform vault.update_secret(v_secret, p_token);
  end if;
  insert into metricool_connections (tenant_id, metricool_user_id, token_secret_id, connected_by)
  values (p_tenant, p_user_id, v_secret, p_actor)
  on conflict (tenant_id) do update
    set metricool_user_id = excluded.metricool_user_id, token_secret_id = excluded.token_secret_id,
        connected_by = excluded.connected_by, updated_at = now();
end $$;

create or replace function read_metricool_credentials(p_tenant uuid)
returns table (user_id text, token text) language sql stable security definer set search_path = public, vault as $$
  select c.metricool_user_id, s.decrypted_secret
  from metricool_connections c join vault.decrypted_secrets s on s.id = c.token_secret_id
  where c.tenant_id = p_tenant;
$$;

create or replace function delete_metricool_connection(p_tenant uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_secret uuid;
begin
  select token_secret_id into v_secret from metricool_connections where tenant_id = p_tenant for update;
  delete from metricool_connections where tenant_id = p_tenant;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
  update ig_accounts set status = 'disconnected' where tenant_id = p_tenant and publish_via = 'metricool';
end $$;

revoke all on function store_metricool_token(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function read_metricool_credentials(uuid) from public, anon, authenticated;
revoke all on function delete_metricool_connection(uuid) from public, anon, authenticated;
grant execute on function store_metricool_token(uuid, text, text, uuid) to service_role;
grant execute on function read_metricool_credentials(uuid) to service_role;
grant execute on function delete_metricool_connection(uuid) to service_role;

-- ============ Trava de colunas da conta (atualiza a da Fase 1) ============
create or replace function guard_ig_account_columns() returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'contas são conectadas pelo login da Meta ou pelo Metricool' using errcode = '42501';
  end if;
  if new.ig_user_id is distinct from old.ig_user_id
     or new.token_secret_id is distinct from old.token_secret_id
     or new.token_expires_at is distinct from old.token_expires_at
     or new.status is distinct from old.status
     or new.username is distinct from old.username
     or new.publish_via is distinct from old.publish_via
     or new.metricool_blog_id is distinct from old.metricool_blog_id then
    raise exception 'só require_approval e cor podem ser alterados aqui' using errcode = '42501';
  end if;
  return new;
end $$;

-- ============ Fila: envio ao Metricool e confirmação ============
create or replace function set_external_post(p_post uuid, p_provider publish_provider, p_external_id text)
returns void language sql security definer set search_path = public as $$
  update posts set publish_provider = p_provider, external_post_id = p_external_id, last_checked_at = now()
  where id = p_post and status = 'publishing';
$$;
revoke all on function set_external_post(uuid, publish_provider, text) from public, anon, authenticated;
grant execute on function set_external_post(uuid, publish_provider, text) to service_role;

-- Posts já entregues ao Metricool esperando a confirmação. Lock para dois workers não checarem o mesmo.
create or replace function claim_awaiting_confirmation(p_limit int default 50, p_every interval default interval '1 minute')
returns setof posts language sql security definer set search_path = public as $$
  update posts p set last_checked_at = now()
   where p.id in (
     select id from posts
      where status = 'publishing' and publish_provider = 'metricool' and external_post_id is not null
        and (last_checked_at is null or last_checked_at < now() - p_every)
      order by last_checked_at nulls first
      limit p_limit
      for update skip locked
   )
  returning p.*;
$$;
revoke all on function claim_awaiting_confirmation(int, interval) from public, anon, authenticated;
grant execute on function claim_awaiting_confirmation(int, interval) to service_role;

-- Publicação travada: o Metricool publica no horário dele, então só desiste depois de 3 h
-- e manda conferir no Metricool. Posts da Meta mantêm os 15 min.
create or replace function release_stuck_publishing(p_older_than interval default interval '15 minutes')
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select id, tenant_id, publish_provider from posts
     where status = 'publishing'
       and publishing_started_at < now() - case
             when publish_provider = 'metricool' and external_post_id is not null then interval '3 hours'
             else p_older_than end
     for update skip locked
  loop
    update posts set status = 'failed',
      last_error = case when r.publish_provider = 'metricool'
        then 'O Metricool não confirmou a publicação. Confira no Metricool e no Instagram antes de tentar de novo.'
        else 'Publicação interrompida. Confira no Instagram se o post saiu antes de tentar de novo.' end
    where id = r.id;
    insert into post_events (tenant_id, post_id, from_status, to_status, note)
    values (r.tenant_id, r.id, 'publishing', 'failed', 'interrompida');
    n := n + 1;
  end loop;
  return n;
end $$;
