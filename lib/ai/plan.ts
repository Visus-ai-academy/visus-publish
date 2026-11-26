import type { SupabaseClient } from "@supabase/supabase-js";
import type { Format } from "@/lib/posts/upload";
import type { Database } from "@/lib/supabase/database.types";
import { pickProvider } from "./caption";
import { healthFlags, mergeFlags } from "./health";
import { captionOutputSchema, captionPrompt, composeCaption, type Brand } from "./prompts/caption";
import { ASPECT, imagePrompt, themesOutputSchema, themesPrompt, toItems, type ThemeItem } from "./prompts/plan";
import { captionProvider, imageProvider, type ProvidersConfig } from "./providers";
import { AiProviderError } from "./providers/types";
import { cadenceOutputSchema, cadencePrompt, toSlots } from "./prompts/cadence";
import type { MonthSlot, Slot } from "@/lib/plan/cadence";

type Db = SupabaseClient<Database>;
type Opts = { providers?: ProvidersConfig };

export class PlanError extends Error {}

const NO_KEY = "A geração com IA ainda não foi configurada. Um administrador precisa cadastrar a chave de IA.";
const publicMessage = (e: unknown) => (e instanceof AiProviderError || e instanceof PlanError ? e.message : "Não foi possível gerar agora. Tente de novo.");

async function loadBrand(db: Db, tenantId: string, accountId: string): Promise<Brand | null> {
  const { data } = await db
    .from("brand_profiles")
    .select("tone, audience, forbidden_topics, default_hashtags, is_healthcare, colors, fonts")
    .eq("tenant_id", tenantId)
    .eq("ig_account_id", accountId)
    .maybeSingle();
  return data;
}

async function logJob(db: Db, row: Database["public"]["Tables"]["generation_jobs"]["Insert"]) {
  await db.from("generation_jobs").insert({ ...row, finished_at: new Date().toISOString() });
}

/** Dá um tema para cada vaga da cadência no mês. `db` é service_role e toda query filtra tenant_id. */
export async function suggestThemes(
  db: Db,
  tenantId: string,
  input: { accountId: string; monthLabel: string; slots: MonthSlot[]; existing: string[]; hint?: string; niche?: string | null },
  opts: Opts = {},
): Promise<ThemeItem[]> {
  const { data: account } = await db.from("ig_accounts").select("id, username").eq("tenant_id", tenantId).eq("id", input.accountId).maybeSingle();
  if (!account) throw new PlanError("Conta não encontrada.");
  if (!input.slots.length) throw new PlanError("Não há vagas livres na cadência deste mês.");
  const provider = await pickProvider(db, tenantId, "caption");
  if (!provider) throw new PlanError(NO_KEY);
  const brand = await loadBrand(db, tenantId, account.id);
  const prompt = themesPrompt({ ...input, username: account.username, brand });
  const request = { source: "themes", account_id: account.id, month: input.monthLabel, slots: input.slots.length };
  try {
    const raw = await captionProvider(provider.id, opts.providers).generateCaption({ apiKey: provider.key, model: provider.model, system: prompt.system, user: prompt.user, images: [] });
    const parsed = themesOutputSchema.safeParse(raw);
    if (!parsed.success) throw new AiProviderError("A IA respondeu num formato inesperado. Tente de novo.");
    const items = toItems(parsed.data, input.slots);
    if (!items.length) throw new AiProviderError("A IA não sugeriu temas válidos para este mês. Tente de novo.");
    await logJob(db, { tenant_id: tenantId, task: "caption", provider: provider.id, model: provider.model, status: "succeeded", request, result: { items } });
    return items;
  } catch (e) {
    await logJob(db, { tenant_id: tenantId, task: "caption", provider: provider.id, model: provider.model, status: "failed", request, error: publicMessage(e) });
    throw new PlanError(publicMessage(e));
  }
}

/** Propõe uma cadência semanal pelo nicho. Não salva: a equipe revisa antes. */
export async function suggestCadence(
  db: Db,
  tenantId: string,
  input: { accountId: string; niche: string; hint?: string },
  opts: Opts = {},
): Promise<{ slots: Slot[]; reason: string }> {
  const { data: account } = await db.from("ig_accounts").select("id, username").eq("tenant_id", tenantId).eq("id", input.accountId).maybeSingle();
  if (!account) throw new PlanError("Conta não encontrada.");
  const provider = await pickProvider(db, tenantId, "caption");
  if (!provider) throw new PlanError(NO_KEY);
  const brand = await loadBrand(db, tenantId, account.id);
  const prompt = cadencePrompt({ ...input, username: account.username, brand });
  const request = { source: "cadence", account_id: account.id };
  try {
    const raw = await captionProvider(provider.id, opts.providers).generateCaption({ apiKey: provider.key, model: provider.model, system: prompt.system, user: prompt.user, images: [] });
    const parsed = cadenceOutputSchema.safeParse(raw);
    if (!parsed.success) throw new AiProviderError("A IA respondeu num formato inesperado. Tente de novo.");
    const slots = toSlots(parsed.data);
    if (!slots.length) throw new AiProviderError("A IA não propôs vagas válidas. Tente de novo.");
    await logJob(db, { tenant_id: tenantId, task: "caption", provider: provider.id, model: provider.model, status: "succeeded", request, result: { slots } });
    return { slots, reason: parsed.data.motivo };
  } catch (e) {
    await logJob(db, { tenant_id: tenantId, task: "caption", provider: provider.id, model: provider.model, status: "failed", request, error: publicMessage(e) });
    throw new PlanError(publicMessage(e));
  }
}

/**
 * Gera legenda e arte de um post planejado que já está em 'generating' (begin_generation).
 * Termina sempre com finish_generation: sucesso → aprovação/agendado (ou 'planned' no Reels,
 * que espera o vídeo da equipe); erro → 'generation_failed' com a mensagem.
 */
export async function generatePost(db: Db, tenantId: string, postId: string, opts: Opts = {}): Promise<{ status: string; error?: string }> {
  const { data: post } = await db.from("posts").select("id, theme, format, status, ig_account_id").eq("tenant_id", tenantId).eq("id", postId).maybeSingle();
  if (!post) throw new PlanError("Post não encontrado.");
  if (post.status !== "generating") throw new PlanError("Este post não está em geração.");

  const fail = async (e: unknown) => {
    const message = publicMessage(e);
    if (!(e instanceof AiProviderError || e instanceof PlanError)) console.error("generatePost", e instanceof Error ? e.message : e);
    const { data } = await db.rpc("finish_generation", { p_post: postId, p_error: message });
    return { status: data ?? "generation_failed", error: message };
  };

  try {
    const { data: account } = await db.from("ig_accounts").select("username").eq("tenant_id", tenantId).eq("id", post.ig_account_id).single();
    const brand = await loadBrand(db, tenantId, post.ig_account_id);
    const format = post.format as Format;
    const wantsImage = format !== "reels";

    const textAi = await pickProvider(db, tenantId, "caption");
    const imageAi = wantsImage ? await pickProvider(db, tenantId, "image") : null;
    if (!textAi || (wantsImage && !imageAi)) throw new PlanError(NO_KEY);

    // 1. Legenda (e roteiro dos slides no carrossel)
    const p = captionPrompt({ format, mediaKind: "image", frameCount: 0, theme: post.theme, username: account?.username ?? "", brand });
    const raw = await captionProvider(textAi.id, opts.providers)
      .generateCaption({ apiKey: textAi.key, model: textAi.model, system: p.system, user: p.user, images: [] })
      .catch((e: unknown) => {
        throw e instanceof AiProviderError ? new AiProviderError(`A legenda falhou. ${e.message}`, e.status) : e;
      });
    // O tema já vem do planejamento; só a legenda (e os slides) importam aqui
    const parsed = captionOutputSchema.safeParse(raw && typeof raw === "object" ? { ...raw, tema: post.theme } : raw);
    if (!parsed.success) throw new AiProviderError("A IA respondeu num formato inesperado. Tente de novo.");
    const { caption } = composeCaption(parsed.data, format, brand?.default_hashtags ?? []);
    const flags = brand?.is_healthcare ? mergeFlags(healthFlags(`${post.theme}\n${caption}`), parsed.data.riscos) : [];
    await logJob(db, { tenant_id: tenantId, post_id: postId, task: "caption", provider: textAi.id, model: textAi.model, status: "succeeded", request: { source: "theme" }, result: { caption, flags } });

    // 2. Arte(s)
    const prompts: string[] = [];
    if (imageAi) {
      if (format === "carousel") {
        const slides = parsed.data.slides.length >= 2 ? parsed.data.slides.slice(0, 6) : [{ titulo: post.theme, texto: "" }, { titulo: "Saiba mais", texto: "" }];
        slides.forEach((s, i) => prompts.push(imagePrompt({ theme: post.theme, title: s.titulo, body: s.texto, format, brand, slide: { n: i + 1, total: slides.length } })));
      } else {
        prompts.push(imagePrompt({ theme: post.theme, title: post.theme, format, brand }));
      }
    }
    // A legenda fica salva mesmo se a arte falhar (gerar de novo sobrescreve)
    const { error: capErr } = await db
      .from("posts")
      .update({ caption: caption || null, caption_provider: textAi.id })
      .eq("tenant_id", tenantId)
      .eq("id", postId);
    if (capErr) throw new Error(`posts: ${capErr.message}`);

    const images = [];
    try {
      for (const prompt of prompts) images.push(await imageProvider(imageAi!.id, opts.providers).generateImage({ apiKey: imageAi!.key, model: imageAi!.model, prompt, aspect: ASPECT[format] }));
    } catch (e) {
      if (e instanceof AiProviderError) throw new AiProviderError(`A legenda foi gerada, mas a arte falhou. ${e.message}`, e.status);
      throw e;
    }
    if (imageAi) await logJob(db, { tenant_id: tenantId, post_id: postId, task: "image", provider: imageAi.id, model: imageAi.model, status: "succeeded", request: { images: prompts.length } });

    // 3. Troca a mídia antiga (gerar de novo) pela nova
    if (images.length) {
      const { data: old } = await db.from("post_media").select("storage_path").eq("tenant_id", tenantId).eq("post_id", postId);
      if (old?.length) {
        await db.storage.from("media").remove(old.map((m) => m.storage_path));
        await db.from("post_media").delete().eq("tenant_id", tenantId).eq("post_id", postId);
      }
      const stamp = Date.now().toString(36);
      const rows = [];
      for (const [i, img] of images.entries()) {
        const path = `${tenantId}/${postId}/ai-${stamp}-${String(i).padStart(2, "0")}.${img.mime === "image/png" ? "png" : "jpg"}`;
        const { error } = await db.storage.from("media").upload(path, img.bytes, { contentType: img.mime, upsert: true });
        if (error) throw new Error(`upload: ${error.message}`);
        rows.push({ tenant_id: tenantId, post_id: postId, position: i, kind: "image", storage_path: path });
      }
      const { error } = await db.from("post_media").insert(rows);
      if (error) throw new Error(`post_media: ${error.message}`);
    }

    const { error: upErr } = await db
      .from("posts")
      .update({ caption: caption || null, caption_provider: textAi.id, media_provider: imageAi?.id ?? null, is_ai_generated: images.length > 0 })
      .eq("tenant_id", tenantId)
      .eq("id", postId);
    if (upErr) throw new Error(`posts: ${upErr.message}`);
    if (flags.length) {
      const { error } = await db.rpc("add_post_flags", { p_post: postId, p_flags: flags });
      if (error) throw new Error(`add_post_flags: ${error.message}`);
    }
    const { data: status, error } = await db.rpc("finish_generation", { p_post: postId });
    if (error) throw new Error(`finish_generation: ${error.message}`);
    return { status: status! };
  } catch (e) {
    return fail(e);
  }
}
