import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { discover, refreshTokens, type OAuthConfig } from "./oauth";
import type { MetricoolAuth } from "./port";

type Db = SupabaseClient<Database>;

/** Renova o access token do conector quando falta menos que isso para vencer. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * Credencial do Metricool do cliente para uso no servidor (service_role).
 * No modo conector, renova o token se estiver vencendo e grava o novo no Vault.
 * Devolve null se o cliente não conectou o Metricool.
 */
export async function loadMetricoolAuth(db: Db, tenantId: string, opts: { oauth?: OAuthConfig; now?: Date } = {}): Promise<MetricoolAuth | null> {
  const { data, error } = await db.rpc("read_metricool_credentials", { p_tenant: tenantId });
  if (error) throw new Error(`read_metricool_credentials: ${error.message}`);
  const row = data?.[0];
  if (!row?.token) return null;
  if (row.auth_mode !== "oauth") return row.user_id ? { userId: row.user_id, token: row.token } : null;

  const now = (opts.now ?? new Date()).getTime();
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
  if (expiresAt === null || expiresAt - now > REFRESH_MARGIN_MS || !row.refresh_token) return { accessToken: row.token };

  const cfg = opts.oauth ?? oauthEnv();
  const as = await discover(cfg);
  const t = await refreshTokens(cfg, as, { clientId: row.client_id, clientSecret: row.client_secret }, row.refresh_token, now);
  const { error: e } = await db.rpc("store_metricool_oauth", {
    p_tenant: tenantId,
    p_client_id: row.client_id,
    p_client_secret: row.client_secret ?? undefined,
    p_access: t.accessToken,
    p_refresh: t.refreshToken ?? undefined,
    p_expires_at: t.expiresAt?.toISOString() ?? undefined,
  });
  if (e) throw new Error(`store_metricool_oauth: ${e.message}`);
  return { accessToken: t.accessToken };
}

export function oauthEnv(): OAuthConfig {
  return { mcpUrl: process.env.METRICOOL_MCP_URL || undefined };
}
