import { resolveTenant } from "@/lib/tenant";
import { SCREENS, type NavKey } from "./nav";
import { PageHeader } from "./app-shell";
import { EmptyState } from "@/components/ui/states";

export async function ComingSoon({ slug, screen }: { slug: string; screen: NavKey }) {
  const { tenant } = await resolveTenant(slug);
  const s = SCREENS[screen];
  return (
    <>
      <PageHeader title={s.title} sub={s.sub(tenant.name)} />
      <EmptyState title="Em construção" body={`Esta tela chega na Fase ${s.phase} do projeto.`} />
    </>
  );
}
