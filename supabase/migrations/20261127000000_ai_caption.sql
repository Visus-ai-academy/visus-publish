-- Fase 2 (parte 1): tema e legenda gerados por IA a partir do criativo enviado.
-- 1. Chaves de IA da plataforma (modo de cobrança 'platform') no Vault.
-- 2. Leitura da chave certa para o tenant (própria em 'own', da plataforma em 'platform').
-- 3. Alertas de publicidade médica no post: só o sistema grava, e forçam aprovação.
-- 4. Modelos iniciais em ai_models (editáveis pelo admin; o código não fixa nomes).

-- ============ 1. Chaves da plataforma ============
create table ai_platform_keys (
  provider text primary key check (provider in ('openai', 'gemini')),
  secret_id uuid not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table ai_platform_keys enable row level security;
-- O admin da plataforma vê quais provedores têm chave (nunca o segredo, que fica no Vault)
create policy aipk_read on ai_platform_keys for select using (is_platform_admin());

create or replace function store_platform_ai_key(p_provider text, p_key text, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select secret_id into v_id from ai_platform_keys where provider = p_provider for update;
  if p_key is null or length(trim(p_key)) = 0 then
    if v_id is not null then perform _drop_secret(v_id); end if;
    delete from ai_platform_keys where provider = p_provider;
    return;
  end if;
  v_id := _put_secret(v_id, trim(p_key), 'ai_platform_' || p_provider);
  insert into ai_platform_keys (provider, secret_id, updated_by) values (p_provider, v_id, p_actor)
  on conflict (provider) do update set secret_id = excluded.secret_id, updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke all on function store_platform_ai_key(text, text, uuid) from public, anon, authenticated;
grant execute on function store_platform_ai_key(text, text, uuid) to service_role;

-- ============ 2. Chave para um tenant ============
-- 'own' usa a credencial do tenant; 'platform' (padrão) usa a da Visus. Só service_role.
create or replace function read_ai_key(p_tenant uuid, p_provider text)
returns text language plpgsql security definer set search_path = public, vault as $$
declare v_mode billing_mode; v_secret uuid; v_key text;
begin
  select billing_mode into v_mode from ai_settings where tenant_id = p_tenant;
  if coalesce(v_mode, 'platform') = 'own' then
    select secret_id into v_secret from ai_credentials where tenant_id = p_tenant and provider = p_provider;
  else
    select secret_id into v_secret from ai_platform_keys where provider = p_provider;
  end if;
  if v_secret is null then return null; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where id = v_secret;
  return v_key;
end $$;
revoke all on function read_ai_key(uuid, text) from public, anon, authenticated;
grant execute on function read_ai_key(uuid, text) to service_role;

-- ============ 3. Alertas de publicidade médica ============
alter table posts add column compliance_flags text[] not null default '{}';

-- Quem usa a API (authenticated) não grava nem apaga alertas direto
create or replace function guard_post_flags() returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' and cardinality(new.compliance_flags) > 0 then
    raise exception 'alertas de conteúdo são do sistema' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.compliance_flags is distinct from old.compliance_flags then
    raise exception 'alertas de conteúdo são do sistema' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger posts_guard_flags before insert or update on posts
  for each row execute function guard_post_flags();

-- O servidor acrescenta alertas (nunca remove) enquanto o post não foi agendado
create or replace function add_post_flags(p_post uuid, p_flags text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_status post_status;
begin
  select tenant_id, status into v_tenant, v_status from posts where id = p_post for update;
  if v_tenant is null then raise exception 'post não encontrado' using errcode = 'P0002'; end if;
  if not has_tenant_role(v_tenant, array['admin','editor']::member_role[]) then
    raise exception 'sem permissão para alterar o post' using errcode = '42501';
  end if;
  if v_status not in ('planned', 'rejected') then
    raise exception 'alertas só entram antes do agendamento' using errcode = '22023';
  end if;
  update posts set compliance_flags = (
    select coalesce(array_agg(distinct f order by f), '{}') from unnest(compliance_flags || p_flags) f where length(trim(f)) > 0
  ) where id = p_post;
end $$;
revoke all on function add_post_flags(uuid, text[]) from public, anon;
grant execute on function add_post_flags(uuid, text[]) to authenticated, service_role;

-- Post com alerta vai para aprovação mesmo em conta "publica direto" (SPEC §5)
create or replace function transition_post(p_post uuid, p_to post_status, p_note text default null)
returns post_status language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_from post_status; v_require_approval boolean; v_media int; v_flags text[];
begin
  select p.tenant_id, p.status, a.require_approval, p.compliance_flags
    into v_tenant, v_from, v_require_approval, v_flags
  from posts p join ig_accounts a on a.id = p.ig_account_id and a.tenant_id = p.tenant_id
  where p.id = p_post
  for update of p;

  if v_tenant is null then raise exception 'post não encontrado' using errcode = 'P0002'; end if;
  if not has_tenant_role(v_tenant, array['admin','editor']::member_role[]) then
    raise exception 'sem permissão para alterar o post' using errcode = '42501';
  end if;

  if v_from = 'scheduled' and p_to = 'planned' then
    null;
  elsif v_from in ('planned', 'rejected') and p_to in ('pending_approval', 'scheduled') then
    select count(*) into v_media from post_media where post_id = p_post;
    if v_media = 0 then raise exception 'post sem mídia não pode ser agendado' using errcode = '22023'; end if;
    p_to := case when v_require_approval or cardinality(v_flags) > 0 then 'pending_approval' else 'scheduled' end;
  elsif v_from = 'failed' and p_to = 'scheduled' then
    update posts set attempts = 0, last_error = null, next_attempt_at = null where id = p_post;
  else
    raise exception 'transição % → % não permitida', v_from, p_to using errcode = '22023';
  end if;

  update posts set status = p_to where id = p_post;
  insert into post_events (tenant_id, post_id, from_status, to_status, actor, note)
  values (v_tenant, p_post, v_from, p_to, auth.uid(), p_note);
  return p_to;
end $$;

-- ============ 4. Modelos iniciais ============
insert into ai_models (id, provider, task, model, unit_cost_credits) values
  ('openai:caption', 'openai', 'caption', 'gpt-4.1-mini', 1),
  ('gemini:caption', 'gemini', 'caption', 'gemini-2.5-flash', 1)
on conflict (id) do nothing;
