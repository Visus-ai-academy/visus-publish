-- Cadência de publicação por conta: dias da semana, horários e formatos.
-- A sugestão de temas por IA preenche só as vagas desta cadência.
create table posting_cadences (
  ig_account_id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  niche text check (niche is null or length(niche) <= 200),
  -- [{ "weekday": 0..6 (0 = domingo), "time": "HH:MM", "format": "image"|"carousel"|"reels"|"story" }]
  slots jsonb not null default '[]' check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) <= 40),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  foreign key (ig_account_id, tenant_id) references ig_accounts(id, tenant_id) on delete cascade
);
alter table posting_cadences enable row level security;

create policy cadence_read on posting_cadences for select using (has_tenant_role(tenant_id));
create policy cadence_write on posting_cadences for all
  using (has_tenant_role(tenant_id, array['admin','editor']::member_role[]))
  with check (has_tenant_role(tenant_id, array['admin','editor']::member_role[]));
