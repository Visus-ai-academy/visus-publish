import { z } from "zod";

/**
 * Cliente da Instagram API com login do Instagram (SPEC §4).
 * Sem estado e sem segredo embutido: token e credenciais entram por parâmetro.
 * Só pode ser usado no servidor.
 */

export const META_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
] as const;

export type MetaConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion: string;
  /** Só para testes de ponta a ponta com uma Meta simulada. */
  graphBase?: string;
  fetch?: typeof fetch;
};

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly transient = false,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

const errorBody = z.object({
  error: z.object({
    message: z.string(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    is_transient: z.boolean().optional(),
  }),
});

// Códigos que valem nova tentativa: limite de chamadas, erro temporário, serviço indisponível.
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

async function call<T>(cfg: MetaConfig, url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const f = cfg.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(url, { ...init, cache: "no-store" });
  } catch {
    throw new MetaApiError("Sem conexão com a Meta.", 0, undefined, undefined, true);
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const parsed = errorBody.safeParse(body);
    const err = parsed.success ? parsed.data.error : undefined;
    const transient = res.status >= 500 || err?.is_transient === true || (err?.code !== undefined && TRANSIENT_CODES.has(err.code));
    throw new MetaApiError(err?.message ?? `Erro ${res.status} da Meta.`, res.status, err?.code, err?.error_subcode, transient);
  }
  return schema.parse(body);
}

function graph(cfg: MetaConfig, path: string, params: Record<string, string | undefined> = {}) {
  const u = new URL(`${cfg.graphBase ?? "https://graph.instagram.com"}/${cfg.graphVersion}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

function form(params: Record<string, string | boolean | undefined>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v));
  return { method: "POST", body } satisfies RequestInit;
}

// ---------- OAuth ----------

export function authorizeUrl(cfg: MetaConfig, state: string) {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", cfg.appId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", META_SCOPES.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

const shortTokenSchema = z.union([
  z.object({ access_token: z.string(), user_id: z.union([z.string(), z.number()]) }),
  z.object({ data: z.array(z.object({ access_token: z.string(), user_id: z.union([z.string(), z.number()]) })).min(1) }).transform((d) => d.data[0]),
]);

export async function exchangeCode(cfg: MetaConfig, code: string) {
  return call(cfg, "https://api.instagram.com/oauth/access_token", shortTokenSchema, form({
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
    code,
  }));
}

const longTokenSchema = z.object({ access_token: z.string(), expires_in: z.number() });

export async function toLongLivedToken(cfg: MetaConfig, shortToken: string) {
  const u = new URL("https://graph.instagram.com/access_token");
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", cfg.appSecret);
  u.searchParams.set("access_token", shortToken);
  return call(cfg, u.toString(), longTokenSchema);
}

export async function refreshToken(cfg: MetaConfig, token: string) {
  const u = new URL("https://graph.instagram.com/refresh_access_token");
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", token);
  return call(cfg, u.toString(), longTokenSchema);
}

const profileSchema = z.object({
  user_id: z.union([z.string(), z.number()]).transform(String),
  username: z.string(),
  name: z.string().optional(),
  profile_picture_url: z.string().optional(),
  account_type: z.string().optional(),
});

export async function getProfile(cfg: MetaConfig, token: string) {
  return call(cfg, graph(cfg, "me", { fields: "user_id,username,name,profile_picture_url,account_type", access_token: token }), profileSchema);
}

// ---------- Publicação ----------

export type ContainerInput =
  | { kind: "image"; imageUrl: string; caption?: string; carouselItem?: boolean; aiGenerated?: boolean }
  | { kind: "video"; mediaType: "REELS" | "STORIES" | "VIDEO"; videoUrl: string; caption?: string; carouselItem?: boolean; aiGenerated?: boolean }
  | { kind: "story_image"; imageUrl: string; aiGenerated?: boolean }
  | { kind: "carousel"; children: string[]; caption?: string; aiGenerated?: boolean };

const idSchema = z.object({ id: z.string() });

export async function createContainer(cfg: MetaConfig, token: string, igUserId: string, input: ContainerInput) {
  const common = { access_token: token, is_ai_generated: input.aiGenerated ? true : undefined };
  let params: Record<string, string | boolean | undefined>;
  switch (input.kind) {
    case "image":
      params = { ...common, image_url: input.imageUrl, caption: input.carouselItem ? undefined : input.caption, is_carousel_item: input.carouselItem || undefined };
      break;
    case "video":
      params = {
        ...common,
        media_type: input.carouselItem ? "VIDEO" : input.mediaType,
        video_url: input.videoUrl,
        caption: input.carouselItem || input.mediaType === "STORIES" ? undefined : input.caption,
        is_carousel_item: input.carouselItem || undefined,
      };
      break;
    case "story_image":
      params = { ...common, media_type: "STORIES", image_url: input.imageUrl };
      break;
    case "carousel":
      params = { ...common, media_type: "CAROUSEL", children: input.children.join(","), caption: input.caption };
      break;
  }
  const { id } = await call(cfg, graph(cfg, `${igUserId}/media`), idSchema, form(params));
  return id;
}

const statusSchema = z.object({ status_code: z.enum(["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"]), status: z.string().optional() });

export async function containerStatus(cfg: MetaConfig, token: string, containerId: string) {
  return call(cfg, graph(cfg, containerId, { fields: "status_code,status", access_token: token }), statusSchema);
}

export async function publishContainer(cfg: MetaConfig, token: string, igUserId: string, containerId: string) {
  const { id } = await call(cfg, graph(cfg, `${igUserId}/media_publish`), idSchema, form({ access_token: token, creation_id: containerId }));
  return id;
}

const limitSchema = z.object({
  data: z
    .array(z.object({ quota_usage: z.number(), config: z.object({ quota_total: z.number(), quota_duration: z.number().optional() }).optional() }))
    .min(1),
});

/** Limite de publicação consultado na hora (CLAUDE.md regra 6): nada de número fixo. */
export async function publishingLimit(cfg: MetaConfig, token: string, igUserId: string) {
  const r = await call(cfg, graph(cfg, `${igUserId}/content_publishing_limit`, { fields: "quota_usage,config", access_token: token }), limitSchema);
  const row = r.data[0];
  return { used: row.quota_usage, total: row.config?.quota_total ?? null };
}

const permalinkSchema = z.object({ id: z.string(), permalink: z.string().optional() });

export async function getPermalink(cfg: MetaConfig, token: string, mediaId: string) {
  const r = await call(cfg, graph(cfg, mediaId, { fields: "permalink", access_token: token }), permalinkSchema);
  return r.permalink ?? null;
}
