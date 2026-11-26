import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { EmptyState, ErrorNote } from "@/components/ui/states";
import { requireUser } from "@/lib/tenant";
import { setTenantStatus } from "./actions";
import { CreateTenantForm } from "./create-form";

export const metadata = { title: "Clientes · Visus Publish" };

type Row = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: "active" | "suspended";
  memberships: { count: number }[];
  ig_accounts: { count: number }[];
};

export default async function ClientsPage() {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, name, plan, status, memberships(count), ig_accounts(count)")
    .order("name");

  return (
    <>
      <PageHeader title="Clientes" sub="Todos os clientes da plataforma, com plano, uso e status." />
      <div className="flex max-w-[1040px] flex-col gap-8">
        <CreateTenantForm />
        {error ? (
          <ErrorNote>Não foi possível carregar os clientes.</ErrorNote>
        ) : data.length === 0 ? (
          <EmptyState title="Nenhum cliente ainda" body="Crie o primeiro cliente acima. O administrador dele recebe um link de convite." />
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-brand/40 text-[13px] text-brand-dark">
                <th className="py-2 pr-4 font-medium">Cliente</th>
                <th className="py-2 pr-4 font-medium">Plano</th>
                <th className="py-2 pr-4 text-right font-medium">Contas</th>
                <th className="py-2 pr-4 text-right font-medium">Pessoas</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(data as Row[]).map((t) => (
                <tr key={t.id} className="border-b border-row">
                  <td className="py-3 pr-4 font-medium">{t.name}</td>
                  <td className="py-3 pr-4 text-text-2">{t.plan}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{t.ig_accounts[0]?.count ?? 0}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{t.memberships[0]?.count ?? 0}</td>
                  <td className="py-3 pr-4">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className={`size-2 rounded-full ${t.status === "active" ? "bg-[var(--st-scheduled)]" : "bg-[var(--st-rejected)]"}`}
                      />
                      {t.status === "active" ? "Ativo" : "Suspenso"}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1">
                      <Link href={`/${t.slug}/calendario`} className="inline-flex h-10 items-center rounded-md px-2.5 font-semibold hover:bg-muted">
                        Acessar
                      </Link>
                      <form action={setTenantStatus.bind(null, t.id, t.status === "active" ? "suspended" : "active")}>
                        <button className="h-10 rounded-md px-2.5 font-semibold text-text-2 hover:bg-muted">
                          {t.status === "active" ? "Suspender" : "Reativar"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
