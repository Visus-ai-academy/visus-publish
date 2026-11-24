import { listMyTenants, isPlatformAdmin, requireUser } from "@/lib/tenant";
import { signOut } from "@/app/(auth)/actions";
import { Sidebar } from "./sidebar";

export async function AppShell({ current, children }: { current?: { slug: string; name: string }; children: React.ReactNode }) {
  const { user } = await requireUser();
  const [tenants, admin] = await Promise.all([listMyTenants(), isPlatformAdmin()]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        tenants={tenants.map((t) => ({ slug: t.slug, name: t.name }))}
        current={current}
        isPlatformAdmin={admin}
        footer={
          <form action={signOut} className="flex items-center justify-between gap-2 px-1.5">
            <span className="truncate text-[13px] text-text-2" title={user.email}>
              {user.email}
            </span>
            <button className="h-10 shrink-0 rounded-md px-2 text-[13px] font-semibold text-text-2 hover:bg-muted">Sair</button>
          </form>
        }
      />
      <main className="min-w-0 flex-1 px-10 py-8">{children}</main>
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-text-2">{sub}</p>
      </div>
      {actions}
    </header>
  );
}
