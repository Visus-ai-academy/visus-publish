import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * `state` do OAuth assinado (SPEC §4): leva tenant e usuário, expira em 10 min
 * e carrega um nonce que também vai num cookie httpOnly do navegador (anti-CSRF).
 */
const payloadSchema = z.object({ t: z.string().uuid(), u: z.string().uuid(), n: z.string().min(16), e: z.number() });
export type OAuthState = { tenantId: string; userId: string; nonce: string };

const TTL_MS = 10 * 60_000;

function sign(data: string, secret: string) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createState(tenantId: string, userId: string, secret: string, now = Date.now()) {
  const nonce = randomBytes(18).toString("base64url");
  const body = Buffer.from(JSON.stringify({ t: tenantId, u: userId, n: nonce, e: now + TTL_MS })).toString("base64url");
  return { state: `${body}.${sign(body, secret)}`, nonce };
}

export function verifyState(state: string, nonceCookie: string | undefined, secret: string, now = Date.now()): OAuthState | null {
  const [body, mac] = state.split(".");
  if (!body || !mac || !nonceCookie) return null;
  const expected = Buffer.from(sign(body, secret));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  let parsed: z.infer<typeof payloadSchema>;
  try {
    parsed = payloadSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
  } catch {
    return null;
  }
  if (parsed.e < now) return null;
  const a = Buffer.from(parsed.n);
  const b = Buffer.from(nonceCookie);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { tenantId: parsed.t, userId: parsed.u, nonce: parsed.n };
}
