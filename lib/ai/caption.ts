import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { FORMATS } from "@/lib/posts/upload";
import type { Database } from "@/lib/supabase/database.types";
import { healthFlags, mergeFlags } from "./health";
import { captionOutputSchema, captionPrompt, composeCaption, type CaptionPromptInput } from "./prompts/caption";
import { openaiTranscribe } from "./providers/openai";
import {
  CAPTION_PROVIDERS,
  captionProvider,
  providerOf,
  VIDEO_KEY,
  VIDEO_PROVIDERS,
  videoProviderOf,
  type CaptionProviderId,
  type ProvidersConfig,
  type VideoProviderId,
} from "./providers";
import { AiProviderError, type ImagePart } from "./providers/types";
import { charge, withCredits } from "./credits";

type Db = SupabaseClient<Database>;

/** Limite por imagem já reduzida no navegador (base64). */
const MAX_FRAME_CHARS = 700_000;
/** 3 min de WAV 16 kHz mono em base64 (~7,7 MB). */
const MAX_AUDIO_CHARS = 8_000_000;

export const suggestInputSchema = z.object({
  accountId: z.string().uuid("Escolha a conta."),
  format: z.enum(FORMATS),
  mediaKind: z.enum(["image", "video"]),
  hint: z.string().trim().max(300).optional(),
  frames: z
    .array(
      z
        .string()
        .regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/, "Imagem inválida.")
        .max(MAX_FRAME_CHARS, "Imagem grande demais."),
    )
    .min(1, "Escolha o arquivo antes de gerar.")
    .max(6),
  audio: z
    .string()
    .regex(/^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/, "Áudio inválido.")
    .max(MAX_AUDIO_CHARS, "Áudio longo demais.")
    .nullish(),
});
export type SuggestInput = z.infer<typeof suggestInputSchema>;

export type Suggestion = { jobId: string; theme: string; caption: string; flags: string[]; provider: CaptionProviderId };

export class SuggestError extends Error {}

function toPart(dataUrl: string): ImagePart {
  const [head, base64] = dataUrl.split(",", 2);
  return { mime: head.includes("png") ? "image/png" : "image/jpeg", base64 };
}

/** Escolhe o provedor da tarefa: o padrão do cliente, ou o outro se só ele tiver chave. */
export async function pickProvider(db: Db, tenantId: string, task: "caption" | "image" = "caption"): Promise<{ id: CaptionProviderId; key: string; model: string } | null> {
  const [{ data: settings }, { data: models }] = await Promise.all([
    db.from("ai_settings").select("default_caption_provider, default_image_provider").eq("tenant_id", tenantId).maybeSingle(),
    db.from("ai_models").select("provider, model").eq("task", task).eq("active", true),
  ]);
  const preferred = providerOf(task === "image" ? settings?.default_image_provider : settings?.default_caption_provider);
  const order = [...CAPTION_PROVIDERS].sort((a, b) => Number(b === preferred) - Number(a === preferred));
  for (const id of order) {
    const model = models?.find((m) => m.provider === id)?.model;
    if (!model) continue;
    const { data: key, error } = await db.rpc("read_ai_key", { p_tenant: tenantId, p_provider: id });
    if (error) throw new Error(`read_ai_key: ${error.message}`);
    if (key) return { id, key, model };
  }
  return null;
}

/** Provedor de vídeo escolhido pelo cliente (desligado = null). Se ele não tiver chave, tenta o outro. */
export async function pickVideoProvider(db: Db, tenantId: string): Promise<{ id: VideoProviderId; key: string; model: string } | null> {
  const [{ data: settings }, { data: models }] = await Promise.all([
    db.from("ai_settings").select("default_video_provider").eq("tenant_id", tenantId).maybeSingle(),
    db.from("ai_models").select("provider, model").eq("task", "video").eq("active", true),
  ]);
  const preferred = videoProviderOf(settings?.default_video_provider);
  if (!preferred) return null;
  const order = [...VIDEO_PROVIDERS].sort((a, b) => Number(b === preferred) - Number(a === preferred));
  for (const id of order) {
    const model = models?.find((m) => m.provider === VIDEO_KEY[id])?.model;
    if (!model) continue;
    const { data: key, error } = await db.rpc("read_ai_key", { p_tenant: tenantId, p_provider: VIDEO_KEY[id] });
    if (error) throw new Error(`read_ai_key: ${error.message}`);
    if (key) return { id, key, model };
  }
  return null;
}

/**
 * Gera tema e legenda a partir da mídia (imagem, ou quadros do vídeo).
 * `db` é service_role: toda query filtra tenant_id. Grava o pedido em generation_jobs
 * (sem as imagens) e devolve os alertas de publicidade médica quando a marca é de saúde.
 */
export async function suggestCaption(db: Db, tenantId: string, input: SuggestInput, opts: { providers?: ProvidersConfig } = {}): Promise<Suggestion> {
  const { data: account } = await db
    .from("ig_accounts")
    .select("id, username")
    .eq("tenant_id", tenantId)
    .eq("id", input.accountId)
    .maybeSingle();
  if (!account) throw new SuggestError("Conta não encontrada.");
  const { data: brand } = await db
    .from("brand_profiles")
    .select("tone, audience, forbidden_topics, default_hashtags, is_healthcare")
    .eq("tenant_id", tenantId)
    .eq("ig_account_id", account.id)
    .maybeSingle();

  const provider = await pickProvider(db, tenantId);
  if (!provider) throw new SuggestError("A geração com IA ainda não foi configurada. Um administrador precisa cadastrar a chave de IA.");

  const audioB64 = input.mediaKind === "video" && input.audio ? input.audio.split(",", 2)[1] : null;
  // Débito antes de chamar a IA; sem saldo, para aqui com a mensagem para o cliente
  const credits = await charge(db, tenantId, { provider: provider.id, task: "caption", model: provider.model }).catch((e: unknown) => {
    throw e instanceof AiProviderError ? new SuggestError(e.message) : e;
  });
  const { data: job, error: jobErr } = await db
    .from("generation_jobs")
    .insert({
      tenant_id: tenantId,
      task: "caption",
      provider: provider.id,
      model: provider.model,
      status: "running",
      credits: credits.amount || null,
      request: { source: "media", format: input.format, media_kind: input.mediaKind, frames: input.frames.length, audio: !!audioB64, account_id: account.id, hint: input.hint ?? null },
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    await credits.refund();
    throw new Error(`generation_jobs: ${jobErr?.message}`);
  }

  const finish = (patch: Database["public"]["Tables"]["generation_jobs"]["Update"]) =>
    db.from("generation_jobs").update({ ...patch, finished_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", job.id);

  try {
    // Gemini ouve o áudio direto; na OpenAI ele vira texto antes (modelo de transcrição em ai_models)
    let audio: CaptionPromptInput["audio"] = null;
    if (audioB64 && provider.id === "gemini") audio = { heard: true };
    else if (audioB64) {
      const { data: m } = await db.from("ai_models").select("model").eq("provider", "openai").eq("task", "transcription").eq("active", true).limit(1).maybeSingle();
      if (m) {
        // Sem transcrição a legenda ainda sai pelos quadros; não derruba a geração (nem por falta de saldo)
        const transcript = await withCredits(db, tenantId, { provider: "openai", task: "transcription", model: m.model }, () =>
          openaiTranscribe(opts.providers?.openai ?? {}, { apiKey: provider.key, model: m.model, base64: audioB64 }),
        ).catch((e) => {
          console.error("transcrição", e instanceof Error ? e.message : e);
          return "";
        });
        if (transcript) audio = { transcript };
      }
    }
    const prompt = captionPrompt({ format: input.format, mediaKind: input.mediaKind, frameCount: input.frames.length, username: account.username, hint: input.hint, brand, audio });
    const raw = await captionProvider(provider.id, opts.providers).generateCaption({
      apiKey: provider.key,
      model: provider.model,
      system: prompt.system,
      user: prompt.user,
      images: input.frames.map(toPart),
      audio: audio && "heard" in audio ? { mime: "audio/wav", base64: audioB64! } : null,
    });
    const parsed = captionOutputSchema.safeParse(raw);
    if (!parsed.success) throw new AiProviderError("A IA respondeu num formato inesperado. Tente de novo.");
    const { theme, caption } = composeCaption(parsed.data, input.format, brand?.default_hashtags ?? []);
    const flags = brand?.is_healthcare ? mergeFlags(healthFlags(`${theme}\n${caption}`), parsed.data.riscos) : [];
    await finish({ status: "succeeded", result: { theme, caption, flags, audio: audio ? ("heard" in audio ? "heard" : "transcribed") : null } });
    return { jobId: job.id, theme, caption, flags, provider: provider.id };
  } catch (e) {
    const message = e instanceof AiProviderError ? e.message : "Não foi possível gerar agora. Tente de novo.";
    await credits.refund();
    await finish({ status: "failed", error: message });
    throw new SuggestError(message);
  }
}

/** Alertas que o servidor confirma para o texto final do post (marca de saúde). */
export async function complianceFor(db: Db, tenantId: string, accountId: string, text: string, aiJobId?: string | null): Promise<{ flags: string[]; job: { provider: string } | null }> {
  const [{ data: brand }, jobRes] = await Promise.all([
    db.from("brand_profiles").select("is_healthcare").eq("tenant_id", tenantId).eq("ig_account_id", accountId).maybeSingle(),
    aiJobId
      ? db.from("generation_jobs").select("provider, result").eq("tenant_id", tenantId).eq("id", aiJobId).eq("task", "caption").eq("status", "succeeded").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const job = jobRes.data;
  if (!brand?.is_healthcare) return { flags: [], job };
  const aiFlags = (job?.result as { flags?: string[] } | null)?.flags ?? [];
  return { flags: mergeFlags(healthFlags(text), aiFlags), job };
}
