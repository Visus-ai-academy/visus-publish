import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { charge, type Charge } from "./credits";
import { pickProvider } from "./caption";
import { imagePrompt, videoPrompt } from "./prompts/plan";
import type { Brand } from "./prompts/caption";
import { imageProvider, VIDEO_KEY, videoProvider, videoProviderOf, type ProvidersConfig, type VideoProviderId } from "./providers";
import { AiProviderError } from "./providers/types";
import { replaceMedia } from "./media";

type Db = SupabaseClient<Database>;

/** Depois disso o vídeo é dado como perdido e o post volta com erro. */
export const VIDEO_TIMEOUT_MS = 30 * 60_000;

/**
 * Começa o vídeo do Reels no provedor e grava o job 'running' (o post segue em 'generating').
 * Modelos que só animam imagem recebem antes um quadro inicial gerado pela IA de arte.
 */
export async function startPostVideo(
  db: Db,
  tenantId: string,
  postId: string,
  i: { video: { id: VideoProviderId; key: string; model: string }; theme: string; brand: Brand | null; hint?: string; providers?: ProvidersConfig },
): Promise<void> {
  const provider = videoProvider(i.video.id, i.providers);
  const fromImage = provider.needsImage(i.video.model);
  const charges: Charge[] = [];
  try {
    let imageUrl: string | null = null;
    let framePath: string | null = null;
    if (fromImage) {
      const imageAi = await pickProvider(db, tenantId, "image");
      if (!imageAi) throw new AiProviderError("Este modelo de vídeo anima uma imagem, e a IA de arte ainda não foi configurada.");
      charges.push(await charge(db, tenantId, { provider: imageAi.id, task: "image", model: imageAi.model }));
      const img = await imageProvider(imageAi.id, i.providers).generateImage({
        apiKey: imageAi.key,
        model: imageAi.model,
        prompt: imagePrompt({ theme: i.theme, title: i.theme, format: "reels", brand: i.brand, hint: i.hint }).replace(/Escreva na arte[^\n]*\n/, "Sem texto escrito na imagem.\n"),
        aspect: "9:16",
      });
      framePath = `${tenantId}/${postId}/ai-frame-${Date.now().toString(36)}.${img.mime === "image/png" ? "png" : "jpg"}`;
      const up = await db.storage.from("media").upload(framePath, img.bytes, { contentType: img.mime, upsert: true });
      if (up.error) throw new Error(`upload: ${up.error.message}`);
      const signed = await db.storage.from("media").createSignedUrl(framePath, 3600);
      if (signed.error || !signed.data) throw new Error(`signed url: ${signed.error?.message}`);
      imageUrl = signed.data.signedUrl;
    }
    const credits = await charge(db, tenantId, { provider: VIDEO_KEY[i.video.id], task: "video", model: i.video.model });
    charges.push(credits);
    const { externalId } = await provider.startVideo({ apiKey: i.video.key, model: i.video.model, prompt: videoPrompt({ theme: i.theme, brand: i.brand, hint: i.hint, fromImage }), aspect: "9:16", imageUrl });
    const { error } = await db.from("generation_jobs").insert({
      tenant_id: tenantId,
      post_id: postId,
      task: "video",
      provider: i.video.id,
      model: i.video.model,
      status: "running",
      external_id: externalId,
      credits: credits.amount || null,
      request: { hint: i.hint ?? null, frame_path: framePath },
    });
    if (error) throw new Error(`generation_jobs: ${error.message}`);
  } catch (e) {
    for (const c of charges) await c.refund();
    throw e;
  }
}

export type PollResult = { jobId: string; postId: string | null; state: "running" | "done" | "failed"; error?: string };

/**
 * Confere os vídeos em andamento (rotina de minuto em minuto). Vídeo pronto vira a mídia do
 * post e finish_generation decide entre aprovação e agenda; falha estorna os créditos.
 * `db` é service_role: cada job já carrega o tenant_id, usado em todas as escritas.
 */
export async function pollVideoJobs(db: Db, opts: { providers?: ProvidersConfig; now?: number; limit?: number } = {}): Promise<PollResult[]> {
  const now = opts.now ?? Date.now();
  const { data: jobs, error } = await db
    .from("generation_jobs")
    .select("id, tenant_id, post_id, provider, model, external_id, credits, created_at, request")
    .eq("task", "video")
    .eq("status", "running")
    .order("created_at")
    .limit(opts.limit ?? 10);
  if (error) throw new Error(`generation_jobs: ${error.message}`);
  const results: PollResult[] = [];
  for (const job of jobs ?? []) results.push(await pollOne(db, job, now, opts.providers));
  return results;
}

type JobRow = { id: string; tenant_id: string; post_id: string | null; provider: string; model: string | null; external_id: string | null; credits: number | null; created_at: string; request: unknown };

async function pollOne(db: Db, job: JobRow, now: number, providers?: ProvidersConfig): Promise<PollResult> {
  const base = { jobId: job.id, postId: job.post_id };
  /** Marca o job como terminado só se ninguém terminou antes (duas rotinas ao mesmo tempo). */
  const close = async (patch: { status: "succeeded" | "failed"; error?: string; result?: Database["public"]["Tables"]["generation_jobs"]["Update"]["result"] }) => {
    const { data } = await db
      .from("generation_jobs")
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq("tenant_id", job.tenant_id)
      .eq("id", job.id)
      .eq("status", "running")
      .select("id");
    return !!data?.length;
  };
  const failPost = async (message: string, refund: boolean): Promise<PollResult> => {
    if (!(await close({ status: "failed", error: message }))) return { ...base, state: "failed", error: message };
    if (refund && Number(job.credits) > 0) {
      await db.rpc("grant_credits", { p_tenant: job.tenant_id, p_amount: Number(job.credits), p_reason: `Estorno (vídeo não gerado): Vídeo · ${job.model}` });
    }
    if (job.post_id) {
      const { data: post } = await db.from("posts").select("status").eq("tenant_id", job.tenant_id).eq("id", job.post_id).maybeSingle();
      if (post?.status === "generating") await db.rpc("finish_generation", { p_post: job.post_id, p_error: message });
    }
    return { ...base, state: "failed", error: message };
  };

  const id = videoProviderOf(job.provider);
  if (!id || !job.external_id || !job.post_id) return failPost("Pedido de vídeo inválido.", true);

  // Post apagado ou pedido de novo: o vídeo não é mais esperado
  const { data: post } = await db.from("posts").select("status").eq("tenant_id", job.tenant_id).eq("id", job.post_id).maybeSingle();
  if (!post || post.status !== "generating") {
    await close({ status: "failed", error: "o post não espera mais este vídeo" });
    return { ...base, state: "failed", error: "o post não espera mais este vídeo" };
  }

  const { data: key } = await db.rpc("read_ai_key", { p_tenant: job.tenant_id, p_provider: VIDEO_KEY[id] });
  if (!key) return failPost("A chave do provedor de vídeo foi removida antes de o vídeo ficar pronto.", true);

  let status;
  try {
    status = await videoProvider(id, providers).checkVideo({ apiKey: key, externalId: job.external_id });
  } catch (e) {
    if (e instanceof AiProviderError) return failPost(e.message, true);
    console.error("pollVideo", e instanceof Error ? e.message : e);
    status = { state: "running" as const };
  }

  if (status.state === "running") {
    if (now - new Date(job.created_at).getTime() > VIDEO_TIMEOUT_MS) return failPost("O vídeo demorou mais de 30 minutos no provedor. Gere de novo.", true);
    return { ...base, state: "running" };
  }
  if (status.state === "failed") return failPost(status.error, true);

  // Pronto: o primeiro a fechar o job grava a mídia
  if (!(await close({ status: "succeeded", result: { bytes: status.video.bytes.byteLength } }))) return { ...base, state: "done" };
  try {
    await replaceMedia(db, job.tenant_id, job.post_id, [{ kind: "video", mime: status.video.mime, bytes: status.video.bytes }]);
    const framePath = (job.request as { frame_path?: string | null } | null)?.frame_path;
    if (framePath) await db.storage.from("media").remove([framePath]);
    const { error } = await db.from("posts").update({ media_provider: id, is_ai_generated: true }).eq("tenant_id", job.tenant_id).eq("id", job.post_id);
    if (error) throw new Error(`posts: ${error.message}`);
    const fin = await db.rpc("finish_generation", { p_post: job.post_id });
    if (fin.error) throw new Error(`finish_generation: ${fin.error.message}`);
    return { ...base, state: "done" };
  } catch (e) {
    console.error("pollVideo save", e instanceof Error ? e.message : e);
    const message = "O vídeo ficou pronto, mas não foi possível salvá-lo. Gere de novo.";
    await db.from("generation_jobs").update({ status: "failed", error: message }).eq("tenant_id", job.tenant_id).eq("id", job.id);
    if (Number(job.credits) > 0) await db.rpc("grant_credits", { p_tenant: job.tenant_id, p_amount: Number(job.credits), p_reason: `Estorno (vídeo não salvo): Vídeo · ${job.model}` });
    await db.rpc("finish_generation", { p_post: job.post_id, p_error: message });
    return { ...base, state: "failed", error: message };
  }
}
