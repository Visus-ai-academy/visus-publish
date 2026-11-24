import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MetaApiError, type ContainerInput } from "@/lib/meta/client";
import type { MetaPort } from "@/lib/meta/port";

type Db = SupabaseClient<Database>;
type Post = Database["public"]["Tables"]["posts"]["Row"];

export const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = [1, 5, 15];
const SIGNED_URL_SECONDS = 6 * 60 * 60;

export type PublishOptions = {
  db: Db; // service_role
  meta: MetaPort;
  batch?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  videoPollMs?: number[];
};

export type PublishResult = { postId: string; tenantId: string; outcome: "published" | "retry" | "deferred" | "failed"; error?: string };

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
  return results.flat();
}

class PublishFailure extends Error {
  constructor(message: string, readonly kind: "retry" | "failed" | "deferred", readonly retryAt?: Date) {
    super(message);
  }
}

export async function publishOne(opts: PublishOptions, post: Post): Promise<PublishResult> {
  const { db, meta } = opts;
  const now = opts.now ?? (() => new Date());
  try {
    const { data: account } = await db
      .from("ig_accounts")
      .select("id, ig_user_id, status")
      .eq("tenant_id", post.tenant_id)
      .eq("id", post.ig_account_id)
      .single();
    if (!account || account.status !== "connected") throw new PublishFailure("A conta do Instagram precisa ser reconectada.", "failed");

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
  const transient = e instanceof MetaApiError ? e.transient : true;
  const message =
    e instanceof MetaApiError
      ? e.code === 190
        ? "O acesso à conta expirou. Reconecte a conta do Instagram."
        : `Meta recusou: ${e.message}`
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
  const { data: media, error } = await db
    .from("post_media")
    .select("kind, storage_path, position")
    .eq("tenant_id", post.tenant_id)
    .eq("post_id", post.id)
    .order("position");
  if (error) throw new Error(error.message);
  if (!media?.length) throw new PublishFailure("Post sem mídia.", "failed");

  const urls = await Promise.all(
    media.map(async (m) => {
      const { data, error: e } = await db.storage.from("media").createSignedUrl(m.storage_path, SIGNED_URL_SECONDS);
      if (e || !data) throw new PublishFailure("Arquivo de mídia não encontrado no armazenamento.", "failed");
      return { kind: m.kind as "image" | "video", url: data.signedUrl };
    }),
  );

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
