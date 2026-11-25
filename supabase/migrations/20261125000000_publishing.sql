-- Visus Publish — Fase 1: tokens no Vault, fila de publicação com retentativa e lock

create extension if not exists supabase_vault with schema vault;

-- ============ Tokens da Meta no Vault ============
-- Só o service_role (servidor/jobs) grava e lê. O app nunca devolve o token ao client.
create or replace function store_ig_token(p_account uuid, p_token text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_secret uuid; v_tenant uuid;
begin
  select token_secret_id, tenant_id into v_secret, v_tenant from ig_accounts where id = p_account for update;
  if v_tenant is null then raise exception 'conta não encontrada'; end if;

  if v_secret is null then
    v_secret := vault.create_secret(p_token, 'ig_token_' || p_account::text, 'Token do Instagram');
  else
    perform vault.update_secret(v_secret, p_token);
  end if;

  update ig_accounts
     set token_secret_id = v_secret, token_expires_at = p_expires_at, status = 'connected'
   where id = p_account;
end $$;

create or replace function read_ig_token(p_account uuid)
returns text language sql stable security definer set search_path = public, vault as $$
  select s.decrypted_secret
  from ig_accounts a join vault.decrypted_secrets s on s.id = a.token_secret_id
  where a.id = p_account;
$$;

create or replace function delete_ig_token(p_account uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_secret uuid;
begin
  select token_secret_id into v_secret from ig_accounts where id = p_account for update;
  update ig_accounts set token_secret_id = null, token_expires_at = null, status = 'disconnected' where id = p_account;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
end $$;

revoke all on function store_ig_token(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function read_ig_token(uuid) from public, anon, authenticated;
revoke all on function delete_ig_token(uuid) from public, anon, authenticated;
grant execute on function store_ig_token(uuid, text, timestamptz) to service_role;
grant execute on function read_ig_token(uuid) to service_role;
grant execute on function delete_ig_token(uuid) to service_role;

-- Admin do tenant não muda tenant, ig_user_id, token nem status pela API; só require_approval e color.
create or replace function guard_ig_account_columns() returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'contas são conectadas pelo login da Meta' using errcode = '42501';
  end if;
  if new.ig_user_id is distinct from old.ig_user_id
     or new.token_secret_id is distinct from old.token_secret_id
     or new.token_expires_at is distinct from old.token_expires_at
     or new.status is distinct from old.status
     or new.username is distinct from old.username then
    raise exception 'só require_approval e cor podem ser alterados aqui' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger ig_accounts_guard before insert or update on ig_accounts
  for each row execute function guard_ig_account_columns();

-- ============ Fila de publicação ============
alter table posts add column next_attempt_at timestamptz;
alter table posts add column publishing_started_at timestamptz;

create index posts_due_idx on posts (coalesce(next_attempt_at, scheduled_at)) where status = 'scheduled';

-- Substitui a versão do init: respeita next_attempt_at, só contas conectadas e tenants ativos,
-- e marca quando começou (para detectar publicação travada).
create or replace function claim_due_posts(p_limit int default 20)
returns setof posts language sql security definer set search_path = public as $$
  update posts p
     set status = 'publishing', attempts = p.attempts + 1, publishing_started_at = now()
   where p.id in (
     select po.id from posts po
       join ig_accounts a on a.id = po.ig_account_id and a.tenant_id = po.tenant_id
       join tenants t on t.id = po.tenant_id
      where po.status = 'scheduled'
        and coalesce(po.next_attempt_at, po.scheduled_at) <= now()
        and a.status = 'connected'
        and t.status = 'active'
      order by coalesce(po.next_attempt_at, po.scheduled_at)
      limit p_limit
      for update of po skip locked
   )
  returning p.*;
$$;
revoke all on function claim_due_posts(int) from public, anon, authenticated;
grant execute on function claim_due_posts(int) to service_role;

-- Resultado da tentativa, gravado pelo job. Sempre registra post_events.
-- p_outcome: 'published' | 'retry' | 'failed' | 'deferred' (limite da Meta; não conta tentativa)
create or replace function finish_publish(
  p_post uuid,
  p_outcome text,
  p_error text default null,
  p_retry_at timestamptz default null,
  p_ig_media_id text default null,
  p_permalink text default null
) returns post_status language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_from post_status; v_to post_status;
begin
  select tenant_id, status into v_tenant, v_from from posts where id = p_post for update;
  if v_from is distinct from 'publishing' then
    raise exception 'post não está publicando (status %)', v_from;
  end if;

  if p_outcome = 'published' then
    v_to := 'published';
    update posts set status = v_to, ig_media_id = p_ig_media_id, permalink = p_permalink,
      published_at = now(), last_error = null, next_attempt_at = null where id = p_post;
  elsif p_outcome in ('retry', 'deferred') then
    v_to := 'scheduled';
    update posts set status = v_to, last_error = p_error, next_attempt_at = p_retry_at,
      attempts = case when p_outcome = 'deferred' then greatest(attempts - 1, 0) else attempts end
    where id = p_post;
  elsif p_outcome = 'failed' then
    v_to := 'failed';
    update posts set status = v_to, last_error = p_error, next_attempt_at = null where id = p_post;
  else
    raise exception 'resultado inválido: %', p_outcome;
  end if;

  insert into post_events (tenant_id, post_id, from_status, to_status, actor, note)
  values (v_tenant, p_post, v_from, v_to, null, coalesce(p_error, p_outcome));
  return v_to;
end $$;
revoke all on function finish_publish(uuid, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function finish_publish(uuid, text, text, timestamptz, text, text) to service_role;

-- Guarda o container antes do media_publish (CLAUDE.md regra 5)
create or replace function set_ig_container(p_post uuid, p_container text)
returns void language sql security definer set search_path = public as $$
  update posts set ig_container_id = p_container where id = p_post and status = 'publishing';
$$;
revoke all on function set_ig_container(uuid, text) from public, anon, authenticated;
grant execute on function set_ig_container(uuid, text) to service_role;

-- Publicação travada (worker caiu no meio). Não tentamos de novo sozinhos, porque o
-- media_publish pode ter saído: vai para failed com aviso para conferir no Instagram.
create or replace function release_stuck_publishing(p_older_than interval default interval '15 minutes')
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select id, tenant_id from posts
     where status = 'publishing' and publishing_started_at < now() - p_older_than
     for update skip locked
  loop
    update posts set status = 'failed',
      last_error = 'Publicação interrompida. Confira no Instagram se o post saiu antes de tentar de novo.'
    where id = r.id;
    insert into post_events (tenant_id, post_id, from_status, to_status, note)
    values (r.tenant_id, r.id, 'publishing', 'failed', 'interrompida');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function release_stuck_publishing(interval) from public, anon, authenticated;
grant execute on function release_stuck_publishing(interval) to service_role;

-- ============ Transições de pessoa (atualiza a da Fase 0) ============
-- Acrescenta: aprovar/reprovar continua em review_post; "tentar de novo" limpa erro e tentativas.
create or replace function transition_post(p_post uuid, p_to post_status, p_note text default null)
returns post_status language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_from post_status; v_require_approval boolean; v_media int;
begin
  select p.tenant_id, p.status, a.require_approval
    into v_tenant, v_from, v_require_approval
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
    p_to := case when v_require_approval then 'pending_approval' else 'scheduled' end;
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

-- Editar legenda ou horário de um post agendado numa conta com aprovação volta para aprovação (SPEC §6).
-- Editar o horário sozinho não exige nova aprovação.
-- security definer para gravar post_events; por isso olha o papel do JWT (auth.role()), não current_user.
create or replace function reapprove_on_edit() returns trigger language plpgsql security definer set search_path = public as $$
declare v_require boolean;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if old.status = 'scheduled' and new.caption is distinct from old.caption then
    select require_approval into v_require from ig_accounts where id = new.ig_account_id;
    if v_require then
      new.status := 'pending_approval';
      new.approved_by := null;
      new.approved_at := null;
      insert into post_events (tenant_id, post_id, from_status, to_status, actor, note)
      values (new.tenant_id, new.id, 'scheduled', 'pending_approval', auth.uid(), 'legenda editada');
    end if;
  end if;
  return new;
end $$;

-- Roda depois da trava (ordem alfabética dos triggers: posts_guard < posts_reapprove)
create trigger posts_reapprove before update on posts
  for each row execute function reapprove_on_edit();

-- Mídia de post agendado/publicado não muda pela API
create or replace function guard_post_media() returns trigger language plpgsql as $$
declare v_status post_status;
begin
  if current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;
  select status into v_status from posts where id = coalesce(new.post_id, old.post_id);
  if v_status not in ('planned', 'rejected', 'generation_failed', 'failed') then
    raise exception 'mídia só muda enquanto o post não está agendado' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create trigger post_media_guard before insert or update or delete on post_media
  for each row execute function guard_post_media();

-- ============ FKs simples redundantes ============
-- As FKs compostas (id, tenant_id) da Fase 0 já garantem a referência. As simples
-- do init ficam redundantes e confundem os joins do PostgREST (duas relações).
alter table posts drop constraint posts_ig_account_id_fkey;
alter table brand_profiles drop constraint brand_profiles_ig_account_id_fkey;
alter table post_media drop constraint post_media_post_id_fkey;
alter table post_events drop constraint post_events_post_id_fkey;
alter table generation_jobs drop constraint generation_jobs_post_id_fkey;
alter table media_insights drop constraint media_insights_post_id_fkey;
alter table account_insights_daily drop constraint account_insights_daily_ig_account_id_fkey;
alter table audience_snapshots drop constraint audience_snapshots_ig_account_id_fkey;
alter table analysis_findings drop constraint analysis_findings_ig_account_id_fkey;
