import { NextResponse, type NextRequest } from "next/server";
import { connectAccount } from "@/lib/meta/accounts";
import { exchangeCode, getProfile, toLongLivedToken } from "@/lib/meta/client";
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
    const short = await exchangeCode(cfg, code.replace(/#_$/, ""));
    const long = await toLongLivedToken(cfg, short.access_token);
    const profile = await getProfile(cfg, long.access_token);
    const result = await connectAccount(createAdminClient(), {
      tenantId: tenant.id,
      userId: auth.user.id,
      profile,
      token: long.access_token,
      expiresInSeconds: long.expires_in,
    });
    if (!result.ok) return done(`erro=${result.reason === "other_tenant" ? "outro_cliente" : "falha_meta"}`);
    return done(`conectada=${encodeURIComponent(profile.username)}`);
  } catch {
    return done("erro=falha_meta");
  }
}
