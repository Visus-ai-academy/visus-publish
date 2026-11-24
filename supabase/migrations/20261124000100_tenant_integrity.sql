-- Visus Publish — Fase 0: integridade entre tenants e trava de status
--
-- 1. FKs compostas (id, tenant_id): uma linha filha nunca aponta para um pai de outro tenant.
-- 2. Status e colunas de publicação de posts só mudam por funções do domínio ou service_role.
-- 3. Funções de domínio: transition_post (transições feitas por pessoas) e accept_invitation.
-- 4. Policies de Storage sem erro quando a pasta não é um uuid.

-- ============ 1. FKs compostas ============
alter table ig_accounts add constraint ig_accounts_id_tenant_key unique (id, tenant_id);
alter table posts add constraint posts_id_tenant_key unique (id, tenant_id);
alter table generation_jobs add constraint generation_jobs_id_tenant_key unique (id, tenant_id);

alter table posts
  add constraint posts_ig_account_same_tenant
  foreign key (ig_account_id, tenant_id) references ig_accounts (id, tenant_id) on delete cascade;

alter table brand_profiles
  add constraint brand_profiles_ig_account_same_tenant
  foreign key (ig_account_id, tenant_id) references ig_accounts (id, tenant_id) on delete cascade;

alter table post_media
  add constraint post_media_post_same_tenant
  foreign key (post_id, tenant_id) references posts (id, tenant_id) on delete cascade;

alter table post_events
  add constraint post_events_post_same_tenant
  foreign key (post_id, tenant_id) references posts (id, tenant_id) on delete cascade;

alter table generation_jobs
  add constraint generation_jobs_post_same_tenant
  foreign key (post_id, tenant_id) references posts (id, tenant_id) on delete cascade;

alter table media_insights
  add constraint media_insights_post_same_tenant
  foreign key (post_id, tenant_id) references posts (id, tenant_id) on delete cascade;

alter table account_insights_daily
  add constraint account_insights_daily_ig_account_same_tenant
  foreign key (ig_account_id, tenant_id) references ig_accounts (id, tenant_id) on delete cascade;

alter table audience_snapshots
  add constraint audience_snapshots_ig_account_same_tenant
  foreign key (ig_account_id, tenant_id) references ig_accounts (id, tenant_id) on delete cascade;

alter table analysis_findings
  add constraint analysis_findings_ig_account_same_tenant
  foreign key (ig_account_id, tenant_id) references ig_accounts (id, tenant_id) on delete cascade;

alter table credit_ledger
  add constraint credit_ledger_job_same_tenant
  foreign key (generation_job_id, tenant_id) references generation_jobs (id, tenant_id) on delete set null (generation_job_id);

-- tenant_id de posts e mídia não muda depois de criado
create or replace function forbid_tenant_change() returns trigger language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id não pode ser alterado' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger posts_tenant_immutable before update on posts
  for each row execute function forbid_tenant_change();
create trigger post_media_tenant_immutable before update on post_media
  for each row execute function forbid_tenant_change();
create trigger ig_accounts_tenant_immutable before update on ig_accounts
  for each row execute function forbid_tenant_change();
create trigger brand_profiles_tenant_immutable before update on brand_profiles
  for each row execute function forbid_tenant_change();

-- ============ 2. Trava de status em posts ============
-- Quem chama pela API com o papel `authenticated` não muda status nem colunas
-- de publicação/aprovação diretamente. As funções security definer
-- (review_post, transition_post, claim_due_posts) rodam como dono da função
-- e o service_role usa os jobs, então passam pela trava.
create or replace function guard_post_columns() returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'planned' then
      raise exception 'post novo começa como planned; use transition_post' using errcode = '42501';
    end if;
    if new.approved_by is not null or new.approved_at is not null
       or new.ig_container_id is not null or new.ig_media_id is not null
       or new.permalink is not null or new.published_at is not null
       or new.attempts <> 0 or new.last_error is not null then
      raise exception 'colunas de aprovação/publicação são do sistema' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'status só muda por transition_post ou review_post' using errcode = '42501';
  end if;
  if new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.ig_container_id is distinct from old.ig_container_id
     or new.ig_media_id is distinct from old.ig_media_id
     or new.permalink is distinct from old.permalink
     or new.published_at is distinct from old.published_at
     or new.attempts is distinct from old.attempts
     or new.last_error is distinct from old.last_error
     or new.created_by is distinct from old.created_by then
    raise exception 'colunas de aprovação/publicação são do sistema' using errcode = '42501';
  end if;
  if old.status in ('publishing', 'published') then
    raise exception 'post publicado ou publicando não pode ser editado' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger posts_guard before insert or update on posts
  for each row execute function guard_post_columns();

-- ============ 3. Funções de domínio ============
-- Transições iniciadas por pessoas (SPEC §6). As do sistema (generating,
-- publishing, published, failed…) ficam com os jobs via service_role.
create or replace function transition_post(p_post uuid, p_to post_status, p_note text default null)
returns post_status language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_from post_status; v_require_approval boolean;
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
    null;                                            -- cancelar agendamento
  elsif v_from = 'planned' and p_to in ('pending_approval', 'scheduled') then
    -- criativo pronto: o modo da conta decide o destino, não quem chama
    p_to := case when v_require_approval then 'pending_approval' else 'scheduled' end;
  elsif v_from = 'failed' and p_to = 'scheduled' then
    null;                                            -- tentar de novo
  else
    raise exception 'transição % → % não permitida', v_from, p_to using errcode = '22023';
  end if;

  update posts set status = p_to where id = p_post;
  insert into post_events (tenant_id, post_id, from_status, to_status, actor, note)
  values (v_tenant, p_post, v_from, p_to, auth.uid(), p_note);
  return p_to;
end $$;

revoke all on function transition_post(uuid, post_status, text) from public, anon;
grant execute on function transition_post(uuid, post_status, text) to authenticated;
revoke all on function review_post(uuid, boolean, text) from public, anon;
grant execute on function review_post(uuid, boolean, text) to authenticated;

-- Convite: o servidor gera um token aleatório, guarda sha256 em token_hash e
-- envia o link. Quem aceita precisa estar logado com o mesmo e-mail.
create or replace function accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_inv invitations%rowtype; v_email text;
begin
  if auth.uid() is null then raise exception 'login necessário' using errcode = '42501'; end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  select * into v_inv from invitations
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  for update;

  if v_inv.id is null or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'convite inválido ou expirado' using errcode = '22023';
  end if;
  if lower(v_inv.email) <> v_email then
    raise exception 'este convite é para outro e-mail' using errcode = '42501';
  end if;

  insert into memberships (tenant_id, user_id, role)
  values (v_inv.tenant_id, auth.uid(), v_inv.role)
  on conflict (tenant_id, user_id) do update set role = excluded.role;

  update invitations set accepted_at = now() where id = v_inv.id;
  insert into audit_log (tenant_id, actor, action, target)
  values (v_inv.tenant_id, auth.uid(), 'invitation.accepted', v_inv.email);
  return v_inv.tenant_id;
end $$;

revoke all on function accept_invitation(text) from public, anon;
grant execute on function accept_invitation(text) to authenticated;

-- O admin do tenant não pode tirar o último admin (nem a si mesmo, se for o último)
create or replace function keep_one_admin() returns trigger language plpgsql as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if not exists (
      select 1 from memberships
      where tenant_id = old.tenant_id and role = 'admin' and user_id <> old.user_id
    ) and exists (select 1 from tenants where id = old.tenant_id) then
      raise exception 'o cliente precisa de pelo menos um admin' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger memberships_keep_admin before update or delete on memberships
  for each row execute function keep_one_admin();

-- Todo tenant novo ganha ai_settings padrão
create or replace function tenant_defaults() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into ai_settings (tenant_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger tenants_defaults after insert on tenants
  for each row execute function tenant_defaults();

-- ============ 4. Storage sem erro de cast ============
create or replace function storage_tenant(p_name text) returns uuid
language plpgsql immutable as $$
declare v text := split_part(p_name, '/', 1);
begin
  if v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end $$;

drop policy media_read on storage.objects;
drop policy media_write on storage.objects;
drop policy media_delete on storage.objects;

create policy media_read on storage.objects for select
  using (bucket_id = 'media' and has_tenant_role(storage_tenant(name)));
create policy media_write on storage.objects for insert
  with check (bucket_id = 'media' and has_tenant_role(storage_tenant(name), array['admin','editor']::member_role[]));
create policy media_delete on storage.objects for delete
  using (bucket_id = 'media' and has_tenant_role(storage_tenant(name), array['admin','editor']::member_role[]));

-- ============ 5. Pessoas do tenant (e-mail vem de auth.users) ============
create or replace function tenant_members(p_tenant uuid)
returns table (user_id uuid, email text, role member_role, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from memberships m join auth.users u on u.id = m.user_id
  where m.tenant_id = p_tenant and has_tenant_role(p_tenant)
  order by m.created_at;
$$;

revoke all on function tenant_members(uuid) from public, anon;
grant execute on function tenant_members(uuid) to authenticated;

-- ============ 6. Prévia do convite (tela pública do link) ============
-- Devolve só o necessário para a tela: nome do cliente, e-mail convidado e papel.
create or replace function invitation_preview(p_token text)
returns table (tenant_name text, email text, role member_role, valid boolean)
language sql stable security definer set search_path = public, extensions as $$
  select t.name, i.email, i.role, (i.accepted_at is null and i.expires_at >= now() and t.status = 'active')
  from invitations i join tenants t on t.id = i.tenant_id
  where i.token_hash = encode(digest(p_token, 'sha256'), 'hex');
$$;

revoke all on function invitation_preview(text) from public;
grant execute on function invitation_preview(text) to anon, authenticated;
