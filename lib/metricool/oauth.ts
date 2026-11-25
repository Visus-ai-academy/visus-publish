import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { MetricoolApiError } from "./client";
import { METRICOOL_MCP_URL } from "./mcp";

/**
 * OAuth 2.1 do conector do Metricool (padrão do MCP): descoberta pelo servidor,
 * registro dinâmico do cliente, PKCE S256 e refresh token.
 */

export const METRICOOL_SCOPES = "mcp:read mcp:write";

export type OAuthConfig = { mcpUrl?: string; fetch?: typeof fetch };

const asMetadata = z
  .object({
    authorization_endpoint: z.string().url(),
    token_endpoint: z.string().url(),
    registration_endpoint: z.string().url().optional(),
  })
  .passthrough();
export type AuthServer = z.infer<typeof asMetadata>;

async function getJson(cfg: OAuthConfig, url: string, init?: RequestInit) {
  const f = cfg.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(url, { cache: "no-store", ...init });
  } catch {
    throw new MetricoolApiError("Sem conexão com o login do Metricool.", 0, true);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* corpo não JSON */
  }
  return { res, json };
}

/** Lê os metadados do servidor de autorização a partir do servidor MCP. */
export async function discover(cfg: OAuthConfig = {}): Promise<AuthServer> {
  const mcp = new URL(cfg.mcpUrl ?? METRICOOL_MCP_URL);
  const prm = await getJson(cfg, `${mcp.origin}/.well-known/oauth-protected-resource`);
  const issuer = z.object({ authorization_servers: z.array(z.string()).min(1) }).safeParse(prm.json);
  const base = issuer.success ? issuer.data.authorization_servers[0].replace(/\/$/, "") : mcp.origin;
  const { json } = await getJson(cfg, `${base}/.well-known/oauth-authorization-server`);
  const parsed = asMetadata.safeParse(json);
  if (!parsed.success) throw new MetricoolApiError("Não foi possível ler a configuração de login do Metricool.", 200, true);
  return parsed.data;
}

export type RegisteredClient = { clientId: string; clientSecret: string | null };

export async function registerClient(cfg: OAuthConfig, as: AuthServer, redirectUri: string): Promise<RegisteredClient> {
  if (!as.registration_endpoint) throw new MetricoolApiError("O Metricool não aceita registro de aplicativo.", 200, false);
  const { res, json } = await getJson(cfg, as.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Visus Publish",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: METRICOOL_SCOPES,
    }),
  });
  const parsed = z.object({ client_id: z.string().min(1), client_secret: z.string().nullish() }).passthrough().safeParse(json);
  if (!res.ok || !parsed.success) throw new MetricoolApiError(`O Metricool recusou o registro do aplicativo (erro ${res.status}).`, res.status, res.status >= 500);
  return { clientId: parsed.data.client_id, clientSecret: parsed.data.client_secret ?? null };
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(as: AuthServer, p: { clientId: string; redirectUri: string; state: string; challenge: string; mcpUrl?: string }) {
  const u = new URL(as.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", METRICOOL_SCOPES);
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", p.mcpUrl ?? METRICOOL_MCP_URL);
  return u.toString();
}

const tokenSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().nullish(),
    expires_in: z.coerce.number().nullish(),
  })
  .passthrough();

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null };

async function tokenRequest(cfg: OAuthConfig, as: AuthServer, client: RegisteredClient, form: Record<string, string>, now: number): Promise<Tokens> {
  const body = new URLSearchParams({ ...form, client_id: client.clientId, resource: cfg.mcpUrl ?? METRICOOL_MCP_URL });
  if (client.clientSecret) body.set("client_secret", client.clientSecret);
  const { res, json } = await getJson(cfg, as.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const parsed = tokenSchema.safeParse(json);
  if (!res.ok || !parsed.success) {
    const transient = res.status === 429 || res.status >= 500;
    throw new MetricoolApiError(
      transient ? "O login do Metricool está fora do ar. Tentando de novo." : "O login do Metricool expirou ou foi revogado. Conecte de novo na tela Contas do Instagram.",
      res.status === 200 ? 401 : res.status,
      transient,
    );
  }
  const t = parsed.data;
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: t.expires_in ? new Date(now + t.expires_in * 1000) : null };
}

export function exchangeCode(cfg: OAuthConfig, as: AuthServer, client: RegisteredClient, p: { code: string; verifier: string; redirectUri: string }, now = Date.now()) {
  return tokenRequest(cfg, as, client, { grant_type: "authorization_code", code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri }, now);
}

export function refreshTokens(cfg: OAuthConfig, as: AuthServer, client: RegisteredClient, refreshToken: string, now = Date.now()) {
  return tokenRequest(cfg, as, client, { grant_type: "refresh_token", refresh_token: refreshToken }, now);
}

// ---------- Cookie do fluxo (verifier e cliente registrado), cifrado ----------

const flowSchema = z.object({ v: z.string(), c: z.string(), s: z.string().nullable(), r: z.string().url() });
export type OAuthFlow = { verifier: string; clientId: string; clientSecret: string | null; redirectUri: string };

function key(secret: string) {
  return createHash("sha256").update(`metricool-flow:${secret}`).digest();
}

export function sealFlow(flow: OAuthFlow, secret: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([c.update(JSON.stringify({ v: flow.verifier, c: flow.clientId, s: flow.clientSecret, r: flow.redirectUri })), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64url");
}

export function openFlow(sealed: string | undefined, secret: string): OAuthFlow | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const d = createDecipheriv("aes-256-gcm", key(secret), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString();
    const f = flowSchema.parse(JSON.parse(json));
    return { verifier: f.v, clientId: f.c, clientSecret: f.s, redirectUri: f.r };
  } catch {
    return null;
  }
}
