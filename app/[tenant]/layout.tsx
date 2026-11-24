import { AppShell } from "@/components/shell/app-shell";
import { resolveTenant } from "@/lib/tenant";

export default async function TenantLayout({ children, params }: LayoutProps<"/[tenant]">) {
  const { tenant } = await resolveTenant((await params).tenant);
  return <AppShell current={{ slug: tenant.slug, name: tenant.name }}>{children}</AppShell>;
}
