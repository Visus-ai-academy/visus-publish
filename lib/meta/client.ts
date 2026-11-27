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
  /**
   * Id da configuração do "Login do Facebook para Empresas" (API do Instagram com login unificado).
   * Apps novos da Meta só têm esse login: a conexão passa pelo facebook.com e a API fica em
   * graph.facebook.com. Sem ele, usa o login do Instagram (graph.instagram.com) dos apps antigos.
   */
  loginConfigId?: string;
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

export function graphHost(cfg: MetaConfig) {
  return cfg.graphBase ?? (cfg.loginConfigId ? "https://graph.facebook.com" : "https://graph.instagram.com");
}

function graph(cfg: MetaConfig, path: string, params: Record<string, string | undefined> = {}) {
  const u = new URL(`${graphHost(cfg)}/${cfg.graphVersion}/${path}`);
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
  if (cfg.loginConfigId) {
    // Login unificado: as permissões e a conta do Instagram vêm da configuração (config_id)
    const u = new URL(`https://www.facebook.com/${cfg.graphVersion}/dialog/oauth`);
    u.searchParams.set("client_id", cfg.appId);
    u.searchParams.set("redirect_uri", cfg.redirectUri);
    u.searchParams.set("config_id", cfg.loginConfigId);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("override_default_response_type", "true");
    u.searchParams.set("state", state);
    return u.toString();
  }
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

// ---------- Login unificado (Login do Facebook para Empresas) ----------

const unifiedTokenSchema = z.object({ access_token: z.string(), expires_in: z.number().optional() });

/** Troca o code pelo token do usuário do sistema da integração (SUAT). Ele não tem renovação. */
export async function exchangeUnifiedCode(cfg: MetaConfig, code: string) {
  return call(
    cfg,
    graph(cfg, "oauth/access_token", { client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: cfg.redirectUri, code }),
    unifiedTokenSchema,
  );
}

const assignedSchema = z.object({
  data: z.array(z.object({ id: z.union([z.string(), z.number()]).transform(String) }).passthrough()),
  paging: z.object({ next: z.string().optional() }).passthrough().optional(),
});

/** Contas do Instagram que a pessoa liberou para o app no login unificado (sem precisar de Página do Facebook). */
export async function assignedInstagramAccounts(cfg: MetaConfig, token: string) {
  const ids: string[] = [];
  let url: string | undefined = graph(cfg, "me/assigned_instagram_accounts", { limit: "50", access_token: token });
  while (url && ids.length < 200) {
    const page: z.infer<typeof assignedSchema> = await call(cfg, url, assignedSchema);
    ids.push(...page.data.map((a) => a.id));
    url = page.paging?.next ? sameHost(cfg, page.paging.next) : undefined;
  }
  const profiles = [];
  for (const id of ids) {
    const p = await call(
      cfg,
      graph(cfg, id, { fields: "id,username,name,profile_picture_url", access_token: token }),
      z.object({ id: z.union([z.string(), z.number()]).transform(String), username: z.string(), name: z.string().optional(), profile_picture_url: z.string().optional() }),
    );
    profiles.push({ user_id: p.id, username: p.username, name: p.name, profile_picture_url: p.profile_picture_url, account_type: "BUSINESS" });
  }
  return profiles;
}

/** A próxima página vem com a URL completa da Meta; nos testes, mantém a base simulada. */
function sameHost(cfg: MetaConfig, next: string) {
  return cfg.graphBase ? next.replace(/^https:\/\/graph\.(instagram|facebook)\.com/, cfg.graphBase) : next;
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

// ---------- Insights (SPEC §4) ----------

const mediaItemSchema = z.object({
  id: z.string(),
  caption: z.string().optional(),
  media_type: z.string().optional(),
  media_product_type: z.string().optional(),
  timestamp: z.string(),
  permalink: z.string().optional(),
});
export type IgMediaItem = z.infer<typeof mediaItemSchema>;

const mediaPageSchema = z.object({
  data: z.array(mediaItemSchema),
  paging: z.object({ next: z.string().optional() }).passthrough().optional(),
});

/** Mídias da conta, das mais novas para as mais antigas, até `since` (ou `max` itens). Stories não entram (a API só lista por 24 h). */
export async function listMedia(cfg: MetaConfig, token: string, igUserId: string, opts: { since: Date; max?: number }) {
  const max = opts.max ?? 200;
  const out: IgMediaItem[] = [];
  let url: string | undefined = graph(cfg, `${igUserId}/media`, {
    fields: "id,caption,media_type,media_product_type,timestamp,permalink",
    limit: "50",
    access_token: token,
  });
  while (url && out.length < max) {
    const page: z.infer<typeof mediaPageSchema> = await call(cfg, url, mediaPageSchema);
    for (const m of page.data) {
      if (new Date(m.timestamp) < opts.since) return out;
      out.push(m);
      if (out.length >= max) return out;
    }
    url = page.paging?.next ? sameHost(cfg, page.paging.next) : undefined;
  }
  return out;
}

const metricValue = z
  .object({
    name: z.string(),
    values: z.array(z.object({ value: z.unknown() })).optional(),
    total_value: z.object({ value: z.unknown().optional(), breakdowns: z.unknown().optional() }).passthrough().optional(),
  })
  .passthrough();
const insightsSchema = z.object({ data: z.array(metricValue) });

function numberOf(m: z.infer<typeof metricValue>): number | null {
  const v = m.total_value?.value ?? m.values?.[m.values.length - 1]?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export const MEDIA_METRICS = ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "profile_visits", "follows"] as const;
export type MediaMetric = (typeof MEDIA_METRICS)[number];
export type MediaMetrics = Partial<Record<MediaMetric, number>>;

/** Métricas que a Meta aceita por tipo de mídia (Reels não tem visitas ao perfil nem seguidores). */
export function metricsFor(productType: string | undefined): MediaMetric[] {
  if (productType === "REELS") return ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"];
  if (productType === "STORY") return ["views", "reach", "shares", "total_interactions", "profile_visits", "follows"];
  return [...MEDIA_METRICS];
}

/**
 * Métricas de uma mídia. A Meta recusa o pedido inteiro se uma métrica não vale para aquele
 * tipo (código 100); nesse caso tenta de novo só com as básicas.
 */
export async function mediaInsights(cfg: MetaConfig, token: string, mediaId: string, productType?: string): Promise<MediaMetrics> {
  const ask = async (metrics: readonly MediaMetric[]) => {
    const r = await call(cfg, graph(cfg, `${mediaId}/insights`, { metric: metrics.join(","), access_token: token }), insightsSchema);
    const out: MediaMetrics = {};
    for (const m of r.data) {
      const n = numberOf(m);
      if (n !== null && (MEDIA_METRICS as readonly string[]).includes(m.name)) out[m.name as MediaMetric] = n;
    }
    return out;
  };
  try {
    return await ask(metricsFor(productType));
  } catch (e) {
    if (e instanceof MetaApiError && e.code === 100) return ask(["reach", "likes", "comments", "saved", "shares"]);
    throw e;
  }
}

export const ACCOUNT_METRICS = ["reach", "views", "profile_views"] as const;
export type AccountDay = Partial<Record<(typeof ACCOUNT_METRICS)[number] | "follower_count", number>>;

/** Totais da conta num dia (since/until em segundos). Cada métrica vai num pedido: uma recusada não derruba as outras. */
export async function accountDay(cfg: MetaConfig, token: string, igUserId: string, since: Date, until: Date): Promise<AccountDay> {
  const out: AccountDay = {};
  const s = String(Math.floor(since.getTime() / 1000));
  const u = String(Math.floor(until.getTime() / 1000));
  for (const metric of ACCOUNT_METRICS) {
    try {
      const r = await call(cfg, graph(cfg, `${igUserId}/insights`, { metric, period: "day", metric_type: "total_value", since: s, until: u, access_token: token }), insightsSchema);
      const n = r.data[0] ? numberOf(r.data[0]) : null;
      if (n !== null) out[metric] = n;
    } catch (e) {
      if (!(e instanceof MetaApiError) || e.transient || e.status === 401 || e.code === 190) throw e;
    }
  }
  try {
    const p = await call(cfg, graph(cfg, igUserId, { fields: "followers_count", access_token: token }), z.object({ followers_count: z.number().optional() }));
    if (typeof p.followers_count === "number") out.follower_count = p.followers_count;
  } catch (e) {
    if (!(e instanceof MetaApiError) || e.transient) throw e;
  }
  return out;
}

const breakdownSchema = z.object({
  results: z.array(z.object({ dimension_values: z.array(z.string()), value: z.number() })).default([]),
});

/** Público dos seguidores (idade, gênero, cidade). Exige conta com volume mínimo de seguidores; sem dados devolve null. */
export async function followerDemographics(cfg: MetaConfig, token: string, igUserId: string): Promise<{ age: Record<string, number>; gender: Record<string, number>; cities: Record<string, number> } | null> {
  const one = async (breakdown: "age" | "gender" | "city") => {
    try {
      const r = await call(cfg, graph(cfg, `${igUserId}/insights`, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown, access_token: token }), insightsSchema);
      const raw = (r.data[0]?.total_value?.breakdowns as unknown[] | undefined)?.[0];
      const parsed = breakdownSchema.safeParse(raw);
      if (!parsed.success) return null;
      return Object.fromEntries(parsed.data.results.map((x) => [x.dimension_values[0], x.value]));
    } catch (e) {
      if (e instanceof MetaApiError && !e.transient && e.status !== 401 && e.code !== 190) return null;
      throw e;
    }
  };
  const [age, gender, cities] = [await one("age"), await one("gender"), await one("city")];
  if (!age && !gender && !cities) return null;
  return { age: age ?? {}, gender: gender ?? {}, cities: cities ?? {} };
}
