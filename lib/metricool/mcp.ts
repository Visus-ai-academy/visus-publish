import { z } from "zod";
import { MetricoolApiError } from "./client";

/**
 * Cliente MCP mínimo (Streamable HTTP, JSON-RPC 2.0) para o conector do Metricool
 * em https://ai.metricool.com/mcp. Funciona em qualquer plano, inclusive o Free.
 * Cada chamada abre uma sessão curta: initialize → notifications/initialized → pedido.
 */

export const METRICOOL_MCP_URL = "https://ai.metricool.com/mcp";
const PROTOCOL_VERSION = "2025-06-18";

export type McpConfig = { url?: string; fetch?: typeof fetch };
export type McpTool = { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } };

const rpcResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]).nullish(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).passthrough().optional(),
});

/** Lê a resposta JSON-RPC de um corpo JSON ou de um stream SSE (pega a mensagem com o id pedido). */
export function parseRpcBody(text: string, contentType: string, id: number) {
  const candidates: unknown[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          candidates.push(JSON.parse(data));
        } catch {
          /* evento que não é JSON */
        }
      }
    }
  } else if (text.trim()) {
    const json = JSON.parse(text);
    candidates.push(...(Array.isArray(json) ? json : [json]));
  }
  for (const c of candidates) {
    const r = rpcResponse.safeParse(c);
    if (r.success && r.data.id === id) return r.data;
  }
  throw new MetricoolApiError("Resposta inesperada do conector do Metricool.", 200, true);
}

class Session {
  private sessionId: string | null = null;
  private next = 1;
  constructor(
    private readonly cfg: McpConfig,
    private readonly accessToken: string,
  ) {}

  private async post(body: unknown) {
    const f = this.cfg.fetch ?? fetch;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    try {
      return await f(this.cfg.url ?? METRICOOL_MCP_URL, { method: "POST", cache: "no-store", headers, body: JSON.stringify(body) });
    } catch {
      throw new MetricoolApiError("Sem conexão com o conector do Metricool.", 0, true);
    }
  }

  async request(method: string, params: unknown) {
    const id = this.next++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params });
    if (res.status === 401 || res.status === 403) {
      throw new MetricoolApiError("O login do Metricool expirou ou foi revogado. Conecte de novo na tela Contas do Instagram.", res.status, false);
    }
    const text = await res.text();
    if (!res.ok) throw new MetricoolApiError(`Erro ${res.status} do conector do Metricool.`, res.status, res.status === 429 || res.status >= 500);
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const msg = parseRpcBody(text, res.headers.get("content-type") ?? "", id);
    if (msg.error) throw new MetricoolApiError(`Conector do Metricool: ${msg.error.message}`, 200, false);
    return msg.result;
  }

  async notify(method: string) {
    const res = await this.post({ jsonrpc: "2.0", method });
    await res.text().catch(() => undefined);
  }

  async open() {
    await this.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "visus-publish", version: "1.0" } });
    await this.notify("notifications/initialized");
  }
}

export async function listTools(cfg: McpConfig, accessToken: string): Promise<McpTool[]> {
  const s = new Session(cfg, accessToken);
  await s.open();
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = z
      .object({ tools: z.array(z.object({ name: z.string() }).passthrough()), nextCursor: z.string().nullish() })
      .parse(await s.request("tools/list", cursor ? { cursor } : {}));
    tools.push(...(r.tools as McpTool[]));
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return tools;
}

const toolResult = z
  .object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).default([]),
    structuredContent: z.unknown().optional(),
    isError: z.boolean().optional(),
  })
  .passthrough();

/** Chama uma ferramenta e devolve o conteúdo: structuredContent, ou o texto (como JSON quando der). */
export async function callTool(cfg: McpConfig, accessToken: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const s = new Session(cfg, accessToken);
  await s.open();
  const r = toolResult.parse(await s.request("tools/call", { name, arguments: args }));
  const text = r.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
  if (r.isError) throw new MetricoolApiError(text || `A ferramenta ${name} do Metricool falhou.`, 200, false);
  if (r.structuredContent !== undefined) return r.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
