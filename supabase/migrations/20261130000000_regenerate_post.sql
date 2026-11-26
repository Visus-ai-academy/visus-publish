-- Gerar de novo depois de pronto: a equipe pode pedir nova legenda ou nova arte
-- de um post da IA que está aguardando aprovação ou já agendado. Ele volta para
-- "generating" e o finish_generation decide de novo entre aprovação e agenda
-- (a aprovação anterior é zerada, porque o conteúdo mudou). Nada foi enviado ao
-- Metricool ou à Meta antes de "publishing", então não há o que desfazer lá fora.
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
    if v_since is not null and v_since > now() - interval '10 minutes' then
      raise exception 'post já está sendo gerado' using errcode = '55P03';
    end if;
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
