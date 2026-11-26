import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/states";
import { can } from "@/lib/auth/permissions";
import { loadCadence } from "@/lib/plan/load";
import { resolveTenant } from "@/lib/tenant";
import { CadenceEditor } from "./cadence-form";

export const maxDuration = 60;

export default async function CadencePage({ params, searchParams }: PageProps<"/[tenant]/planejamento/cadencia">) {
  const { tenant, role, supabase } = await resolveTenant((await params).tenant);
  const sp = await searchParams;
  const { data: accounts } = await supabase.from("ig_accounts").select("id, username").eq("tenant_id", tenant.id).eq("status", "connected").order("username");
  const account = accounts?.find((a) => a.id === sp.conta) ?? accounts?.[0];
  const month = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : "";
  const back = `/${tenant.slug}/planejamento?${new URLSearchParams({ ...(month ? { mes: month } : {}), ...(account ? { conta: account.id } : {}) })}`;

  const header = <PageHeader title="Cadência de publicação" sub="Dias, horários e formatos de cada semana. A sugestão de temas preenche essas vagas." />;
  if (!account) {
    return (
      <>
        {header}
        <EmptyState title="Conecte uma conta primeiro" body="A cadência é definida por conta do Instagram." action={<Link className="font-semibold text-brand-dark underline" href={`/${tenant.slug}/contas`}>Abrir Contas do Instagram</Link>} />
      </>
    );
  }
  const cadence = await loadCadence(supabase, tenant.id, account.id);

  return (
    <>
      {header}
      <div className="flex flex-col gap-5">
        <nav aria-label="Conta" className="flex flex-wrap items-center gap-3">
          <Link href={back} className="text-[14px] text-brand-dark underline">
            Voltar ao planejamento
          </Link>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Conta">
            {accounts!.map((a) => (
              <Link
                key={a.id}
                href={`/${tenant.slug}/planejamento/cadencia?conta=${a.id}${month ? `&mes=${month}` : ""}`}
                aria-current={a.id === account.id ? "page" : undefined}
                className={`inline-flex h-10 items-center rounded-md px-3 text-[14px] ${a.id === account.id ? "bg-brand-soft font-semibold text-brand-dark" : "text-text-2 hover:bg-brand-soft/60"}`}
              >
                @{a.username}
              </Link>
            ))}
          </div>
        </nav>
        <CadenceEditor
          key={account.id}
          slug={tenant.slug}
          accountId={account.id}
          username={account.username}
          initial={cadence.slots}
          initialNiche={cadence.niche}
          saved={cadence.saved}
          canEdit={can(role, "edit_content")}
          back={back}
        />
      </div>
    </>
  );
}
