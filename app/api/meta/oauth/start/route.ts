import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl } from "@/lib/meta/client";
import { getMetaConfig } from "@/lib/meta/config";
import { OAUTH_NONCE_COOKIE, oauthSecret } from "@/lib/meta/oauth-cookie";
import { createState } from "@/lib/meta/state";
import { createClient } from "@/lib/supabase/server";
import { tenantSlugSchema } from "@/lib/tenant-core";

export async function GET(request: NextRequest) {
  const slug = tenantSlugSchema.safeParse(request.nextUrl.searchParams.get("tenant"));
  if (!slug.success) return NextResponse.redirect(new URL("/", request.url));
  const back = (erro: string) => NextResponse.redirect(new URL(`/${slug.data}/contas?erro=${erro}`, request.url));

  const cfg = getMetaConfig();
  if (!cfg) return back("meta_nao_configurada");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", request.url));

  const { data: tenant } = await supabase.from("tenants").select("id").eq("slug", slug.data).maybeSingle();
  if (!tenant) return NextResponse.redirect(new URL("/", request.url));
  const { data: isAdmin } = await supabase.rpc("has_tenant_role", { t: tenant.id, roles: ["admin"] });
  if (!isAdmin) return back("sem_permissao");

  const { state, nonce } = createState(tenant.id, auth.user.id, oauthSecret());
  const res = NextResponse.redirect(authorizeUrl(cfg, state));
  res.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/meta/oauth",
    maxAge: 600,
  });
  return res;
}
