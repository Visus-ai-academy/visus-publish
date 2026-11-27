import type { SupabaseClient } from "@supabase/supabase-js";
import type { Format } from "@/lib/posts/upload";
import type { Database } from "@/lib/supabase/database.types";
import { pickProvider } from "./caption";
import { healthFlags, mergeFlags } from "./health";
import { captionOutputSchema, captionPrompt, composeCaption, type Brand } from "./prompts/caption";
import { ASPECT, imagePrompt, themesOutputSchema, themesPrompt, toItems, type ThemeItem } from "./prompts/plan";
import { captionProvider, imageProvider, type ProvidersConfig } from "./providers";
import { AiProviderError } from "./providers/types";
import { charge, type Charge } from "./credits";
import { pickVideoProvider } from "./caption";
import { startPostVideo } from "./video";
import { replaceMedia } from "./media";
import { cadenceOutputSchema, cadencePrompt, toSlots } from "./prompts/cadence";
import type { MonthSlot, Slot } from "@/lib/plan/cadence";
import { themeLearnings } from "@/lib/insights/analysis";

type Db = SupabaseClient<Database>;
type Opts = { providers?: ProvidersConfig };
/** Gerar de novo só uma parte, com uma orientação opcional de quem pediu. */
export type RegenerateOpts = { only?: "caption" | "image"; hint?: string };

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
  const [brand, learnings] = await Promise.all([loadBrand(db, tenantId, account.id), themeLearnings(db, tenantId, account.id)]);
  const prompt = themesPrompt({ ...input, username: account.username, brand, learnings });
  const request = { source: "themes", account_id: account.id, month: input.monthLabel, slots: input.slots.length };
  let credits: Charge | null = null;
  try {
    credits = await charge(db, tenantId, { provider: provider.id, task: "caption", model: provider.model });
    const raw = await captionProvider(provider.id, opts.providers).generateCaption({ apiKey: provider.key, model: provider.model, system: prompt.system, user: prompt.user, images: [] });
    const parsed = themesOutputSchema.safeParse(raw);
    if (!parsed.success) throw new AiProviderError("A IA respondeu num formato inesperado. Tente de novo.");
    const items = toItems(parsed.data, input.slots);
    if (!items.length) throw new AiProviderError("A IA não sugeriu temas válidos para este mês. Tente de novo.");
    await logJob(db, { tenant_id: tenantId, task: "caption", provider: provider.id, model: provider.model, status: "succeeded", credits: credits.amount || null, request, result: { items } });
    return items;
  } catch (e) {
    await credits?.refund();
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
  let credits: Charge | null = null;
  try {
    credits = await charge(db, tenantId, { provider: provider.id, task: "caption", model: provider.model });
    const raw = await captionProvider(provider.id, opts.providers).generateCaption({ apiKey: provider.key, model: provider.model, system: prompt.system, user: prompt.user, images: [] });
    const parsed = cadenceOutputSchema.safeParse(raw);
    if (!parsed.success) throw new AiProviderError("A IA respondeu num formato inesperado. Tente de novo.");
    const slots = toSlots(parsed.data);
    if (!slots.length) throw new AiProviderError("A IA não propôs vagas válidas. Tente de novo.");
    await logJob(db, { tenant_id: tenantId, task: "caption", provider: provider.id, model: provider.model, status: "succeeded", credits: credits.amount || null, request, result: { slots } });
    return { slots, reason: parsed.data.motivo };
  } catch (e) {
    await credits?.refund();
    await logJob(db, { tenant_id: tenantId, task: "caption", provider: provider.id, model: provider.model, status: "failed", request, error: publicMessage(e) });
    throw new PlanError(publicMessage(e));
  }
}

/**
 * Gera legenda e arte (ou vídeo, no Reels) de um post planejado que já está em 'generating'.
 * Termina com finish_generation: sucesso → aprovação/agendado (ou 'planned' no Reels sem
 * provedor de vídeo, que espera o vídeo da equipe); erro → 'generation_failed' com a mensagem.
 * Com vídeo, o post continua em 'generating' e a rotina poll-generation termina depois.
 * Cada etapa debita créditos antes de chamar a IA e estorna se ela falhar.
 */
export async function generatePost(db: Db, tenantId: string, postId: string, opts: Opts & RegenerateOpts = {}): Promise<{ status: string; error?: string }> {
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
    const hint = opts.hint?.trim() || undefined;
    const doCaption = opts.only !== "image";
    // No Reels, "a arte" é o vídeo; sem provedor de vídeo ligado, a equipe envia o vídeo
    const videoAi = format === "reels" && opts.only !== "caption" ? await pickVideoProvider(db, tenantId) : null;
    const doImage = format !== "reels" && opts.only !== "caption";
    if (!doCaption && !doImage && !videoAi) {
      throw new PlanError("O vídeo do Reels por IA está desligado. Ligue em Integrações de IA ou envie o vídeo no post.");
    }
    // Só a arte de um carrossel ainda pede o roteiro dos slides à IA de texto
    const needText = doCaption || (doImage && format === "carousel");

    const textAi = needText ? await pickProvider(db, tenantId, "caption") : null;
    const imageAi = doImage ? await pickProvider(db, tenantId, "image") : null;
    if ((needText && !textAi) || (doImage && !imageAi)) throw new PlanError(NO_KEY);

    // 1. Legenda (e roteiro dos slides no carrossel)
    let caption: string | null = null;
    let slides: { titulo: string; texto: string }[] = [];
    let flags: string[] = [];
    if (textAi) {
      const credits = await charge(db, tenantId, { provider: textAi.id, task: "caption", model: textAi.model });
      try {
        const p = captionPrompt({ format, mediaKind: format === "reels" ? "video" : "image", frameCount: 0, theme: post.theme, username: account?.username ?? "", brand, hint: doCaption ? hint : undefined });
        const raw = await captionProvider(textAi.id, opts.providers)
          .generateCaption({ apiKey: textAi.key, model: textAi.model, system: p.system, user: p.user, images: [] })
          .catch((e: unknown) => {
            throw e instanceof AiProviderError ? new AiProviderError(`${doCaption ? "A legenda" : "O roteiro dos slides"} falhou. ${e.message}`, e.status) : e;
          });
        // O tema já vem do planejamento; só a legenda (e os slides) importam aqui
        const parsed = captionOutputSchema.safeParse(raw && typeof raw === "object" ? { ...raw, tema: post.theme } : raw);
        if (!parsed.success) throw new AiProviderError("A IA respondeu num formato inesperado. Tente de novo.");
        slides = parsed.data.slides;
        if (doCaption) {
          caption = composeCaption(parsed.data, format, brand?.default_hashtags ?? []).caption;
          flags = brand?.is_healthcare ? mergeFlags(healthFlags(`${post.theme}\n${caption}`), parsed.data.riscos) : [];
        }
      } catch (e) {
        await credits.refund();
        throw e;
      }
      if (doCaption) {
        await logJob(db, { tenant_id: tenantId, post_id: postId, task: "caption", provider: textAi.id, model: textAi.model, status: "succeeded", credits: credits.amount || null, request: { source: "theme", hint: hint ?? null }, result: { caption, flags } });
      }
    }

    // 2. Arte(s)
    const prompts: string[] = [];
    if (imageAi) {
      if (format === "carousel") {
        const use = slides.length >= 2 ? slides.slice(0, 6) : [{ titulo: post.theme, texto: "" }, { titulo: "Saiba mais", texto: "" }];
        use.forEach((sl, i) => prompts.push(imagePrompt({ theme: post.theme, title: sl.titulo, body: sl.texto, format, brand, hint, slide: { n: i + 1, total: use.length } })));
      } else {
        prompts.push(imagePrompt({ theme: post.theme, title: post.theme, format, brand, hint }));
      }
    }
    // A legenda fica salva mesmo se a arte falhar (gerar de novo sobrescreve)
    if (doCaption && textAi) {
      const { error: capErr } = await db
        .from("posts")
        .update({ caption: caption || null, caption_provider: textAi.id })
        .eq("tenant_id", tenantId)
        .eq("id", postId);
      if (capErr) throw new Error(`posts: ${capErr.message}`);
    }
    if (flags.length) {
      const { error } = await db.rpc("add_post_flags", { p_post: postId, p_flags: flags });
      if (error) throw new Error(`add_post_flags: ${error.message}`);
    }

    const prefix = (e: unknown) =>
      e instanceof AiProviderError ? new AiProviderError(doCaption ? `A legenda foi gerada, mas ${videoAi ? "o vídeo" : "a arte"} falhou. ${e.message}` : `${videoAi ? "O vídeo" : "A arte"} falhou. ${e.message}`, e.status) : e;

    // 3. Vídeo do Reels: começa no provedor e termina depois (poll-generation)
    if (videoAi) {
      try {
        await startPostVideo(db, tenantId, postId, { video: videoAi, theme: post.theme, brand, hint, providers: opts.providers });
      } catch (e) {
        throw prefix(e);
      }
      return { status: "generating" };
    }

    const images = [];
    if (imageAi && prompts.length) {
      const credits = await charge(db, tenantId, { provider: imageAi.id, task: "image", model: imageAi.model, units: prompts.length }).catch((e: unknown) => {
        throw prefix(e);
      });
      try {
        for (const prompt of prompts) images.push(await imageProvider(imageAi.id, opts.providers).generateImage({ apiKey: imageAi.key, model: imageAi.model, prompt, aspect: ASPECT[format] }));
      } catch (e) {
        await credits.refund();
        throw prefix(e);
      }
      await logJob(db, { tenant_id: tenantId, post_id: postId, task: "image", provider: imageAi.id, model: imageAi.model, status: "succeeded", credits: credits.amount || null, request: { images: prompts.length, hint: hint ?? null } });
    }

    // 4. Troca a mídia antiga (gerar de novo) pela nova
    if (images.length) {
      await replaceMedia(
        db,
        tenantId,
        postId,
        images.map((img) => ({ kind: "image" as const, mime: img.mime, bytes: img.bytes })),
      );
      // Nova arte da IA: troca o provedor e mantém o selo de conteúdo gerado por IA
      const { error: upErr } = await db.from("posts").update({ media_provider: imageAi!.id, is_ai_generated: true }).eq("tenant_id", tenantId).eq("id", postId);
      if (upErr) throw new Error(`posts: ${upErr.message}`);
    } else if (!opts.only && format !== "reels") {
      const { error: upErr } = await db.from("posts").update({ media_provider: null, is_ai_generated: false }).eq("tenant_id", tenantId).eq("id", postId);
      if (upErr) throw new Error(`posts: ${upErr.message}`);
    }
    const { data: status, error } = await db.rpc("finish_generation", { p_post: postId });
    if (error) throw new Error(`finish_generation: ${error.message}`);
    return { status: status! };
  } catch (e) {
    return fail(e);
  }
}
