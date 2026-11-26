import Link from "next/link";
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

/** Cabeçalho da tela. `back` mostra o botão de voltar nas subtelas de um mesmo menu. */
export function PageHeader({ title, sub, actions, back }: { title: string; sub: string; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-8 flex items-start justify-between gap-4">
      <div>
        {back ? (
          <Link
            href={back.href}
            className="mb-3 inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-[14px] font-semibold text-text-2 transition-colors duration-150 hover:bg-brand-soft/60 hover:text-brand-dark active:scale-[.98] motion-reduce:transition-none"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
            {back.label}
          </Link>
        ) : null}
        <h1 className="border-l-[3px] border-brand pl-3 text-[22px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 pl-[15px] text-text-2">{sub}</p>
      </div>
      {actions}
    </header>
  );
}
