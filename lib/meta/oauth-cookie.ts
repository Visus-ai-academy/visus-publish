export const OAUTH_NONCE_COOKIE = "vp_oauth_nonce";

export function oauthSecret() {
  const s = process.env.OAUTH_STATE_SECRET;
  if (!s || s.length < 32) throw new Error("OAUTH_STATE_SECRET ausente ou curto (mínimo 32 caracteres).");
  return s;
}
