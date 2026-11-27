import { after, NextResponse, type NextRequest } from "next/server";
import { collectAccount, insightsPort } from "@/lib/insights/collect";
import { connectAccount } from "@/lib/meta/accounts";
import { assignedInstagramAccounts, exchangeCode, exchangeUnifiedCode, getProfile, toLongLivedToken } from "@/lib/meta/client";

/** Token do login unificado sem validade: guarda como 10 anos (a rotina de renovação o ignora). */
const NEVER_EXPIRES_S = 10 * 365 * 86_400;
import { getMetaConfig } from "@/lib/meta/config";
import { OAUTH_NONCE_COOKIE, oauthSecret } from "@/lib/meta/oauth-cookie";
import { verifyState } from "@/lib/meta/state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = verifyState(params.get("state") ?? "", request.cookies.get(OAUTH_NONCE_COOKIE)?.value, oauthSecret());
  if (!state) return NextResponse.redirect(new URL("/?erro=conexao_expirada", request.url));

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from("tenants").select("id, slug").eq("id", state.tenantId).maybeSingle();
  if (!auth.user || auth.user.id !== state.userId || !tenant) return NextResponse.redirect(new URL("/", request.url));

  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(`/${tenant.slug}/contas?${q}`, request.url));
    res.cookies.delete({ name: OAUTH_NONCE_COOKIE, path: "/api/meta/oauth" });
    return res;
  };

  // Ainda é admin? (o papel pode ter mudado durante o login na Meta)
  const { data: isAdmin } = await supabase.rpc("has_tenant_role", { t: tenant.id, roles: ["admin"] });
  if (!isAdmin) return done("erro=sem_permissao");

  const code = params.get("code");
  const cfg = getMetaConfig();
  if (!code || !cfg) return done(params.get("error") === "access_denied" ? "erro=cancelado" : "erro=falha_meta");

  try {
    // Apps novos (login unificado): um token do sistema vale para as contas que a pessoa liberou
    const login = cfg.loginConfigId
      ? await (async () => {
          const t = await exchangeUnifiedCode(cfg, code);
          const profiles = await assignedInstagramAccounts(cfg, t.access_token);
          // Sem validade informada, o token não vence (a Meta não tem renovação para ele)
          return { token: t.access_token, expiresIn: t.expires_in ?? NEVER_EXPIRES_S, profiles };
        })()
      : await (async () => {
          const short = await exchangeCode(cfg, code.replace(/#_$/, ""));
          const long = await toLongLivedToken(cfg, short.access_token);
          return { token: long.access_token, expiresIn: long.expires_in, profiles: [await getProfile(cfg, long.access_token)] };
        })();
    if (!login.profiles.length) return done("erro=sem_conta");

    const db = createAdminClient();
    const connected: Array<{ id: string; username: string }> = [];
    let otherTenant = false;
    for (const profile of login.profiles) {
      const result = await connectAccount(db, { tenantId: tenant.id, userId: auth.user.id, profile, token: login.token, expiresInSeconds: login.expiresIn });
      if (result.ok) connected.push({ id: result.accountId, username: profile.username });
      else if (result.reason === "other_tenant") otherTenant = true;
    }
    if (!connected.length) return done(`erro=${otherTenant ? "outro_cliente" : "falha_meta"}`);
    // Primeira leitura das métricas (90 dias de histórico) depois da resposta, sem segurar o login
    after(async () => {
      for (const a of connected) await collectAccount(createAdminClient(), insightsPort(cfg), tenant.id, a.id).catch(() => undefined);
    });
    return done(`conectada=${encodeURIComponent(connected.map((a) => a.username).join(", @"))}`);
  } catch (e) {
    console.error("meta oauth", e instanceof Error ? e.message : e);
    return done("erro=falha_meta");
  }
}
