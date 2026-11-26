-- Fase 2 (parte 2): planejamento com IA. Temas sugeridos viram posts 'planned' (origem 'ai');
-- a geração de legenda e arte passa por 'generating' e termina em aprovação, agendado
-- ou de volta a 'planned' quando o formato precisa de vídeo enviado pela equipe (Reels).

-- Pessoa (admin/editor) pede a geração: planned | rejected | generation_failed → generating.
-- Um 'generating' parado há mais de 10 min (função caiu no meio) pode ser pedido de novo.
create or replace function begin_generation(p_post uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_from post_status; v_since timestamptz;
begin
  select tenant_id, status into v_tenant, v_from from posts where id = p_post for update;
  if v_tenant is null then raise exception 'post não encontrado' using errcode = 'P0002'; end if;
  if not has_tenant_role(v_tenant, array['admin','editor']::member_role[]) then
    raise exception 'sem permissão para alterar o post' using errcode = '42501';
  end if;
  if v_from = 'generating' then
    select max(created_at) into v_since from post_events where post_id = p_post and to_status = 'generating';
    if v_since is not null and v_since > now() - interval '10 minutes' then
      raise exception 'post já está sendo gerado' using errcode = '55P03';
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

-- Sistema termina a geração. Com mídia: modo da conta (lido agora) ou alerta de saúde decide
-- entre aprovação e agendado. Sem mídia (Reels esperando vídeo): volta a 'planned'.
create or replace function finish_generation(p_post uuid, p_error text default null)
returns post_status language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_from post_status; v_require boolean; v_flags text[]; v_media int; v_to post_status;
begin
  select p.tenant_id, p.status, a.require_approval, p.compliance_flags into v_tenant, v_from, v_require, v_flags
  from posts p join ig_accounts a on a.id = p.ig_account_id and a.tenant_id = p.tenant_id
  where p.id = p_post for update of p;
  if v_tenant is null then raise exception 'post não encontrado' using errcode = 'P0002'; end if;
  if v_from <> 'generating' then raise exception 'post não está em geração' using errcode = '22023'; end if;

  if p_error is not null then
    v_to := 'generation_failed';
    update posts set status = v_to, last_error = left(p_error, 500) where id = p_post;
  else
    select count(*) into v_media from post_media where post_id = p_post;
    v_to := case when v_media = 0 then 'planned'
                 when v_require or cardinality(v_flags) > 0 then 'pending_approval'
                 else 'scheduled' end;
    update posts set status = v_to, last_error = null, approved_by = null, approved_at = null where id = p_post;
  end if;
  insert into post_events (tenant_id, post_id, from_status, to_status, note)
  values (v_tenant, p_post, 'generating', v_to, case when p_error is null then 'conteúdo gerado' else 'falha na geração' end);
  return v_to;
end $$;
revoke all on function finish_generation(uuid, text) from public, anon, authenticated;
grant execute on function finish_generation(uuid, text) to service_role;

-- Alertas também podem entrar durante a geração (o servidor confere a legenda gerada)
create or replace function add_post_flags(p_post uuid, p_flags text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_status post_status;
begin
  select tenant_id, status into v_tenant, v_status from posts where id = p_post for update;
  if v_tenant is null then raise exception 'post não encontrado' using errcode = 'P0002'; end if;
  if coalesce(auth.role(), '') <> 'service_role' and not has_tenant_role(v_tenant, array['admin','editor']::member_role[]) then
    raise exception 'sem permissão para alterar o post' using errcode = '42501';
  end if;
  if v_status not in ('planned', 'rejected', 'generating') then
    raise exception 'alertas só entram antes do agendamento' using errcode = '22023';
  end if;
  update posts set compliance_flags = (
    select coalesce(array_agg(distinct f order by f), '{}') from unnest(compliance_flags || p_flags) f where length(trim(f)) > 0
  ) where id = p_post;
end $$;

insert into ai_models (id, provider, task, model, unit_cost_credits) values
  ('openai:image', 'openai', 'image', 'gpt-image-1', 4),
  ('gemini:image', 'gemini', 'image', 'gemini-2.5-flash-image', 4)
on conflict (id) do nothing;

-- Chave da plataforma para listar modelos na tela do admin (só service_role)
create or replace function read_platform_ai_key(p_provider text)
returns text language sql security definer set search_path = public, vault as $$
  select s.decrypted_secret from ai_platform_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.provider = p_provider;
$$;
revoke all on function read_platform_ai_key(text) from public, anon, authenticated;
grant execute on function read_platform_ai_key(text) to service_role;
