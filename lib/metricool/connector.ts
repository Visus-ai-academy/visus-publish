import { z } from "zod";
import { MetricoolApiError, parseBrands, readInstagramStatus, scheduleBody, type MetricoolBrand, type MetricoolPostStatus, type ScheduleInput } from "./client";
import { callTool, listTools, type McpConfig, type McpTool } from "./mcp";

/**
 * Publicação pelo conector (MCP) do Metricool, que funciona no plano Free (até 20 posts/mês).
 * Os nomes e parâmetros das ferramentas não são documentados em detalhe, então lemos o
 * tools/list e montamos os argumentos pelo esquema de cada ferramenta.
 */

const cache = new Map<string, { at: number; tools: McpTool[] }>();

async function tools(cfg: McpConfig, token: string): Promise<McpTool[]> {
  const key = cfg.url ?? "default";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.tools;
  const list = await listTools(cfg, token);
  cache.set(key, { at: Date.now(), tools: list });
  return list;
}

export function clearToolCache() {
  cache.clear();
}

/** Primeira ferramenta cujo nome está na lista de preferidos, ou que casa com o padrão. */
export function pickTool(list: McpTool[], preferred: string[], pattern?: RegExp): McpTool | null {
  for (const name of preferred) {
    const t = list.find((x) => x.name === name);
    if (t) return t;
  }
  return pattern ? (list.find((x) => pattern.test(x.name)) ?? null) : null;
}

function props(tool: McpTool) {
  return Object.keys(tool.inputSchema?.properties ?? {});
}

function firstProp(tool: McpTool, names: string[]) {
  const p = props(tool);
  return names.find((n) => p.includes(n)) ?? null;
}

const BLOG_KEYS = ["blogId", "blog_id", "brandId", "brand_id"];

function blogArg(tool: McpTool, blogId: string): Record<string, unknown> {
  const key = firstProp(tool, BLOG_KEYS) ?? "blog_id";
  const schema = (tool.inputSchema?.properties?.[key] ?? {}) as { type?: string };
  return { [key]: schema.type === "string" ? blogId : Number(blogId) };
}

/** Diferença do fuso para o UTC no instante dado, como "-03:00". */
export function utcOffset(timezone: string, at: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = part.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}

/** Data local com o deslocamento quando a ferramenta pede ISO 8601 com fuso (±HH:MM). */
function isoFor(tool: McpTool, key: string, local: string, timezone: string) {
  const desc = String((tool.inputSchema?.properties?.[key] as { description?: string } | undefined)?.description ?? "");
  if (!/±|[+-]HH:?MM/i.test(desc)) return local;
  const [d, t] = local.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  // Instante aproximado (tratando a hora local como UTC) só para achar o deslocamento do dia.
  return `${local}${utcOffset(timezone, new Date(Date.UTC(y, mo - 1, da, h, mi)))}`;
}

/** Argumentos do agendamento conforme o esquema da ferramenta. */
export function scheduleArgs(tool: McpTool, input: ScheduleInput): Record<string, unknown> {
  const body = scheduleBody(input);
  const args: Record<string, unknown> = { ...blogArg(tool, input.blogId) };
  const p = props(tool);
  const dateKey = firstProp(tool, ["date", "dateTime", "publication_date"]);
  if (dateKey) args[dateKey] = isoFor(tool, dateKey, input.dateTime, input.timezone);
  if (p.includes("timezone")) args.timezone = input.timezone;
  const infoKey = firstProp(tool, ["info", "post", "data", "body"]);
  if (infoKey) {
    const schema = (tool.inputSchema?.properties?.[infoKey] ?? {}) as { type?: string };
    args[infoKey] = schema.type === "string" ? JSON.stringify(body) : body;
  } else {
    Object.assign(args, body);
  }
  return args;
}

const idValue = z.union([z.number(), z.string()]);
const idSchema = z.union([
  z.object({ data: z.object({ id: idValue }).passthrough() }).transform((d) => d.data.id),
  z.object({ id: idValue }).passthrough().transform((d) => d.id),
  z.object({ post: z.object({ id: idValue }).passthrough() }).transform((d) => d.post.id),
]);

function failedText(raw: unknown) {
  return typeof raw === "string" && /^(error|failed)/i.test(raw.trim()) ? raw.trim() : null;
}

function postsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const r = z.object({ data: z.array(z.unknown()).optional(), posts: z.array(z.unknown()).optional() }).passthrough().safeParse(raw);
  return r.success ? (r.data.data ?? r.data.posts ?? []) : [];
}

function idOf(item: unknown) {
  const r = z.object({ id: idValue }).passthrough().safeParse(item);
  return r.success ? String(r.data.id) : null;
}

function idsOf(item: unknown): string[] {
  const r = z.object({ id: idValue.optional(), uuid: idValue.optional() }).passthrough().safeParse(item);
  return r.success ? [r.data.id, r.data.uuid].filter((x) => x !== undefined).map(String) : [];
}

function textOf(item: unknown) {
  const r = z.object({ text: z.string() }).passthrough().safeParse(item);
  return r.success ? r.data.text : null;
}

function localDate(d: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function scheduledAround(cfg: McpConfig, token: string, blogId: string, timezone: string, around: Date) {
  const list = await tools(cfg, token);
  const tool = pickTool(list, ["getScheduledPosts", "get_scheduled_posts", "list_scheduled_posts"], /^(get|list)_?scheduled_?posts$/i);
  if (!tool) throw new MetricoolApiError("O conector do Metricool não tem a ferramenta de posts agendados.", 200, false);
  const args: Record<string, unknown> = { ...blogArg(tool, blogId) };
  const p = props(tool);
  const day = 86_400_000;
  const from = localDate(new Date(around.getTime() - 2 * day), timezone);
  const to = localDate(new Date(around.getTime() + 2 * day), timezone);
  const startKey = firstProp(tool, ["fromDate", "start", "from"]);
  const endKey = firstProp(tool, ["toDate", "end", "to"]);
  // Versão atual pede data e hora ISO com fuso; a antiga pedia só a data (YYYY-MM-DD).
  const withTime = (k: string) => /HH/.test(String((tool.inputSchema?.properties?.[k] as { description?: string } | undefined)?.description ?? ""));
  if (startKey) args[startKey] = withTime(startKey) ? isoFor(tool, startKey, `${from}T00:00:00`, timezone) : from;
  if (endKey) args[endKey] = withTime(endKey) ? isoFor(tool, endKey, `${to}T23:59:59`, timezone) : to;
  if (p.includes("timezone")) args.timezone = timezone;
  if (p.includes("extendedRange")) args.extendedRange = true;
  return postsOf(await callTool(cfg, token, tool.name, args));
}

export async function connectorBrands(cfg: McpConfig, token: string): Promise<MetricoolBrand[]> {
  const list = await tools(cfg, token);
  const tool = pickTool(list, ["getBrandSettings", "getBrands", "get_brands", "list_brands"], /brand/i);
  if (!tool) throw new MetricoolApiError("O conector do Metricool não tem a ferramenta de marcas.", 200, false);
  return parseBrands(await callTool(cfg, token, tool.name, {}));
}

export async function connectorSchedule(cfg: McpConfig, token: string, input: ScheduleInput): Promise<string> {
  const list = await tools(cfg, token);
  const tool = pickTool(list, ["createScheduledPost", "create_scheduled_post", "post_schedule_post", "schedule_post"], /^(create|post)_?schedul(?!.*review)/i);
  if (!tool) throw new MetricoolApiError("O conector do Metricool não tem a ferramenta de agendar post.", 200, false);
  const raw = await callTool(cfg, token, tool.name, scheduleArgs(tool, input));
  const failed = failedText(raw);
  if (failed) throw new MetricoolApiError(`Metricool: ${failed}`, 200, false);
  const parsed = idSchema.safeParse(raw);
  if (parsed.success) return String(parsed.data);

  // Sem id na resposta: procura o post recém-criado pela legenda e horário.
  const posts = await scheduledAround(cfg, token, input.blogId, input.timezone, new Date());
  const match = posts.filter((p) => {
    const r = z.object({ publicationDate: z.object({ dateTime: z.string() }).passthrough() }).passthrough().safeParse(p);
    return textOf(p) === input.text && (!r.success || r.data.publicationDate.dateTime.startsWith(input.dateTime.slice(0, 16)));
  });
  const id = match.length ? idOf(match[match.length - 1]) : null;
  if (!id) throw new MetricoolApiError("O Metricool agendou, mas não devolveu o id do post. Confira no Metricool antes de tentar de novo.", 200, false);
  return id;
}

export async function connectorStatus(cfg: McpConfig, token: string, blogId: string, postId: string, timezone: string, now = new Date()): Promise<MetricoolPostStatus> {
  const posts = await scheduledAround(cfg, token, blogId, timezone, now);
  const found = posts.find((p) => idsOf(p).includes(postId));
  if (!found) return { status: "NOT_FOUND", publicUrl: null, detail: null };
  const st = readInstagramStatus(found);
  return st.status === "UNKNOWN" ? { ...st, status: "PENDING" } : st;
}

export async function connectorDelete(cfg: McpConfig, token: string, blogId: string, postId: string): Promise<void> {
  const list = await tools(cfg, token);
  const tool = pickTool(list, ["deleteScheduledPost", "delete_scheduled_post", "delete_schedule_post", "delete_post"], /^delete/i);
  if (!tool) return; // sem ferramenta de apagar: o post com erro fica no Metricool
  const idKey = firstProp(tool, ["id", "post_id", "postId"]) ?? "id";
  await callTool(cfg, token, tool.name, { ...blogArg(tool, blogId), [idKey]: postId });
}
