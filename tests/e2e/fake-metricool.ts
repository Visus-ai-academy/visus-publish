import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * Metricool simulado para os testes e2e. Uma marca (blogId 9001, @aurora.mc), agendamento
 * que vira PUBLISHED na primeira consulta, e /__last para o teste conferir o que foi enviado.
 */
export const FAKE_METRICOOL_PORT = 54398;
export const FAKE_MC_TOKEN = "e2e-metricool-token";
let n = 0;
let last: unknown = null;

// Conector (MCP + OAuth) simulado: blogId 9002, @belapele.mc
const BASE = `http://127.0.0.1:${FAKE_METRICOOL_PORT}`;
const codes = new Map<string, { challenge: string; redirect: string }>();
const ACCESS = "e2e-mcp-access";
const mcpPosts = new Map<number, { text: string; checks: number }>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((r) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => r(raw));
  });
}

function mcpTool(name: string, args: Record<string, unknown>) {
  if (name === "get_brands") return [{ id: 9002, label: "Bela Pele (conector)", instagram: "belapele.mc" }];
  if (name === "create_scheduled_post") {
    const id = 80000 + ++n;
    const info = args.info as { text: string };
    mcpPosts.set(id, { text: info.text, checks: 0 });
    last = { via: "mcp", blogId: String(args.blog_id), date: args.date, body: info };
    return { data: { id } };
  }
  if (name === "get_scheduled_posts") {
    // Cada post aparece como pendente na primeira consulta e some depois (publicado).
    return {
      data: [...mcpPosts.entries()].flatMap(([id, p]) => (p.checks++ < 1 ? [{ id, text: p.text, providers: [{ network: "instagram", status: "PENDING" }] }] : [])),
    };
  }
  throw new Error(`ferramenta desconhecida ${name}`);
}

export function startFakeMetricool(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${FAKE_METRICOOL_PORT}`);
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/__last") return json(last);

    // ---- OAuth do conector ----
    if (url.pathname === "/.well-known/oauth-protected-resource") return json({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
    if (url.pathname === "/.well-known/oauth-authorization-server")
      return json({ issuer: BASE, authorization_endpoint: `${BASE}/oauth/authorize`, token_endpoint: `${BASE}/oauth/token`, registration_endpoint: `${BASE}/oauth/register` });
    if (url.pathname === "/oauth/register" && req.method === "POST") {
      readBody(req).then(() => json({ client_id: "e2e-client" }, 201));
      return;
    }
    if (url.pathname === "/oauth/authorize") {
      const redirect = url.searchParams.get("redirect_uri")!;
      const code = `code-${++n}`;
      codes.set(code, { challenge: url.searchParams.get("code_challenge")!, redirect });
      const back = new URL(redirect);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state")!);
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    if (url.pathname === "/oauth/token" && req.method === "POST") {
      readBody(req).then((raw) => {
        const p = new URLSearchParams(raw);
        if (p.get("grant_type") === "refresh_token") return json({ access_token: ACCESS, refresh_token: "e2e-refresh", expires_in: 3600 });
        const c = codes.get(p.get("code") ?? "");
        const ok = c && createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") === c.challenge && c.redirect === p.get("redirect_uri");
        if (!ok) return json({ error: "invalid_grant" }, 400);
        json({ access_token: ACCESS, refresh_token: "e2e-refresh", expires_in: 3600 });
      });
      return;
    }
    if (url.pathname === "/mcp") {
      if (req.headers.authorization !== `Bearer ${ACCESS}`) return json({ error: "unauthorized" }, 401);
      readBody(req).then((raw) => {
        const msg = JSON.parse(raw);
        if (!("id" in msg)) {
          res.writeHead(202);
          return res.end();
        }
        let result: unknown;
        if (msg.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-metricool" } };
        else if (msg.method === "tools/list")
          result = {
            tools: [
              { name: "get_brands", inputSchema: { type: "object", properties: {} } },
              { name: "create_scheduled_post", inputSchema: { type: "object", properties: { date: { type: "string" }, blog_id: { type: "integer" }, info: { type: "object" } } } },
              { name: "get_scheduled_posts", inputSchema: { type: "object", properties: { blog_id: {}, start: {}, end: {}, timezone: {}, extendedRange: {} } } },
            ],
          };
        else result = { content: [{ type: "text", text: JSON.stringify(mcpTool(msg.params.name, msg.params.arguments ?? {})) }] };
        res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "e2e-session" });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
      });
      return;
    }

    if (req.headers["x-mc-auth"] !== FAKE_MC_TOKEN || !url.searchParams.get("userId")) return json({ error: "unauthorized" }, 401);

    if (url.pathname === "/admin/simpleProfiles") return json([{ id: 9001, label: "Aurora (Metricool)", instagram: "aurora.mc" }]);
    if (url.pathname === "/actions/normalize/image/url") return json({ url: `https://static.metricool.test/${++n}.png` });
    if (url.pathname === "/v2/scheduler/posts" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        last = { blogId: url.searchParams.get("blogId"), body: JSON.parse(raw) };
        json({ data: { id: 70000 + ++n } });
      });
      return;
    }
    const m = url.pathname.match(/^\/v2\/scheduler\/posts\/(\d+)$/);
    if (m && req.method === "GET") {
      return json({ data: { id: Number(m[1]), providers: [{ network: "instagram", status: "PUBLISHED", publicUrl: `https://www.instagram.com/p/mc-${m[1]}/` }] } });
    }
    if (m && req.method === "DELETE") return json({});
    return json({ error: "rota desconhecida" }, 404);
  });
  return new Promise((resolve) => server.listen(FAKE_METRICOOL_PORT, "127.0.0.1", () => resolve(server)));
}
