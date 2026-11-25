import { NextResponse, type NextRequest } from "next/server";
import { oauthEnv } from "@/lib/metricool/auth";
import { authorizeUrl, discover, pkce, registerClient, sealFlow } from "@/lib/metricool/oauth";
import { appOrigin, MC_COOKIE_PATH, MC_FLOW_COOKIE, MC_NONCE_COOKIE, metricoolRedirectUri } from "@/lib/metricool/oauth-cookie";
import { oauthSecret } from "@/lib/meta/oauth-cookie";
import { createState } from "@/lib/meta/state";
import { createClient } from "@/lib/supabase/server";
import { tenantSlugSchema } from "@/lib/tenant-core";

/** Login do Metricool pelo conector (qualquer plano). Só a equipe da Visus conecta. */
export async function GET(request: NextRequest) {
  const base = appOrigin(request.nextUrl.origin);
  const slug = tenantSlugSchema.safeParse(request.nextUrl.searchParams.get("tenant"));
  if (!slug.success) return NextResponse.redirect(new URL("/", base));
  const back = (erro: string) => NextResponse.redirect(new URL(`/${slug.data}/contas?erro=${erro}`, base));

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", base));
  const { data: tenant } = await supabase.from("tenants").select("id").eq("slug", slug.data).maybeSingle();
  if (!tenant) return NextResponse.redirect(new URL("/", base));
  const { data: platform } = await supabase.rpc("is_platform_admin");
  if (platform !== true) return back("mc_sem_permissao");

  try {
    const cfg = oauthEnv();
    const redirectUri = metricoolRedirectUri(request.nextUrl.origin);
    const as = await discover(cfg);
    const client = await registerClient(cfg, as, redirectUri);
    const { verifier, challenge } = pkce();
    const secret = oauthSecret();
    const { state, nonce } = createState(tenant.id, auth.user.id, secret);

    const res = NextResponse.redirect(authorizeUrl(as, { clientId: client.clientId, redirectUri, state, challenge, mcpUrl: cfg.mcpUrl }));
    const cookie = { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax" as const, path: MC_COOKIE_PATH, maxAge: 600 };
    res.cookies.set(MC_NONCE_COOKIE, nonce, cookie);
    res.cookies.set(MC_FLOW_COOKIE, sealFlow({ verifier, clientId: client.clientId, clientSecret: client.clientSecret, redirectUri }, secret), cookie);
    return res;
  } catch {
    return back("mc_falha");
  }
}
