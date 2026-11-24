-- Visus Publish — esquema inicial multi-tenant com RLS
-- Convenção: toda tabela de negócio tem tenant_id e RLS habilitado.

create extension if not exists pgcrypto;

-- ============ Tipos ============
create type member_role as enum ('admin', 'editor', 'approver', 'viewer');
create type tenant_status as enum ('active', 'suspended');
create type post_status as enum (
  'planned', 'generating', 'generation_failed', 'pending_approval',
  'rejected', 'scheduled', 'publishing', 'published', 'failed', 'paused'
);
create type post_format as enum ('image', 'carousel', 'reels', 'story');
create type post_origin as enum ('ai', 'upload');
create type ig_account_status as enum ('connected', 'needs_reauth', 'disconnected');
create type billing_mode as enum ('platform', 'own');
create type ai_task as enum ('caption', 'image', 'video', 'analysis');
create type job_status as enum ('queued', 'running', 'succeeded', 'failed');

-- ============ Tenants e acesso ============
create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,48}$'),
  name text not null,
  plan text not null default 'Profissional',
  status tenant_status not null default 'active',
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table memberships (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index on memberships (user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  role member_role not null default 'editor',
  token_hash text not null,
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  unique (tenant_id, email)
);

-- Helpers de autorização (security definer evita recursão de RLS em memberships)
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function has_tenant_role(t uuid, roles member_role[] default null) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or exists (
    select 1 from memberships m
    join tenants tn on tn.id = m.tenant_id
    where m.tenant_id = t and m.user_id = auth.uid()
      and tn.status = 'active'
      and (roles is null or m.role = any(roles))
  );
$$;

-- ============ Contas do Instagram ============
create table ig_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ig_user_id text not null unique,          -- a mesma conta não pode estar em dois tenants
  username text not null,
  name text,
  profile_picture_url text,
  account_type text,
  status ig_account_status not null default 'connected',
  require_approval boolean not null default true,
  token_secret_id uuid,                      -- id do segredo no Supabase Vault
  token_expires_at timestamptz,
  color text not null default '#4A5D23',
  connected_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on ig_accounts (tenant_id);

create table brand_profiles (
  ig_account_id uuid primary key references ig_accounts(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  tone text,
  audience text,
  forbidden_topics text,
  default_hashtags text[] not null default '{}',
  colors text[] not null default '{}',
  fonts text[] not null default '{}',
  logo_path text,
  is_healthcare boolean not null default false,  -- ativa regras de publicidade médica
  updated_at timestamptz not null default now()
);

-- ============ IA ============
create table ai_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  billing_mode billing_mode not null default 'platform',
  default_caption_provider text not null default 'openai',
  default_image_provider text not null default 'gemini_image',
  default_video_provider text not null default 'higgsfield',
  updated_at timestamptz not null default now()
);

create table ai_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null,                    -- openai | google | higgsfield | canva
  secret_id uuid not null,                   -- Supabase Vault
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table ai_models (                     -- configuração global, editável pelo admin da plataforma
  id text primary key,                       -- ex.: 'openai:caption'
  provider text not null,
  task ai_task not null,
  model text not null,
  unit_cost_credits numeric(10,2) not null default 1,
  active boolean not null default true
);

create table credit_ledger (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  delta numeric(12,2) not null,              -- + compra/bonus, - consumo
  reason text not null,
  generation_job_id uuid,
  created_at timestamptz not null default now()
);
create index on credit_ledger (tenant_id, created_at);

-- ============ Posts ============
create table posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ig_account_id uuid not null references ig_accounts(id) on delete cascade,
  scheduled_at timestamptz not null,
  theme text not null,
  format post_format not null,
  origin post_origin not null default 'ai',
  status post_status not null default 'planned',
  caption text check (char_length(caption) <= 2200),
  caption_provider text,
  media_provider text,
  is_ai_generated boolean not null default false,
  ig_container_id text,
  ig_media_id text,
  permalink text,
  published_at timestamptz,
  last_error text,
  attempts int not null default 0,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on posts (tenant_id, scheduled_at);
create index on posts (status, scheduled_at) where status = 'scheduled';

create table post_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  position int not null default 0,
  kind text not null check (kind in ('image', 'video')),
  storage_path text not null,                -- media/{tenant_id}/{post_id}/arquivo
  width int, height int, duration_s numeric,
  unique (post_id, position)
);

create table post_events (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  from_status post_status,
  to_status post_status,
  actor uuid references auth.users(id),      -- null = sistema
  note text,
  created_at timestamptz not null default now()
);
create index on post_events (post_id, created_at);

create table generation_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  task ai_task not null,
  provider text not null,
  model text,
  status job_status not null default 'queued',
  external_id text,                          -- id do job no provedor (vídeo assíncrono)
  request jsonb,
  result jsonb,
  error text,
  credits numeric(10,2),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on generation_jobs (tenant_id, created_at);
create index on generation_jobs (status) where status in ('queued', 'running');

-- ============ Insights ============
create table media_insights (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  snapshot text not null check (snapshot in ('1h', '24h', '72h', '7d', '28d')),
  collected_at timestamptz not null default now(),
  views int, reach int, likes int, comments int, saved int, shares int,
  total_interactions int, profile_visits int, follows int,
  raw jsonb,
  unique (post_id, snapshot)
);

create table account_insights_daily (
  tenant_id uuid not null references tenants(id) on delete cascade,
  ig_account_id uuid not null references ig_accounts(id) on delete cascade,
  day date not null,
  views int, reach int, profile_views int, follower_count int,
  raw jsonb,
  primary key (ig_account_id, day)
);

create table audience_snapshots (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  ig_account_id uuid not null references ig_accounts(id) on delete cascade,
  collected_at timestamptz not null default now(),
  age jsonb, gender jsonb, cities jsonb
);

create table analysis_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ig_account_id uuid references ig_accounts(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  title text not null,
  body text not null,
  evidence jsonb,
  action jsonb,                              -- {type, params}
  applied_at timestamptz,
  applied_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ============ Auditoria ============
create table audit_log (
  id bigserial primary key,
  tenant_id uuid references tenants(id) on delete set null,
  actor uuid references auth.users(id),
  action text not null,
  target text,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- ============ updated_at ============
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger posts_touch before update on posts for each row execute function touch_updated_at();

-- ============ RLS ============
alter table tenants enable row level security;
alter table platform_admins enable row level security;
alter table memberships enable row level security;
alter table invitations enable row level security;
alter table ig_accounts enable row level security;
alter table brand_profiles enable row level security;
alter table ai_settings enable row level security;
alter table ai_credentials enable row level security;
alter table ai_models enable row level security;
alter table credit_ledger enable row level security;
alter table posts enable row level security;
alter table post_media enable row level security;
alter table post_events enable row level security;
alter table generation_jobs enable row level security;
alter table media_insights enable row level security;
alter table account_insights_daily enable row level security;
alter table audience_snapshots enable row level security;
alter table analysis_findings enable row level security;
alter table audit_log enable row level security;

-- tenants
create policy tenants_read on tenants for select using (has_tenant_role(id));
create policy tenants_admin_write on tenants for all using (is_platform_admin()) with check (is_platform_admin());

-- platform_admins: só admins da plataforma veem
create policy pa_read on platform_admins for select using (is_platform_admin());

-- memberships: membro vê os colegas do tenant; admin do tenant gerencia
create policy mem_read on memberships for select using (has_tenant_role(tenant_id));
create policy mem_admin on memberships for all
  using (has_tenant_role(tenant_id, array['admin']::member_role[]))
  with check (has_tenant_role(tenant_id, array['admin']::member_role[]));

create policy inv_admin on invitations for all
  using (has_tenant_role(tenant_id, array['admin']::member_role[]))
  with check (has_tenant_role(tenant_id, array['admin']::member_role[]));

-- Leitura para qualquer membro; escrita conforme papel
create policy igacc_read on ig_accounts for select using (has_tenant_role(tenant_id));
create policy igacc_admin on ig_accounts for all
  using (has_tenant_role(tenant_id, array['admin']::member_role[]))
  with check (has_tenant_role(tenant_id, array['admin']::member_role[]));

create policy brand_read on brand_profiles for select using (has_tenant_role(tenant_id));
create policy brand_write on brand_profiles for all
  using (has_tenant_role(tenant_id, array['admin','editor']::member_role[]))
  with check (has_tenant_role(tenant_id, array['admin','editor']::member_role[]));

create policy ais_read on ai_settings for select using (has_tenant_role(tenant_id));
create policy ais_admin on ai_settings for all
  using (has_tenant_role(tenant_id, array['admin']::member_role[]))
  with check (has_tenant_role(tenant_id, array['admin']::member_role[]));

-- credenciais: só admin enxerga que existem (o segredo fica no Vault)
create policy aic_admin on ai_credentials for all
  using (has_tenant_role(tenant_id, array['admin']::member_role[]))
  with check (has_tenant_role(tenant_id, array['admin']::member_role[]));

create policy aim_read on ai_models for select using (auth.uid() is not null);
create policy aim_admin on ai_models for all using (is_platform_admin()) with check (is_platform_admin());

create policy credit_read on credit_ledger for select using (has_tenant_role(tenant_id, array['admin']::member_role[]));

-- posts: todos leem; admin/editor criam e editam; aprovação via função (abaixo)
create policy posts_read on posts for select using (has_tenant_role(tenant_id));
create policy posts_write on posts for insert
  with check (has_tenant_role(tenant_id, array['admin','editor']::member_role[]));
create policy posts_update on posts for update
  using (has_tenant_role(tenant_id, array['admin','editor']::member_role[]))
  with check (has_tenant_role(tenant_id, array['admin','editor']::member_role[]));
create policy posts_delete on posts for delete
  using (has_tenant_role(tenant_id, array['admin','editor']::member_role[]));

create policy pm_read on post_media for select using (has_tenant_role(tenant_id));
create policy pm_write on post_media for all
  using (has_tenant_role(tenant_id, array['admin','editor']::member_role[]))
  with check (has_tenant_role(tenant_id, array['admin','editor']::member_role[]));

create policy pe_read on post_events for select using (has_tenant_role(tenant_id));
create policy gj_read on generation_jobs for select using (has_tenant_role(tenant_id));
create policy mi_read on media_insights for select using (has_tenant_role(tenant_id));
create policy aid_read on account_insights_daily for select using (has_tenant_role(tenant_id));
create policy aud_read on audience_snapshots for select using (has_tenant_role(tenant_id));
create policy af_read on analysis_findings for select using (has_tenant_role(tenant_id));
create policy al_read on audit_log for select
  using (is_platform_admin() or (tenant_id is not null and has_tenant_role(tenant_id, array['admin']::member_role[])));
-- Escrita em post_events, generation_jobs, insights, findings e audit_log: só service_role (jobs/servidor).

-- ============ Aprovação (approver não tem UPDATE direto em posts) ============
create or replace function review_post(p_post uuid, p_approve boolean, p_note text default null)
returns post_status language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_from post_status; v_to post_status;
begin
  select tenant_id, status into v_tenant, v_from from posts where id = p_post for update;
  if v_tenant is null then raise exception 'post não encontrado'; end if;
  if not has_tenant_role(v_tenant, array['admin','approver']::member_role[]) then
    raise exception 'sem permissão para aprovar';
  end if;
  if v_from <> 'pending_approval' then raise exception 'post não está aguardando aprovação'; end if;
  v_to := case when p_approve then 'scheduled' else 'rejected' end;
  update posts set status = v_to,
    approved_by = case when p_approve then auth.uid() end,
    approved_at = case when p_approve then now() end
  where id = p_post;
  insert into post_events (tenant_id, post_id, from_status, to_status, actor, note)
  values (v_tenant, p_post, v_from, v_to, auth.uid(), p_note);
  return v_to;
end $$;

-- ============ Fila de publicação (usada pelo job com service_role) ============
create or replace function claim_due_posts(p_limit int default 20)
returns setof posts language sql security definer set search_path = public as $$
  update posts p set status = 'publishing', attempts = p.attempts + 1
  where p.id in (
    select id from posts
    where status = 'scheduled' and scheduled_at <= now()
    order by scheduled_at
    limit p_limit
    for update skip locked
  )
  returning p.*;
$$;
revoke all on function claim_due_posts(int) from public, anon, authenticated;

-- ============ Storage ============
insert into storage.buckets (id, name, public) values ('media', 'media', false)
on conflict (id) do nothing;

create policy media_read on storage.objects for select
  using (bucket_id = 'media' and has_tenant_role(((storage.foldername(name))[1])::uuid));
create policy media_write on storage.objects for insert
  with check (bucket_id = 'media' and has_tenant_role(((storage.foldername(name))[1])::uuid, array['admin','editor']::member_role[]));
create policy media_delete on storage.objects for delete
  using (bucket_id = 'media' and has_tenant_role(((storage.foldername(name))[1])::uuid, array['admin','editor']::member_role[]));
