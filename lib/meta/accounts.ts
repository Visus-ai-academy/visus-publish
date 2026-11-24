import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>; // service_role

export type ConnectInput = {
  tenantId: string;
  userId: string;
  profile: { user_id: string; username: string; name?: string; profile_picture_url?: string; account_type?: string };
  token: string;
  expiresInSeconds: number;
};

export type ConnectResult = { ok: true; accountId: string } | { ok: false; reason: "other_tenant" | "error" };

/** Grava a conta conectada e o token no Vault. Sempre filtra pelo tenant do state assinado. */
export async function connectAccount(db: Db, input: ConnectInput): Promise<ConnectResult> {
  const { data: existing } = await db
    .from("ig_accounts")
    .select("id, tenant_id")
    .eq("ig_user_id", input.profile.user_id)
    .maybeSingle();

  // A mesma conta do Instagram não pode estar em dois clientes (SPEC §4).
  if (existing && existing.tenant_id !== input.tenantId) return { ok: false, reason: "other_tenant" };

  const fields = {
    username: input.profile.username,
    name: input.profile.name ?? null,
    profile_picture_url: input.profile.profile_picture_url ?? null,
    account_type: input.profile.account_type ?? null,
  };

  let accountId = existing?.id;
  if (accountId) {
    const { error } = await db.from("ig_accounts").update(fields).eq("tenant_id", input.tenantId).eq("id", accountId);
    if (error) return { ok: false, reason: "error" };
  } else {
    const { data, error } = await db
      .from("ig_accounts")
      .insert({ ...fields, tenant_id: input.tenantId, ig_user_id: input.profile.user_id, connected_by: input.userId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, reason: error?.code === "23505" ? "other_tenant" : "error" };
    accountId = data.id;
  }

  const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000).toISOString();
  const { error: tokenError } = await db.rpc("store_ig_token", { p_account: accountId, p_token: input.token, p_expires_at: expiresAt });
  if (tokenError) return { ok: false, reason: "error" };

  await db.from("audit_log").insert({
    tenant_id: input.tenantId,
    actor: input.userId,
    action: "ig_account.connected",
    target: `@${input.profile.username}`,
  });
  return { ok: true, accountId };
}

export async function disconnectAccount(db: Db, tenantId: string, accountId: string, actor: string) {
  const { data: acc } = await db.from("ig_accounts").select("id, username").eq("tenant_id", tenantId).eq("id", accountId).maybeSingle();
  if (!acc) return false;
  const { error } = await db.rpc("delete_ig_token", { p_account: acc.id });
  if (error) return false;
  await db.from("audit_log").insert({ tenant_id: tenantId, actor, action: "ig_account.disconnected", target: `@${acc.username}` });
  return true;
}

const REFRESH_WINDOW_DAYS = 10;

/** Job `refresh-tokens`: renova tokens que vencem em menos de 10 dias (SPEC §4). */
export async function refreshExpiringTokens(
  db: Db,
  refresh: (token: string) => Promise<{ access_token: string; expires_in: number }>,
  now = new Date(),
) {
  const limit = new Date(now.getTime() + REFRESH_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: accounts, error } = await db
    .from("ig_accounts")
    .select("id, tenant_id, username")
    .eq("status", "connected")
    .lt("token_expires_at", limit);
  if (error) throw new Error(error.message);

  const results: Array<{ accountId: string; ok: boolean }> = [];
  for (const acc of accounts ?? []) {
    try {
      const { data: token } = await db.rpc("read_ig_token", { p_account: acc.id });
      if (!token) throw new Error("sem token");
      const fresh = await refresh(token);
      const { error: e } = await db.rpc("store_ig_token", {
        p_account: acc.id,
        p_token: fresh.access_token,
        p_expires_at: new Date(now.getTime() + fresh.expires_in * 1000).toISOString(),
      });
      if (e) throw new Error(e.message);
      results.push({ accountId: acc.id, ok: true });
    } catch {
      await db.from("ig_accounts").update({ status: "needs_reauth" }).eq("tenant_id", acc.tenant_id).eq("id", acc.id);
      await db.from("audit_log").insert({ tenant_id: acc.tenant_id, action: "ig_account.needs_reauth", target: `@${acc.username}` });
      results.push({ accountId: acc.id, ok: false });
    }
  }
  return results;
}
