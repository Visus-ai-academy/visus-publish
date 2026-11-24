"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { reviewPost, transitionPost } from "@/lib/posts/transitions";
import { draftSchema, kindOf, storagePath, validateFiles } from "@/lib/posts/upload";
import { resolveTenant } from "@/lib/tenant";
import { zonedToUtc } from "@/lib/time";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const uuid = z.string().uuid();

function refresh(slug: string) {
  for (const p of ["calendario", "criativos", "aprovacoes"]) revalidatePath(`/${slug}/${p}`);
}

export async function createDraft(slug: string, raw: unknown): Promise<Result<{ postId: string; paths: string[] }>> {
  const { tenant, role, supabase } = await resolveTenant(slug);
  if (!can(role, "edit_content")) return { ok: false, error: "Seu papel não permite agendar posts." };

  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;
  const fileError = validateFiles(input.format, input.files);
  if (fileError) return { ok: false, error: fileError };

  const scheduledAt = zonedToUtc(input.date, input.time, tenant.timezone);
  if (scheduledAt.getTime() < Date.now() + 60_000) return { ok: false, error: "Escolha um horário no futuro." };

  const { data: account } = await supabase
    .from("ig_accounts")
    .select("id, status")
    .eq("tenant_id", tenant.id)
    .eq("id", input.accountId)
    .maybeSingle();
  if (!account) return { ok: false, error: "Conta não encontrada." };
  if (account.status !== "connected") return { ok: false, error: "Esta conta precisa ser reconectada antes de agendar." };

  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      tenant_id: tenant.id,
      ig_account_id: account.id,
      scheduled_at: scheduledAt.toISOString(),
      theme: input.theme,
      format: input.format,
      origin: "upload",
      caption: input.caption || null,
    })
    .select("id")
    .single();
  if (error || !post) return { ok: false, error: "Não foi possível criar o post." };

  return { ok: true, postId: post.id, paths: input.files.map((f, i) => storagePath(tenant.id, post.id, i, f.name)) };
}

const finalizeSchema = z.object({
  postId: uuid,
  files: z.array(z.object({ path: z.string(), type: z.string() })).min(1).max(10),
});

export async function finalizeDraft(slug: string, raw: unknown): Promise<Result<{ status: string }>> {
  const { tenant, role, supabase } = await resolveTenant(slug);
  if (!can(role, "edit_content")) return { ok: false, error: "Seu papel não permite agendar posts." };
  const parsed = finalizeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const { postId, files } = parsed.data;

  const prefix = `${tenant.id}/${postId}/`;
  const rows = files.map((f, i) => ({ tenant_id: tenant.id, post_id: postId, position: i, kind: kindOf(f.type), storage_path: f.path }));
  if (rows.some((r) => !r.kind || !r.storage_path.startsWith(prefix) || r.storage_path.includes(".."))) {
    return { ok: false, error: "Arquivo inválido." };
  }

  const { error } = await supabase.from("post_media").insert(rows.map((r) => ({ ...r, kind: r.kind! })));
  if (error) return { ok: false, error: "Não foi possível salvar os arquivos do post." };

  try {
    const status = await transitionPost(supabase, postId, "scheduled", "criativo enviado");
    refresh(slug);
    return { ok: true, status };
  } catch {
    return { ok: false, error: "Não foi possível agendar o post." };
  }
}

export async function discardDraft(slug: string, postId: string) {
  const { tenant, supabase } = await resolveTenant(slug);
  const id = uuid.parse(postId);
  const { data: files } = await supabase.storage.from("media").list(`${tenant.id}/${id}`);
  if (files?.length) await supabase.storage.from("media").remove(files.map((f) => `${tenant.id}/${id}/${f.name}`));
  await supabase.from("posts").delete().eq("tenant_id", tenant.id).eq("id", id).eq("status", "planned");
}

export async function publishNow(slug: string, postId: string): Promise<Result> {
  const { tenant, role, supabase } = await resolveTenant(slug);
  if (!can(role, "publish")) return { ok: false, error: "Seu papel não permite publicar." };
  const { data } = await supabase
    .from("posts")
    .update({ scheduled_at: new Date().toISOString(), next_attempt_at: null })
    .eq("tenant_id", tenant.id)
    .eq("id", uuid.parse(postId))
    .eq("status", "scheduled")
    .select("id");
  refresh(slug);
  return data?.length ? { ok: true } : { ok: false, error: "Só posts agendados podem ser publicados agora." };
}

export async function cancelSchedule(slug: string, postId: string): Promise<Result> {
  const { role, supabase } = await resolveTenant(slug);
  if (!can(role, "publish")) return { ok: false, error: "Seu papel não permite cancelar." };
  try {
    await transitionPost(supabase, uuid.parse(postId), "planned", "agendamento cancelado");
    refresh(slug);
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível cancelar." };
  }
}

export async function retryPublish(slug: string, postId: string): Promise<Result> {
  const { role, supabase } = await resolveTenant(slug);
  if (!can(role, "publish")) return { ok: false, error: "Seu papel não permite publicar." };
  try {
    await transitionPost(supabase, uuid.parse(postId), "scheduled", "nova tentativa");
    refresh(slug);
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível tentar de novo." };
  }
}

export async function review(slug: string, postId: string, approve: boolean, note?: string): Promise<Result> {
  const { role, supabase } = await resolveTenant(slug);
  if (!can(role, "approve")) return { ok: false, error: "Seu papel não permite aprovar." };
  try {
    await reviewPost(supabase, uuid.parse(postId), approve, note?.slice(0, 500));
    refresh(slug);
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível registrar a decisão." };
  }
}
