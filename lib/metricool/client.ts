import { z } from "zod";

/**
 * Cliente da API do Metricool (https://app.metricool.com/api), usado para publicar
 * enquanto o app da Meta não é liberado. Requer plano Advanced ou Custom.
 *
 * Partes da API não estão documentadas publicamente (resposta da criação, tipos do
 * instagramData além de REEL, resposta do normalize). Os parsers abaixo aceitam as
 * formas mais prováveis e falham com mensagem clara quando a resposta não bate,
 * para ajustar na primeira publicação real.
 */

export type MetricoolCredentials = { userId: string; token: string };
export type MetricoolConfig = { baseUrl?: string; fetch?: typeof fetch };

export class MetricoolApiError extends Error {
  constructor(message: string, readonly status: number, readonly transient: boolean) {
    super(message);
    this.name = "MetricoolApiError";
  }
}

const BASE = "https://app.metricool.com/api";

async function call(cfg: MetricoolConfig, creds: MetricoolCredentials, method: string, path: string, query: Record<string, string> = {}, body?: unknown) {
  const u = new URL(`${cfg.baseUrl ?? BASE}${path}`);
  u.searchParams.set("userId", creds.userId);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  const f = cfg.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(u.toString(), {
      method,
      cache: "no-store",
      headers: { "X-Mc-Auth": creds.token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new MetricoolApiError("Sem conexão com o Metricool.", 0, true);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text; // o normalize pode devolver a URL como texto puro
  }
  if (!res.ok) {
    const msg =
      res.status === 401 || res.status === 403
        ? "O Metricool recusou o acesso. Confira o token e o userId, e se o plano inclui API."
        : typeof json === "object" && json && "message" in json
          ? String((json as { message: unknown }).message)
          : `Erro ${res.status} do Metricool.`;
    throw new MetricoolApiError(msg, res.status, res.status === 429 || res.status >= 500);
  }
  return json;
}

// ---------- Marcas ----------

const profileSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    blogId: z.union([z.number(), z.string()]).optional(),
    blog_id: z.union([z.number(), z.string()]).optional(),
    label: z.string().nullish(),
    title: z.string().nullish(),
    instagram: z.string().nullish(),
    instagramUsername: z.string().nullish(),
    instagram_username: z.string().nullish(),
    name: z.string().nullish(),
  })
  .passthrough();

export type MetricoolBrand = { blogId: string; label: string; instagram: string | null };

export async function listBrands(cfg: MetricoolConfig, creds: MetricoolCredentials): Promise<MetricoolBrand[]> {
  return parseBrands(await call(cfg, creds, "GET", "/admin/simpleProfiles"));
}

/** Aceita a lista da API ou do conector: array direto ou em `data`/`brands`. */
export function parseBrands(raw: unknown): MetricoolBrand[] {
  const wrapped = z.object({ data: z.array(z.unknown()).optional(), brands: z.array(z.unknown()).optional() }).passthrough().safeParse(raw);
  const list = Array.isArray(raw) ? raw : wrapped.success ? (wrapped.data.data ?? wrapped.data.brands ?? []) : [];
  return list.flatMap((item) => {
    const p = profileSchema.safeParse(item);
    if (!p.success) return [];
    const blogId = p.data.blogId ?? p.data.blog_id ?? p.data.id;
    if (blogId === undefined) return [];
    const ig = p.data.instagram ?? p.data.instagramUsername ?? p.data.instagram_username ?? null;
    return [{ blogId: String(blogId), label: p.data.label ?? p.data.title ?? p.data.name ?? `Marca ${blogId}`, instagram: ig ? ig.replace(/^@/, "") : null }];
  });
}

// ---------- Mídia ----------

/** Pede ao Metricool uma cópia permanente da mídia (nossas URLs assinadas expiram). */
export async function normalizeMedia(cfg: MetricoolConfig, creds: MetricoolCredentials, blogId: string, url: string): Promise<string> {
  const raw = await call(cfg, creds, "GET", "/actions/normalize/image/url", { blogId, url });
  if (typeof raw === "string" && /^https?:\/\//.test(raw.trim())) return raw.trim();
  const obj = z.object({ url: z.string().optional(), data: z.string().optional(), mediaUrl: z.string().optional() }).passthrough().safeParse(raw);
  const found = obj.success ? (obj.data.url ?? obj.data.mediaUrl ?? obj.data.data) : undefined;
  if (!found) throw new MetricoolApiError("Resposta inesperada do Metricool ao preparar a mídia.", 200, false);
  return found;
}

// ---------- Posts ----------

export type InstagramType = "POST" | "REEL" | "STORY";

export type ScheduleInput = {
  blogId: string;
  /** Data e hora locais (sem fuso) e o fuso IANA, como a API espera. */
  dateTime: string;
  timezone: string;
  text: string;
  media: string[];
  type: InstagramType;
};

export function scheduleBody(input: ScheduleInput) {
  return {
    publicationDate: { dateTime: input.dateTime, timezone: input.timezone },
    text: input.text,
    providers: [{ network: "instagram" }],
    media: input.media,
    saveExternalMediaFiles: true,
    autoPublish: true, // sem isso o Instagram só manda notificação para o celular
    draft: false,
    instagramData: { type: input.type, autoPublish: true },
  };
}

const idValue = z.union([z.number(), z.string()]);
const idSchema = z.union([
  z.object({ data: z.object({ id: idValue }).passthrough() }).transform((d) => d.data.id),
  z.object({ id: idValue }).passthrough().transform((d) => d.id),
]);

export async function schedulePost(cfg: MetricoolConfig, creds: MetricoolCredentials, input: ScheduleInput): Promise<string> {
  const raw = await call(cfg, creds, "POST", "/v2/scheduler/posts", { blogId: input.blogId }, scheduleBody(input));
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new MetricoolApiError("O Metricool não devolveu o id do post agendado.", 200, false);
  return String(parsed.data);
}

/** NOT_FOUND: o conector não acha mais o post entre os agendados (em geral porque já saiu). */
export type MetricoolPostStatus = { status: "PENDING" | "PUBLISHING" | "PUBLISHED" | "ERROR" | "UNKNOWN" | "NOT_FOUND"; publicUrl: string | null; detail: string | null };

const providerSchema = z
  .object({
    network: z.string().optional(),
    status: z.string().optional(),
    publicUrl: z.string().nullish(),
    detailedStatus: z.string().nullish(),
  })
  .passthrough();

export function readInstagramStatus(raw: unknown): MetricoolPostStatus {
  const root = raw && typeof raw === "object" && "data" in raw ? (raw as { data: unknown }).data : raw;
  const providers = z.object({ providers: z.array(z.unknown()) }).passthrough().safeParse(root);
  const list = providers.success ? providers.data.providers.map((p) => providerSchema.safeParse(p)).flatMap((p) => (p.success ? [p.data] : [])) : [];
  const ig = list.find((p) => p.network?.toLowerCase() === "instagram") ?? list[0];
  const known = ["PENDING", "PUBLISHING", "PUBLISHED", "ERROR"] as const;
  const st = (ig?.status ?? "").toUpperCase();
  return {
    status: (known as readonly string[]).includes(st) ? (st as MetricoolPostStatus["status"]) : "UNKNOWN",
    publicUrl: ig?.publicUrl || null,
    detail: ig?.detailedStatus || null,
  };
}

export async function getPostStatus(cfg: MetricoolConfig, creds: MetricoolCredentials, blogId: string, postId: string) {
  return readInstagramStatus(await call(cfg, creds, "GET", `/v2/scheduler/posts/${encodeURIComponent(postId)}`, { blogId }));
}

export async function deletePost(cfg: MetricoolConfig, creds: MetricoolCredentials, blogId: string, postId: string) {
  await call(cfg, creds, "DELETE", `/v2/scheduler/posts/${encodeURIComponent(postId)}`, { blogId });
}
