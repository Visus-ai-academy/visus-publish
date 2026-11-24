import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/auth/permissions";
import { TENANT_COOKIE, pickDefaultTenant, tenantSlugSchema, type TenantSummary } from "@/lib/tenant-core";

export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
});

export async function requireUser() {
  const { supabase, user } = await getSession();
  if (!user) redirect("/login");
  return { supabase, user };
}

export const isPlatformAdmin = cache(async () => {
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("is_platform_admin");
  return data === true;
});

/** Clientes que o usuário enxerga (o RLS já filtra por membership e status ativo). */
export const listMyTenants = cache(async (): Promise<TenantSummary[]> => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("tenants").select("id, slug, name, plan").order("name");
  if (error) throw new Error("Não foi possível carregar os clientes.");
  return data;
});

export async function getDefaultTenant() {
  const cookieStore = await cookies();
  return pickDefaultTenant(await listMyTenants(), cookieStore.get(TENANT_COOKIE)?.value);
}

/**
 * Resolve o cliente da URL e valida o acesso no servidor a cada request.
 * Cliente inexistente ou sem acesso responde 404, sem revelar qual dos dois.
 */
export const resolveTenant = cache(async (slug: string) => {
  if (!tenantSlugSchema.safeParse(slug).success) notFound();
  const { supabase, user } = await requireUser();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, slug, name, plan, timezone")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) notFound();

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();

  const role: Role | null = (membership?.role as Role | undefined) ?? ((await isPlatformAdmin()) ? "admin" : null);
  if (!role) notFound();

  return { tenant, role, user, supabase };
});
