export const MC_FLOW_COOKIE = "vp_mc_flow";
export const MC_NONCE_COOKIE = "vp_mc_nonce";
export const MC_COOKIE_PATH = "/api/metricool/oauth";

/** Origem pública do app: APP_URL quando definido (atrás de proxy o request pode ver outro host). */
export function appOrigin(requestOrigin: string) {
  return process.env.APP_URL?.replace(/\/$/, "") || requestOrigin;
}

/** Endereço de retorno do login do Metricool, no mesmo domínio do app. */
export function metricoolRedirectUri(origin: string) {
  return `${appOrigin(origin)}/api/metricool/oauth/callback`;
}
