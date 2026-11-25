import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MetaApiError, type ContainerInput } from "@/lib/meta/client";
import type { MetaPort } from "@/lib/meta/port";
import { loadMetricoolAuth } from "@/lib/metricool/auth";
import { MetricoolApiError, type InstagramType } from "@/lib/metricool/client";
import type { OAuthConfig } from "@/lib/metricool/oauth";
import type { MetricoolAuth, MetricoolPort } from "@/lib/metricool/port";
import { utcToZoned } from "@/lib/time";

type Db = SupabaseClient<Database>;
type Post = Database["public"]["Tables"]["posts"]["Row"];

export const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = [1, 5, 15];
const SIGNED_URL_SECONDS = 6 * 60 * 60;

export type PublishOptions = {
  db: Db; // service_role
  meta: MetaPort;
  /** Necessário quando alguma conta publica pelo Metricool. */
  metricool?: MetricoolPort;
  /** Login do conector do Metricool (renovação do token). Os testes apontam para um servidor simulado. */
  metricoolOAuth?: OAuthConfig;
  batch?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  videoPollMs?: number[];
};

export type PublishResult = {
  postId: string;
  tenantId: string;
  /** sent = entregue ao Metricool, esperando a confirmação da publicação */
  outcome: "published" | "retry" | "deferred" | "failed" | "sent";
  error?: string;
};

/** Job `publish-due`: pega os posts vencidos com lock e publica. Seguro para rodar em paralelo. */
export async function publishDue(opts: PublishOptions): Promise<PublishResult[]> {
  const { db } = opts;
  await db.rpc("release_stuck_publishing", {});
  const { data: claimed, error } = await db.rpc("claim_due_posts", { p_limit: opts.batch ?? 20 });
  if (error) throw new Error(`claim_due_posts: ${error.message}`);

  // Um cliente não trava os outros: clientes em paralelo, posts do mesmo cliente em sequência.
  const byTenant = new Map<string, Post[]>();
  for (const p of claimed ?? []) byTenant.set(p.tenant_id, [...(byTenant.get(p.tenant_id) ?? []), p]);

  const results = await Promise.all(
    [...byTenant.values()].map(async (posts) => {
      const out: PublishResult[] = [];
      for (const p of posts) out.push(await publishOne(opts, p));
      return out;
    }),
  );
  const confirmed = await confirmMetricool(opts);
  return [...results.flat(), ...confirmed];
}

class PublishFailure extends Error {
  constructor(message: string, readonly kind: "retry" | "failed" | "deferred", readonly retryAt?: Date) {
    super(message);
  }
}

type SignedMedia = { kind: "image" | "video"; url: string };

async function signedMedia(db: Db, post: Post): Promise<SignedMedia[]> {
  const { data: media, error } = await db
    .from("post_media")
    .select("kind, storage_path, position")
    .eq("tenant_id", post.tenant_id)
    .eq("post_id", post.id)
    .order("position");
  if (error) throw new Error(error.message);
  if (!media?.length) throw new PublishFailure("Post sem mídia.", "failed");
  return Promise.all(
    media.map(async (m) => {
      const { data, error: e } = await db.storage.from("media").createSignedUrl(m.storage_path, SIGNED_URL_SECONDS);
      if (e || !data) throw new PublishFailure("Arquivo de mídia não encontrado no armazenamento.", "failed");
      return { kind: m.kind as "image" | "video", url: data.signedUrl };
    }),
  );
}

export async function publishOne(opts: PublishOptions, post: Post): Promise<PublishResult> {
  const { db, meta } = opts;
  const now = opts.now ?? (() => new Date());
  try {
    const { data: account } = await db
      .from("ig_accounts")
      .select("id, ig_user_id, status, publish_via, metricool_blog_id")
      .eq("tenant_id", post.tenant_id)
      .eq("id", post.ig_account_id)
      .single();
    if (!account || account.status !== "connected") throw new PublishFailure("A conta do Instagram precisa ser reconectada.", "failed");
    if (account.publish_via === "metricool") return await publishViaMetricool(opts, post, account.metricool_blog_id!);

    const { data: token } = await db.rpc("read_ig_token", { p_account: account.id });
    if (!token) throw new PublishFailure("A conta do Instagram precisa ser reconectada.", "failed");

    const limit = await meta.publishingLimit(token, account.ig_user_id);
    if (limit.total !== null && limit.used >= limit.total) {
      throw new PublishFailure(
        `Limite de publicações da Meta atingido (${limit.used}/${limit.total} em 24 h). Nova tentativa em 1 hora.`,
        "deferred",
        new Date(now().getTime() + 60 * 60_000),
      );
    }

    let containerId = post.ig_container_id;
    if (containerId) {
      const st = await meta.containerStatus(token, containerId);
      if (st.status_code === "PUBLISHED") {
        throw new PublishFailure("O container já foi publicado. Confira no Instagram antes de tentar de novo.", "failed");
      }
      if (st.status_code !== "FINISHED" && st.status_code !== "IN_PROGRESS") containerId = null; // expirou ou deu erro
    }
    if (!containerId) {
      containerId = await buildContainer(opts, post, token, account.ig_user_id);
      const { error } = await db.rpc("set_ig_container", { p_post: post.id, p_container: containerId });
      if (error) throw new Error(error.message);
    }
    await waitFinished(opts, token, containerId);

    const mediaId = await meta.publishContainer(token, account.ig_user_id, containerId);
    const permalink = await meta.getPermalink(token, mediaId).catch(() => null);
    await finish(db, post.id, "published", { mediaId, permalink });
    return { postId: post.id, tenantId: post.tenant_id, outcome: "published" };
  } catch (e) {
    const f = classify(e, post, now());
    if (e instanceof MetricoolApiError && (e.status === 401 || e.status === 403)) {
      f.message = e.message;
    }
    if (e instanceof MetaApiError && e.code === 190) {
      await db.from("ig_accounts").update({ status: "needs_reauth" }).eq("tenant_id", post.tenant_id).eq("id", post.ig_account_id);
    }
    await finish(db, post.id, f.kind, { error: f.message, retryAt: f.retryAt });
    return { postId: post.id, tenantId: post.tenant_id, outcome: f.kind, error: f.message };
  }
}

const MAX_PROCESSING_ROUNDS = 10;

function classify(e: unknown, post: Post, now: Date): PublishFailure {
  if (e instanceof PublishFailure) {
    if (e.kind === "retry" && post.attempts >= MAX_PROCESSING_ROUNDS) {
      return new PublishFailure("A Meta não terminou de processar o vídeo a tempo.", "failed");
    }
    return e;
  }
  const transient = e instanceof MetaApiError || e instanceof MetricoolApiError ? e.transient : true;
  const message =
    e instanceof MetaApiError
      ? e.code === 190
        ? "O acesso à conta expirou. Reconecte a conta do Instagram."
        : `Meta recusou: ${e.message}`
      : e instanceof MetricoolApiError
        ? `Metricool recusou: ${e.message}`
        : "Erro inesperado ao publicar.";
  if (transient && post.attempts < MAX_ATTEMPTS) {
    const minutes = RETRY_MINUTES[Math.min(post.attempts - 1, RETRY_MINUTES.length - 1)] ?? 15;
    return new PublishFailure(message, "retry", new Date(now.getTime() + minutes * 60_000));
  }
  return new PublishFailure(message, "failed");
}

async function finish(
  db: Db,
  postId: string,
  outcome: "published" | "retry" | "deferred" | "failed",
  x: { error?: string; retryAt?: Date; mediaId?: string; permalink?: string | null },
) {
  const { error } = await db.rpc("finish_publish", {
    p_post: postId,
    p_outcome: outcome,
    p_error: x.error,
    p_retry_at: x.retryAt?.toISOString(),
    p_ig_media_id: x.mediaId,
    p_permalink: x.permalink ?? undefined,
  });
  if (error) throw new Error(`finish_publish: ${error.message}`);
}

async function buildContainer(opts: PublishOptions, post: Post, token: string, igUserId: string): Promise<string> {
  const { db, meta } = opts;
  const urls = await signedMedia(db, post);

  const caption = post.caption ?? undefined;
  const aiGenerated = post.is_ai_generated;
  const one = (input: ContainerInput) => meta.createContainer(token, igUserId, input);

  switch (post.format) {
    case "image": {
      const m = urls[0];
      if (m.kind !== "image") throw new PublishFailure("Post de foto precisa de uma imagem.", "failed");
      return one({ kind: "image", imageUrl: m.url, caption, aiGenerated });
    }
    case "reels": {
      const m = urls[0];
      if (m.kind !== "video") throw new PublishFailure("Reels precisa de um vídeo.", "failed");
      return one({ kind: "video", mediaType: "REELS", videoUrl: m.url, caption, aiGenerated });
    }
    case "story": {
      const m = urls[0];
      return m.kind === "video"
        ? one({ kind: "video", mediaType: "STORIES", videoUrl: m.url, aiGenerated })
        : one({ kind: "story_image", imageUrl: m.url, aiGenerated });
    }
    case "carousel": {
      if (urls.length < 2 || urls.length > 10) throw new PublishFailure("Carrossel precisa de 2 a 10 arquivos.", "failed");
      const children: string[] = [];
      for (const m of urls) {
        const id =
          m.kind === "video"
            ? await one({ kind: "video", mediaType: "VIDEO", videoUrl: m.url, carouselItem: true, aiGenerated })
            : await one({ kind: "image", imageUrl: m.url, carouselItem: true, aiGenerated });
        if (m.kind === "video") await waitFinished(opts, token, id);
        children.push(id);
      }
      return one({ kind: "carousel", children, caption, aiGenerated });
    }
  }
}

/** Vídeo precisa terminar o processamento na Meta antes do media_publish. */
async function waitFinished(opts: PublishOptions, token: string, containerId: string) {
  const delays = opts.videoPollMs ?? [0, 3_000, 5_000, 10_000, 15_000, 30_000, 30_000, 30_000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (const d of delays) {
    if (d) await sleep(d);
    const st = await opts.meta.containerStatus(token, containerId);
    if (st.status_code === "FINISHED") return;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
      throw new PublishFailure(`A Meta não processou a mídia (${st.status ?? st.status_code}).`, "failed");
    }
    if (st.status_code === "PUBLISHED") throw new PublishFailure("O container já foi publicado.", "failed");
  }
  // Ainda processando: o container fica salvo e a próxima rodada continua dele.
  throw new PublishFailure("A Meta ainda está processando o vídeo.", "retry", new Date(Date.now() + 2 * 60_000));
}

// ---------------- Metricool ----------------

const METRICOOL_TYPE: Record<Post["format"], InstagramType> = { image: "POST", carousel: "POST", reels: "REEL", story: "STORY" };
/** O Metricool só aceita horário no futuro: entregamos com essa folga e ele publica no ciclo seguinte. */
const METRICOOL_LEAD_MS = 2 * 60_000;

async function metricoolCreds(opts: PublishOptions, tenantId: string): Promise<MetricoolAuth> {
  const auth = await loadMetricoolAuth(opts.db, tenantId, { oauth: opts.metricoolOAuth, now: opts.now?.() });
  if (!auth) throw new PublishFailure("Conecte o Metricool deste cliente na tela Contas do Instagram.", "failed");
  return auth;
}

async function tenantTimezone(db: Db, tenantId: string) {
  const { data } = await db.from("tenants").select("timezone").eq("id", tenantId).single();
  return data?.timezone ?? "America/Sao_Paulo";
}

/**
 * O conector do Metricool só lista posts agendados: quando o post some da lista depois
 * do horário, ele saiu. Esperamos esse tempo antes de concluir, para não confundir com
 * um atraso da própria lista.
 */
const NOT_FOUND_GRACE_MS = 5 * 60_000;

function requireMetricool(opts: PublishOptions): MetricoolPort {
  if (!opts.metricool) throw new PublishFailure("Publicação pelo Metricool não está configurada no servidor.", "failed");
  return opts.metricool;
}

async function publishViaMetricool(opts: PublishOptions, post: Post, blogId: string): Promise<PublishResult> {
  const { db } = opts;
  const metricool = requireMetricool(opts);
  const now = opts.now ?? (() => new Date());
  const creds = await metricoolCreds(opts, post.tenant_id);
  const tz = await tenantTimezone(db, post.tenant_id);
  const sent = (): PublishResult => ({ postId: post.id, tenantId: post.tenant_id, outcome: "sent" });

  // Nova tentativa de um post já entregue: nunca cria outro se o anterior saiu ou ainda vai sair.
  if (post.external_post_id && post.publish_provider === "metricool") {
    const st = await metricool.getPostStatus(creds, blogId, post.external_post_id, tz);
    // Sumiu da lista de agendados: já saiu. Nunca cria outro.
    if (st.status === "PUBLISHED" || st.status === "NOT_FOUND") {
      await finish(db, post.id, "published", { permalink: st.publicUrl });
      return { postId: post.id, tenantId: post.tenant_id, outcome: "published" };
    }
    if (st.status !== "ERROR") {
      await setExternal(db, post.id, post.external_post_id);
      return sent();
    }
    await metricool.deletePost(creds, blogId, post.external_post_id).catch(() => undefined);
  }

  const files = await signedMedia(db, post);
  if (post.format === "carousel" && (files.length < 2 || files.length > 10)) throw new PublishFailure("Carrossel precisa de 2 a 10 arquivos.", "failed");
  if (post.format === "reels" && files[0].kind !== "video") throw new PublishFailure("Reels precisa de um vídeo.", "failed");
  if (post.format === "image" && files[0].kind !== "image") throw new PublishFailure("Post de foto precisa de uma imagem.", "failed");

  // URL assinada expira; o Metricool precisa de uma cópia própria da mídia.
  const media = await Promise.all(
    files.map(async (f) => {
      try {
        return await metricool.normalizeMedia(creds, blogId, f.url);
      } catch (e) {
        if (e instanceof MetricoolApiError && (e.status === 401 || e.status === 403)) throw e;
        return f.url; // saveExternalMediaFiles faz o Metricool copiar a partir da URL assinada
      }
    }),
  );

  const at = utcToZoned(new Date(now().getTime() + METRICOOL_LEAD_MS), tz);

  const externalId = await metricool.schedulePost(creds, {
    blogId,
    dateTime: `${at.date}T${at.time}:00`,
    timezone: tz,
    text: post.format === "story" ? "" : (post.caption ?? ""),
    media,
    type: METRICOOL_TYPE[post.format],
    aiGenerated: post.is_ai_generated,
  });
  await setExternal(db, post.id, externalId);
  return sent();
}

async function setExternal(db: Db, postId: string, externalId: string) {
  const { error } = await db.rpc("set_external_post", { p_post: postId, p_provider: "metricool", p_external_id: externalId });
  if (error) throw new Error(error.message);
}

/** Confirma no Metricool os posts entregues: publicado, erro ou ainda esperando. */
export async function confirmMetricool(opts: PublishOptions): Promise<PublishResult[]> {
  const { db, metricool } = opts;
  if (!metricool) return [];
  const { data: awaiting, error } = await db.rpc("claim_awaiting_confirmation", { p_limit: 50 });
  if (error) throw new Error(`claim_awaiting_confirmation: ${error.message}`);

  const out: PublishResult[] = [];
  for (const post of awaiting ?? []) {
    try {
      const { data: account } = await db
        .from("ig_accounts")
        .select("metricool_blog_id")
        .eq("tenant_id", post.tenant_id)
        .eq("id", post.ig_account_id)
        .single();
      if (!account?.metricool_blog_id || !post.external_post_id) continue;
      const creds = await metricoolCreds(opts, post.tenant_id);
      const st = await metricool.getPostStatus(creds, account.metricool_blog_id, post.external_post_id, await tenantTimezone(db, post.tenant_id));
      const now = (opts.now ?? (() => new Date()))().getTime();
      const startedAt = post.publishing_started_at ? new Date(post.publishing_started_at).getTime() : now;
      if (st.status === "PUBLISHED" || (st.status === "NOT_FOUND" && now - startedAt >= NOT_FOUND_GRACE_MS)) {
        await finish(db, post.id, "published", { permalink: st.publicUrl });
        out.push({ postId: post.id, tenantId: post.tenant_id, outcome: "published" });
      } else if (st.status === "ERROR") {
        const message = `Metricool não publicou: ${st.detail ?? "erro sem detalhe"}`;
        await finish(db, post.id, "failed", { error: message });
        out.push({ postId: post.id, tenantId: post.tenant_id, outcome: "failed", error: message });
      }
    } catch {
      // Falha ao consultar não muda o post; a próxima rodada consulta de novo e o
      // release_stuck_publishing encerra depois de 3 h sem confirmação.
    }
  }
  return out;
}
