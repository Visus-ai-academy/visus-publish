-- Fase 4: insights, mapa de calor e achados com ações.
-- 1. ig_media: cada mídia do Instagram da conta (feita pelo app ou não) com as métricas mais recentes.
--    Posts do app apontam para a mídia pelo ig_media_id; mídias antigas entram na análise também.
-- 2. Estado da coleta por conta (insights_checked_at, insights_error), gravado só pelo servidor.
-- 3. Por onde a conta publica (Meta ou Metricool) muda só por função, com a regra de cada provedor.
-- 4. apply_finding: aplica a ação de um achado ("mover horário", "trocar formato") nos posts
--    futuros ainda não publicados e grava em post_events.

-- ============ 1. Mídias do Instagram ============
create table ig_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ig_account_id uuid not null,
  ig_media_id text not null,
  post_id uuid,                               -- post do app que virou esta mídia (null = feita fora do app)
  media_type text,                            -- IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type text,                    -- FEED | REELS | STORY
  caption text,
  permalink text,
  posted_at timestamptz not null,
  views int, reach int, likes int, comments int, saved int, shares int,
  total_interactions int, profile_visits int, follows int,
  insights_at timestamptz,                    -- quando as métricas foram lidas pela última vez
  insights_error text,
  created_at timestamptz not null default now(),
  unique (ig_account_id, ig_media_id),
  unique (id, tenant_id),
  foreign key (ig_account_id, tenant_id) references ig_accounts (id, tenant_id) on delete cascade,
  foreign key (post_id, tenant_id) references posts (id, tenant_id) on delete set null (post_id)
);
create index on ig_media (tenant_id, ig_account_id, posted_at);
create unique index ig_media_post_key on ig_media (post_id) where post_id is not null;

alter table ig_media enable row level security;
create policy igm_read on ig_media for select using (has_tenant_role(tenant_id));
-- Escrita só pelo servidor (service_role), na coleta.

create trigger ig_media_tenant_immutable before update on ig_media
  for each row execute function forbid_tenant_change();

-- ============ 2. Estado da coleta por conta ============
alter table ig_accounts
  add column insights_checked_at timestamptz,
  add column insights_error text;

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
     or new.metricool_blog_id is distinct from old.metricool_blog_id
     or new.insights_checked_at is distinct from old.insights_checked_at
     or new.insights_error is distinct from old.insights_error then
    raise exception 'só require_approval e cor podem ser alterados aqui' using errcode = '42501';
  end if;
  return new;
end $$;

-- ============ 3. Por onde a conta publica ============
-- Admin do cliente escolhe. Meta exige o acesso da Meta ligado; Metricool exige a marca vinculada.
create or replace function set_publish_via(p_account uuid, p_via publish_provider)
returns void language plpgsql security definer set search_path = public as $$
declare a ig_accounts;
begin
  select * into a from ig_accounts where id = p_account for update;
  if not found or not has_tenant_role(a.tenant_id, array['admin']::member_role[]) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_via = 'meta' and (a.token_secret_id is null or a.ig_user_id like 'metricool:%') then
    raise exception 'conecte a conta pela Meta antes' using errcode = 'VP409';
  end if;
  if p_via = 'metricool' and a.metricool_blog_id is null then
    raise exception 'vincule a marca do Metricool antes' using errcode = 'VP409';
  end if;
  update ig_accounts set publish_via = p_via where id = p_account;
  insert into audit_log (tenant_id, actor, action, target)
  values (a.tenant_id, auth.uid(), 'ig_account.publish_via', '@' || a.username || ' → ' || p_via);
end $$;
revoke execute on function set_publish_via(uuid, publish_provider) from public, anon;
grant execute on function set_publish_via(uuid, publish_provider) to authenticated;

-- ============ 4. Achados da análise ============
alter table analysis_findings
  add column model text,
  add column position int not null default 0,      -- ordem dentro da análise (1 = mais importante)
  add column applied_count int;
create index on analysis_findings (tenant_id, ig_account_id, created_at);

-- Aplica a ação do achado nos posts futuros da conta que ainda não saíram.
--  reschedule    {from_hour, to_hour, to_minute?, weekdays?[0=dom..6=sáb]}: planned/scheduled no horário local from_hour
--  change_format {from, to}: só posts planned ainda sem mídia (a arte ainda não foi gerada)
-- Devolve quantos posts mudaram. Admin e editor (mesma regra de editar o plano).
create or replace function apply_finding(p_finding uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  f analysis_findings;
  tz text;
  kind text;
  n int := 0;
  r record;
  v_new timestamptz;
  v_from int; v_to int; v_min int; v_days int[];
  v_fmt_from post_format; v_fmt_to post_format;
begin
  select * into f from analysis_findings where id = p_finding for update;
  if not found or not has_tenant_role(f.tenant_id, array['admin', 'editor']::member_role[]) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if f.applied_at is not null then
    raise exception 'este achado já foi aplicado' using errcode = 'VP409';
  end if;
  if f.ig_account_id is null then
    raise exception 'achado sem conta' using errcode = 'VP409';
  end if;
  select timezone into tz from tenants where id = f.tenant_id;
  kind := f.action ->> 'type';

  if kind = 'reschedule' then
    v_from := (f.action -> 'params' ->> 'from_hour')::int;
    v_to := (f.action -> 'params' ->> 'to_hour')::int;
    v_min := coalesce((f.action -> 'params' ->> 'to_minute')::int, 0);
    if v_from is null or v_to is null or v_from not between 0 and 23 or v_to not between 0 and 23 or v_min not between 0 and 59 then
      raise exception 'ação inválida' using errcode = 'VP409';
    end if;
    select array_agg(x::int) into v_days from jsonb_array_elements_text(coalesce(f.action -> 'params' -> 'weekdays', '[]'::jsonb)) x;
    for r in
      select p.id, p.status, p.scheduled_at from posts p
       where p.tenant_id = f.tenant_id and p.ig_account_id = f.ig_account_id
         and p.status in ('planned', 'scheduled')
         and p.scheduled_at > now()
         and extract(hour from p.scheduled_at at time zone tz) = v_from
         and (v_days is null or extract(dow from p.scheduled_at at time zone tz)::int = any(v_days))
       for update
    loop
      v_new := ((r.scheduled_at at time zone tz)::date + make_time(v_to, v_min, 0)) at time zone tz;
      continue when v_new <= now() or v_new = r.scheduled_at;
      update posts set scheduled_at = v_new, updated_at = now() where id = r.id;
      insert into post_events (tenant_id, post_id, from_status, to_status, actor, note)
      values (f.tenant_id, r.id, r.status, r.status, auth.uid(),
              format('Horário movido de %s para %s pela análise: %s',
                     to_char(r.scheduled_at at time zone tz, 'HH24:MI'), to_char(v_new at time zone tz, 'HH24:MI'), f.title));
      n := n + 1;
    end loop;
  elsif kind = 'change_format' then
    begin
      v_fmt_from := (f.action -> 'params' ->> 'from')::post_format;
      v_fmt_to := (f.action -> 'params' ->> 'to')::post_format;
    exception when others then
      raise exception 'ação inválida' using errcode = 'VP409';
    end;
    if v_fmt_from is null or v_fmt_to is null or v_fmt_from = v_fmt_to then
      raise exception 'ação inválida' using errcode = 'VP409';
    end if;
    for r in
      select p.id, p.status from posts p
       where p.tenant_id = f.tenant_id and p.ig_account_id = f.ig_account_id
         and p.status = 'planned' and p.format = v_fmt_from and p.scheduled_at > now()
         and not exists (select 1 from post_media m where m.post_id = p.id)
       for update
    loop
      update posts set format = v_fmt_to, updated_at = now() where id = r.id;
      insert into post_events (tenant_id, post_id, from_status, to_status, actor, note)
      values (f.tenant_id, r.id, r.status, r.status, auth.uid(), format('Formato trocado de %s para %s pela análise: %s', v_fmt_from, v_fmt_to, f.title));
      n := n + 1;
    end loop;
  else
    raise exception 'este achado não tem ação para aplicar' using errcode = 'VP409';
  end if;

  update analysis_findings set applied_at = now(), applied_by = auth.uid(), applied_count = n where id = f.id;
  insert into audit_log (tenant_id, actor, action, target)
  values (f.tenant_id, auth.uid(), 'finding.applied', format('%s (%s posts)', f.title, n));
  return n;
end $$;
revoke execute on function apply_finding(uuid) from public, anon;
grant execute on function apply_finding(uuid) to authenticated;
