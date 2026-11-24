import { z } from "zod";

export const TENANT_COOKIE = "vp_tenant";

export const tenantSlugSchema = z.string().regex(/^[a-z0-9-]{2,48}$/);

export type TenantSummary = { id: string; slug: string; name: string; plan: string };

/** Escolhe o cliente para abrir: o do cookie, se ainda for acessível; senão o primeiro por nome. */
export function pickDefaultTenant(tenants: TenantSummary[], cookieSlug: string | undefined): TenantSummary | null {
  if (tenants.length === 0) return null;
  const fromCookie = cookieSlug ? tenants.find((t) => t.slug === cookieSlug) : undefined;
  if (fromCookie) return fromCookie;
  return [...tenants].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))[0];
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
