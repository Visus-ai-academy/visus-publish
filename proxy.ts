import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { TENANT_COOKIE, tenantSlugSchema } from "@/lib/tenant-core";

const PUBLIC_PATHS = ["/login", "/convite"];
const RESERVED = new Set(["login", "convite", "admin", "api", "sair"]);

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // Renova a sessão. Não colocar código entre a criação do cliente e esta chamada.
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  if (!data.user && !PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }

  // Lembra o último cliente aberto. É só preferência: o acesso é validado no servidor.
  const first = path.split("/")[1];
  if (data.user && first && !RESERVED.has(first) && tenantSlugSchema.safeParse(first).success) {
    response.cookies.set(TENANT_COOKIE, first, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 180 });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
