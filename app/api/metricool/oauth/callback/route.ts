import { NextResponse, type NextRequest } from "next/server";
import { oauthEnv } from "@/lib/metricool/auth";
import { listTools } from "@/lib/metricool/mcp";
import { discover, exchangeCode, openFlow } from "@/lib/metricool/oauth";
import { appOrigin, MC_COOKIE_PATH, MC_FLOW_COOKIE, MC_NONCE_COOKIE } from "@/lib/metricool/oauth-cookie";
import { metricoolEnv } from "@/lib/metricool/port";
import { oauthSecret } from "@/lib/meta/oauth-cookie";
import { verifyState } from "@/lib/meta/state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export async function GET(request: NextRequest) {
  const base = appOrigin(request.nextUrl.origin);
  const params = request.nextUrl.searchParams;
  const secret = oauthSecret();
  const state = verifyState(params.get("state") ?? "", request.cookies.get(MC_NONCE_COOKIE)?.value, secret);
  const flow = openFlow(request.cookies.get(MC_FLOW_COOKIE)?.value, secret);
  if (!state || !flow) return NextResponse.redirect(new URL("/?erro=conexao_expirada", base));

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from("tenants").select("id, slug").eq("id", state.tenantId).maybeSingle();
  if (!auth.user || auth.user.id !== state.userId || !tenant) return NextResponse.redirect(new URL("/", base));

  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(`/${tenant.slug}/contas?${q}`, base));
    res.cookies.delete({ name: MC_NONCE_COOKIE, path: MC_COOKIE_PATH });
    res.cookies.delete({ name: MC_FLOW_COOKIE, path: MC_COOKIE_PATH });
    return res;
  };

  const { data: platform } = await supabase.rpc("is_platform_admin");
  if (platform !== true) return done("erro=mc_sem_permissao");
  const code = params.get("code");
  if (!code) return done(params.get("error") === "access_denied" ? "erro=mc_cancelado" : "erro=mc_falha");

  const db = createAdminClient();
  try {
    const cfg = oauthEnv();
    const as = await discover(cfg);
    const client = { clientId: flow.clientId, clientSecret: flow.clientSecret };
    const t = await exchangeCode(cfg, as, client, { code, verifier: flow.verifier, redirectUri: flow.redirectUri });
    const { error } = await db.rpc("store_metricool_oauth", {
      p_tenant: tenant.id,
      p_client_id: client.clientId,
      p_client_secret: client.clientSecret ?? undefined,
      p_access: t.accessToken,
      p_refresh: t.refreshToken ?? undefined,
      p_expires_at: t.expiresAt?.toISOString() ?? undefined,
      p_actor: auth.user.id,
    });
    if (error) return done("erro=mc_falha");
    await db.from("audit_log").insert({ tenant_id: tenant.id, actor: auth.user.id, action: "metricool.connected", meta: { mode: "oauth" } });

    // Guarda as ferramentas do conector (sem segredos) para diagnóstico.
    try {
      const tools = await listTools(metricoolEnv().mcp, t.accessToken);
      const summary = tools.map((x) => ({ name: x.name, params: Object.keys(x.inputSchema?.properties ?? {}), inputSchema: x.inputSchema ?? null }));
      await db.rpc("set_metricool_tools", { p_tenant: tenant.id, p_tools: summary as unknown as Json });
    } catch {
      /* diagnóstico é opcional */
    }
    return done("metricool=ok");
  } catch {
    return done("erro=mc_falha");
  }
}
