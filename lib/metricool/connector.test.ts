import { beforeEach, describe, expect, it } from "vitest";
import { clearToolCache, connectorBrands, connectorSchedule, connectorStatus, pickTool, scheduleArgs } from "./connector";
import { parseRpcBody, type McpTool } from "./mcp";
import { authorizeUrl, discover, exchangeCode, openFlow, pkce, refreshTokens, registerClient, sealFlow } from "./oauth";

type Call = { name: string; args: Record<string, unknown> };

/** Servidor MCP simulado como fetch: responde em SSE e exige sessão e Bearer. */
function fakeMcp(tools: McpTool[], handle: (c: Call) => unknown, opts: { sse?: boolean } = {}) {
  const calls: Call[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    const h = init?.headers as Record<string, string>;
    if (h.Authorization !== "Bearer tok") return new Response("{}", { status: 401 });
    const msg = JSON.parse(String(init?.body));
    if (msg.method !== "initialize" && h["Mcp-Session-Id"] !== "s1") return new Response("sem sessão", { status: 400 });
    if (!("id" in msg)) return new Response(null, { status: 202 });
    let result: unknown;
    if (msg.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake" } };
    else if (msg.method === "tools/list") result = { tools };
    else {
      const c = { name: msg.params.name, args: msg.params.arguments };
      calls.push(c);
      const out = handle(c);
      result = { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] };
    }
    const payload = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
    return opts.sse === false
      ? new Response(payload, { headers: { "content-type": "application/json", "mcp-session-id": "s1" } })
      : new Response(`event: message\ndata: ${payload}\n\n`, { headers: { "content-type": "text/event-stream", "mcp-session-id": "s1" } });
  }) as typeof fetch;
  return { cfg: { url: "https://mcp.test/mcp", fetch: f }, calls };
}

const TOOLS: McpTool[] = [
  { name: "get_brands", inputSchema: { properties: {} } },
  { name: "create_scheduled_post", inputSchema: { properties: { date: { type: "string" }, blog_id: { type: "integer" }, info: { type: "object" } } } },
  { name: "get_scheduled_posts", inputSchema: { properties: { blog_id: {}, start: {}, end: {}, timezone: {}, extendedRange: {} } } },
];

const input = { blogId: "55", dateTime: "2026-12-01T18:02:00", timezone: "America/Sao_Paulo", text: "Oi", media: ["https://m/1.jpg"], type: "POST" as const };

beforeEach(() => clearToolCache());

describe("conector do Metricool (MCP)", () => {
  it("lê JSON-RPC em SSE e em JSON", () => {
    expect(parseRpcBody('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":1}}\n\n', "text/event-stream", 2).result).toEqual({ ok: 1 });
    expect(parseRpcBody('{"jsonrpc":"2.0","id":3,"result":7}', "application/json", 3).result).toBe(7);
  });

  it("agenda com o corpo dentro de info e devolve o id", async () => {
    const { cfg, calls } = fakeMcp(TOOLS, () => ({ data: { id: 321 } }));
    expect(await connectorSchedule(cfg, "tok", input)).toBe("321");
    expect(calls[0].name).toBe("create_scheduled_post");
    expect(calls[0].args).toMatchObject({ blog_id: 55, date: "2026-12-01T18:02:00", info: { text: "Oi", autoPublish: true, instagramData: { type: "POST" } } });
  });

  it("sem parâmetro info, manda os campos soltos", () => {
    const tool: McpTool = { name: "create_scheduled_post", inputSchema: { properties: { blogId: { type: "string" }, text: {}, publicationDate: {} } } };
    expect(scheduleArgs(tool, input)).toMatchObject({ blogId: "55", text: "Oi", publicationDate: { dateTime: input.dateTime } });
  });

  it("sem id na resposta, acha o post pela legenda", async () => {
    const { cfg } = fakeMcp(TOOLS, (c) =>
      c.name === "create_scheduled_post" ? "Post scheduled successfully" : { data: [{ id: 9, text: "Outro" }, { id: 10, text: "Oi", publicationDate: { dateTime: "2026-12-01T18:02:00" } }] },
    );
    expect(await connectorSchedule(cfg, "tok", input)).toBe("10");
  });

  it("texto de falha vira erro", async () => {
    const { cfg } = fakeMcp(TOOLS, () => "Failed to schedule the post");
    await expect(connectorSchedule(cfg, "tok", input)).rejects.toThrow(/Failed to schedule/);
  });

  it("status: pendente, erro, publicado e sumido da lista", async () => {
    const list = [
      { id: 1, providers: [{ network: "instagram", status: "PENDING" }] },
      { id: 2, providers: [{ network: "instagram", status: "ERROR", detailedStatus: "Mídia inválida" }] },
      { id: 3, providers: [{ network: "instagram", status: "PUBLISHED", publicUrl: "https://ig/p/3" }] },
      { id: 4 },
    ];
    const { cfg, calls } = fakeMcp(TOOLS, () => list, { sse: false });
    expect((await connectorStatus(cfg, "tok", "55", "1", "America/Sao_Paulo")).status).toBe("PENDING");
    expect(await connectorStatus(cfg, "tok", "55", "2", "America/Sao_Paulo")).toMatchObject({ status: "ERROR", detail: "Mídia inválida" });
    expect(await connectorStatus(cfg, "tok", "55", "3", "America/Sao_Paulo")).toMatchObject({ status: "PUBLISHED", publicUrl: "https://ig/p/3" });
    expect((await connectorStatus(cfg, "tok", "55", "4", "America/Sao_Paulo")).status).toBe("PENDING");
    expect((await connectorStatus(cfg, "tok", "55", "99", "America/Sao_Paulo")).status).toBe("NOT_FOUND");
    expect(calls[0].args).toMatchObject({ timezone: "America/Sao_Paulo", extendedRange: true });
    expect(String(calls[0].args.start)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("marcas pelo get_brands", async () => {
    const { cfg } = fakeMcp(TOOLS, () => ({ data: [{ id: 7, label: "Clínica", instagram: "clinica" }] }));
    expect(await connectorBrands(cfg, "tok")).toEqual([{ blogId: "7", label: "Clínica", instagram: "clinica" }]);
  });

  it("token recusado explica que precisa entrar de novo", async () => {
    const { cfg } = fakeMcp(TOOLS, () => ({}));
    await expect(connectorBrands(cfg, "outro")).rejects.toMatchObject({ status: 401, transient: false, message: expect.stringMatching(/Conecte de novo/) });
  });
});

describe("login do conector (OAuth)", () => {
  const AS = { authorization_endpoint: "https://as.test/authorize", token_endpoint: "https://as.test/token", registration_endpoint: "https://as.test/register" };
  const seen: Array<{ url: string; body: string }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    seen.push({ url, body: String(init?.body ?? "") });
    if (url.endsWith("/.well-known/oauth-protected-resource")) return Response.json({ authorization_servers: ["https://as.test"] });
    if (url === "https://as.test/.well-known/oauth-authorization-server") return Response.json(AS);
    if (url === AS.registration_endpoint) return Response.json({ client_id: "cid" }, { status: 201 });
    if (url === AS.token_endpoint) {
      const p = new URLSearchParams(String(init?.body));
      if (p.get("grant_type") === "refresh_token" && p.get("refresh_token") !== "r1") return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: "a2", refresh_token: "r2", expires_in: 3600 });
    }
    return new Response("?", { status: 404 });
  }) as typeof fetch;
  const cfg = { mcpUrl: "https://mcp.test/mcp", fetch: f };

  it("descobre, registra, monta a URL com PKCE e troca o código", async () => {
    const as = await discover(cfg);
    expect(as.token_endpoint).toBe(AS.token_endpoint);
    const client = await registerClient(cfg, as, "https://app.test/api/metricool/oauth/callback");
    expect(client).toEqual({ clientId: "cid", clientSecret: null });
    expect(JSON.parse(seen.find((s) => s.url === AS.registration_endpoint)!.body)).toMatchObject({ redirect_uris: ["https://app.test/api/metricool/oauth/callback"], token_endpoint_auth_method: "none" });

    const { verifier, challenge } = pkce();
    const u = new URL(authorizeUrl(as, { clientId: "cid", redirectUri: "https://app.test/cb", state: "st", challenge, mcpUrl: cfg.mcpUrl }));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ code_challenge_method: "S256", code_challenge: challenge, resource: "https://mcp.test/mcp", scope: "mcp:read mcp:write" });

    const t = await exchangeCode(cfg, as, client, { code: "c", verifier, redirectUri: "https://app.test/cb" }, 0);
    expect(t).toEqual({ accessToken: "a2", refreshToken: "r2", expiresAt: new Date(3_600_000) });
    expect(seen.at(-1)!.body).toContain(`code_verifier=${verifier}`);
  });

  it("refresh recusado pede para entrar de novo", async () => {
    const as = await discover(cfg);
    await expect(refreshTokens(cfg, as, { clientId: "cid", clientSecret: null }, "velho")).rejects.toMatchObject({ transient: false, message: expect.stringMatching(/Conecte de novo/) });
  });

  it("cookie do fluxo é cifrado e não aceita adulteração", () => {
    const flow = { verifier: "v", clientId: "cid", clientSecret: null, redirectUri: "https://app.test/cb" };
    const secret = "x".repeat(40);
    const sealed = sealFlow(flow, secret);
    expect(sealed).not.toContain("cid");
    expect(openFlow(sealed, secret)).toEqual(flow);
    expect(openFlow(sealed, "y".repeat(40))).toBeNull();
    expect(openFlow(sealed.slice(0, -2) + "AA", secret)).toBeNull();
  });
});

describe("conector real do Metricool (esquemas lidos do servidor em 25/11)", async () => {
  const real = (await import("./fixtures/real-tools.json")).default as McpTool[];

  it("acha as marcas no getBrandSettings, com o @ em networksData", async () => {
    const { cfg, calls } = fakeMcp(real, () => ({
      data: [{ id: 6358212, userId: 1, label: "Visus_ai", timezone: "America/Sao_Paulo", networksData: { facebookData: "1", instagramData: "visus_ai" } }],
    }));
    expect(await connectorBrands(cfg, "tok")).toEqual([{ blogId: "6358212", label: "Visus_ai", instagram: "visus_ai" }]);
    expect(calls[0].name).toBe("getBrandSettings");
  });

  it("agenda no createScheduledPost: blogId texto, data com fuso, info em JSON e marcação de IA", async () => {
    const { cfg, calls } = fakeMcp(real, () => ({ data: { id: 777, uuid: "-123" } }));
    expect(await connectorSchedule(cfg, "tok", { ...input, aiGenerated: true })).toBe("777");
    const c = calls[0];
    expect(c.name).toBe("createScheduledPost");
    expect(c.args.blogId).toBe("55");
    expect(c.args.date).toBe("2026-12-01T18:02:00-03:00");
    expect(typeof c.args.info).toBe("string");
    expect(JSON.parse(String(c.args.info))).toMatchObject({ text: "Oi", providers: [{ network: "instagram" }], instagramData: { type: "POST", isAiGenerated: true } });
  });

  it("confere no getScheduledPosts pelo id ou uuid e devolve o link do Instagram", async () => {
    const published = {
      id: 338107549,
      uuid: "-1235",
      providers: [
        { network: "facebook", status: "PUBLISHED", publicUrl: "https://facebook.com/x" },
        { network: "instagram", status: "PUBLISHED", publicUrl: "https://www.instagram.com/p/DZprPSoirwh/" },
      ],
    };
    const { cfg, calls } = fakeMcp(real, () => ({ data: [published] }));
    expect(await connectorStatus(cfg, "tok", "6358212", "338107549", "America/Sao_Paulo", new Date("2026-11-25T23:00:00Z"))).toMatchObject({
      status: "PUBLISHED",
      publicUrl: "https://www.instagram.com/p/DZprPSoirwh/",
    });
    expect((await connectorStatus(cfg, "tok", "6358212", "-1235", "America/Sao_Paulo")).status).toBe("PUBLISHED");
    expect(calls[0].name).toBe("getScheduledPosts");
    expect(calls[0].args).toMatchObject({ brandId: "6358212", timezone: "America/Sao_Paulo", fromDate: "2026-11-23T00:00:00-03:00", toDate: "2026-11-27T23:59:59-03:00" });
  });

  it("não usa a ferramenta de revisão no lugar do agendamento", () => {
    expect(pickTool(real, ["naoExiste"], /^(create|post)_?schedul(?!.*review)/i)?.name).toBe("createScheduledPost");
  });
});
