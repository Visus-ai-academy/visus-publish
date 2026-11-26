-- Fase 3: mais provedores de IA, créditos da plataforma e chave própria do cliente.
-- 1. Provedores com chave: openai, gemini (texto, arte e vídeo Veo) e higgsfield (vídeo).
-- 2. Provedor padrão por tarefa em ai_settings, com vídeo desligado por padrão ('none').
-- 3. Créditos: saldo, débito antes de gerar (bloqueia sem saldo), estorno e crédito pelo admin.
-- 4. Chave própria do cliente (modo 'own') no Vault, gravada só pelo servidor.
-- 5. Vídeo é assíncrono: o post fica em 'generating' enquanto o job do provedor roda.
-- 6. Modelos de vídeo e custo inicial em ai_models (editáveis pelo admin).

-- ============ 1. Provedores com chave ============
alter table ai_platform_keys drop constraint if exists ai_platform_keys_provider_check;
alter table ai_platform_keys add constraint ai_platform_keys_provider_check check (provider in ('openai', 'gemini', 'higgsfield'));
alter table ai_credentials add constraint ai_credentials_provider_check check (provider in ('openai', 'gemini', 'higgsfield'));

-- ============ 2. Provedor padrão por tarefa ============
alter table ai_settings alter column default_video_provider set default 'none';
update ai_settings set default_video_provider = 'none' where default_video_provider not in ('veo', 'higgsfield');
update ai_settings set default_caption_provider = 'openai' where default_caption_provider not in ('openai', 'gemini');
update ai_settings set default_image_provider = 'gemini_image' where default_image_provider not in ('openai_image', 'gemini_image');
alter table ai_settings
  add constraint ai_settings_caption_provider_check check (default_caption_provider in ('openai', 'gemini')),
  add constraint ai_settings_image_provider_check check (default_image_provider in ('openai_image', 'gemini_image')),
  add constraint ai_settings_video_provider_check check (default_video_provider in ('none', 'veo', 'higgsfield'));

-- ============ 3. Créditos ============
-- Saldo do cliente: membros do cliente, admin da plataforma ou o servidor.
create or replace function credit_balance(p_tenant uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not has_tenant_role(p_tenant) then
    raise exception 'sem acesso a este cliente' using errcode = '42501';
  end if;
  return (select coalesce(sum(delta), 0) from credit_ledger where tenant_id = p_tenant);
end $$;
revoke all on function credit_balance(uuid) from public, anon;
grant execute on function credit_balance(uuid) to authenticated, service_role;

-- Débito antes de chamar a IA (só no modo 'platform'). Trava a linha de ai_settings do
-- cliente para que duas gerações ao mesmo tempo não passem do saldo. Devolve o valor
-- debitado (0 no modo 'own') para o servidor saber se precisa estornar.
create or replace function charge_credits(p_tenant uuid, p_amount numeric, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_mode billing_mode; v_balance numeric;
begin
  insert into ai_settings (tenant_id) values (p_tenant) on conflict do nothing;
  select billing_mode into v_mode from ai_settings where tenant_id = p_tenant for update;
  if v_mode = 'own' or coalesce(p_amount, 0) <= 0 then return 0; end if;
  select coalesce(sum(delta), 0) into v_balance from credit_ledger where tenant_id = p_tenant;
  if v_balance < p_amount then
    raise exception 'saldo de créditos insuficiente' using errcode = 'VP402', detail = v_balance::text;
  end if;
  insert into credit_ledger (tenant_id, delta, reason) values (p_tenant, -p_amount, left(p_reason, 200));
  return p_amount;
end $$;
revoke all on function charge_credits(uuid, numeric, text) from public, anon, authenticated;
grant execute on function charge_credits(uuid, numeric, text) to service_role;

-- Crédito: o admin da plataforma adiciona (ou retira, com valor negativo) e o servidor estorna.
create or replace function grant_credits(p_tenant uuid, p_amount numeric, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_server boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not v_server and not is_platform_admin() then
    raise exception 'só a equipe da Visus adiciona créditos' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then
    raise exception 'valor de créditos inválido' using errcode = '22023';
  end if;
  if not exists (select 1 from tenants where id = p_tenant) then
    raise exception 'cliente não encontrado' using errcode = 'P0002';
  end if;
  insert into credit_ledger (tenant_id, delta, reason) values (p_tenant, p_amount, left(coalesce(nullif(trim(p_reason), ''), 'Créditos'), 200));
  if not v_server then
    insert into audit_log (tenant_id, actor, action, target, meta)
    values (p_tenant, auth.uid(), 'credits.grant', p_tenant::text, jsonb_build_object('amount', p_amount, 'reason', p_reason));
  end if;
  return (select coalesce(sum(delta), 0) from credit_ledger where tenant_id = p_tenant);
end $$;
revoke all on function grant_credits(uuid, numeric, text) from public, anon;
grant execute on function grant_credits(uuid, numeric, text) to authenticated, service_role;

-- Clientes que já existiam começam com saldo para não travar o uso atual
insert into credit_ledger (tenant_id, delta, reason)
select id, 1000, 'Créditos iniciais' from tenants t
where not exists (select 1 from credit_ledger c where c.tenant_id = t.id);

-- ============ 4. Chave própria do cliente ============
-- A tela só lista quais provedores têm chave; quem grava ou apaga é o servidor (store_tenant_ai_key),
-- para ninguém apontar secret_id para um segredo de outro cliente ou da plataforma.
drop policy if exists aic_admin on ai_credentials;
create policy aic_read on ai_credentials for select using (has_tenant_role(tenant_id, array['admin']::member_role[]));

create or replace function store_tenant_ai_key(p_tenant uuid, p_provider text, p_key text, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select secret_id into v_id from ai_credentials where tenant_id = p_tenant and provider = p_provider for update;
  if p_key is null or length(trim(p_key)) = 0 then
    if v_id is not null then perform _drop_secret(v_id); end if;
    delete from ai_credentials where tenant_id = p_tenant and provider = p_provider;
  else
    v_id := _put_secret(v_id, trim(p_key), 'ai_tenant_' || p_provider);
    insert into ai_credentials (tenant_id, provider, secret_id, created_by) values (p_tenant, p_provider, v_id, p_actor)
    on conflict (tenant_id, provider) do update set secret_id = excluded.secret_id, created_by = excluded.created_by, created_at = now();
  end if;
  insert into audit_log (tenant_id, actor, action, target, meta)
  values (p_tenant, p_actor, case when p_key is null or length(trim(p_key)) = 0 then 'ai_key.remove' else 'ai_key.store' end, p_provider, null);
end $$;
revoke all on function store_tenant_ai_key(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function store_tenant_ai_key(uuid, text, text, uuid) to service_role;

-- Quais provedores têm chave para o cliente, nos dois modos (nunca o segredo). Membros do cliente.
create or replace function ai_key_status(p_tenant uuid)
returns table (provider text, platform boolean, own boolean) language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not has_tenant_role(p_tenant) then
    raise exception 'sem acesso a este cliente' using errcode = '42501';
  end if;
  return query
    select p.provider,
           exists (select 1 from ai_platform_keys k where k.provider = p.provider),
           exists (select 1 from ai_credentials c where c.tenant_id = p_tenant and c.provider = p.provider)
    from unnest(array['openai', 'gemini', 'higgsfield']) as p(provider);
end $$;
revoke all on function ai_key_status(uuid) from public, anon;
grant execute on function ai_key_status(uuid) to authenticated, service_role;

-- ============ 5. Vídeo assíncrono ============
create index if not exists generation_jobs_post_running on generation_jobs (post_id) where status = 'running';

-- Um post com vídeo ainda rodando no provedor (até 30 min) não pode ser pedido de novo
create or replace function begin_generation(p_post uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_from post_status; v_origin text; v_since timestamptz;
begin
  select tenant_id, status, origin::text into v_tenant, v_from, v_origin from posts where id = p_post for update;
  if v_tenant is null then raise exception 'post não encontrado' using errcode = 'P0002'; end if;
  if not has_tenant_role(v_tenant, array['admin','editor']::member_role[]) then
    raise exception 'sem permissão para alterar o post' using errcode = '42501';
  end if;
  if v_from = 'generating' then
    select max(created_at) into v_since from post_events where post_id = p_post and to_status = 'generating';
    if (v_since is not null and v_since > now() - interval '10 minutes')
       or exists (select 1 from generation_jobs where post_id = p_post and status = 'running' and created_at > now() - interval '30 minutes') then
      raise exception 'post já está sendo gerado' using errcode = '55P03';
    end if;
    -- O que ficou para trás não é mais esperado
    update generation_jobs set status = 'failed', error = 'substituído por um novo pedido', finished_at = now()
    where post_id = p_post and status = 'running';
  elsif v_from in ('pending_approval', 'scheduled') then
    if v_origin <> 'ai' then
      raise exception 'só posts criados pela IA podem ser gerados de novo' using errcode = '22023';
    end if;
  elsif v_from not in ('planned', 'rejected', 'generation_failed') then
    raise exception 'transição % → generating não permitida', v_from using errcode = '22023';
  end if;
  update posts set status = 'generating', last_error = null where id = p_post;
  insert into post_events (tenant_id, post_id, from_status, to_status, actor, note)
  values (v_tenant, p_post, v_from, 'generating', auth.uid(), coalesce(p_note, 'geração com IA'));
end $$;
revoke all on function begin_generation(uuid, text) from public, anon;
grant execute on function begin_generation(uuid, text) to authenticated, service_role;

-- ============ 6. Modelos de vídeo ============
insert into ai_models (id, provider, task, model, unit_cost_credits) values
  ('gemini:video', 'gemini', 'video', 'veo-3.0-fast-generate-001', 40),
  ('higgsfield:video', 'higgsfield', 'video', 'wan/v2.6/image-to-video', 40)
on conflict (id) do nothing;
