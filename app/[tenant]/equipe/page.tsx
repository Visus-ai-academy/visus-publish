import { PageHeader } from "@/components/shell/app-shell";
import { SCREENS } from "@/components/shell/nav";
import { ErrorNote } from "@/components/ui/states";
import { ROLE_LABELS, can, type Role } from "@/lib/auth/permissions";
import { resolveTenant } from "@/lib/tenant";
import { InviteForm } from "./invite-form";

type Member = { user_id: string; email: string; role: Role };
type Invite = { id: string; email: string; role: Role; expires_at: string };

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

export default async function TeamPage({ params }: PageProps<"/[tenant]/equipe">) {
  const { tenant, role, supabase } = await resolveTenant((await params).tenant);
  const isAdmin = can(role, "manage_tenant");

  const [members, invites] = await Promise.all([
    supabase.rpc("tenant_members", { p_tenant: tenant.id }),
    isAdmin
      ? supabase
          .from("invitations")
          .select("id, email, role, expires_at")
          .eq("tenant_id", tenant.id)
          .is("accepted_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("email")
      : Promise.resolve({ data: [] as Invite[], error: null }),
  ]);

  return (
    <>
      <PageHeader title={SCREENS.equipe.title} sub={SCREENS.equipe.sub(tenant.name)} />
      <div className="flex max-w-[960px] flex-col gap-8">
        {isAdmin ? <InviteForm slug={tenant.slug} /> : null}

        {members.error ? (
          <ErrorNote>Não foi possível carregar as pessoas.</ErrorNote>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-brand/40 text-[13px] text-brand-dark">
                <th className="py-2 pr-4 font-medium">Pessoa</th>
                <th className="py-2 pr-4 font-medium">Papel</th>
                <th className="py-2 font-medium">O que pode fazer</th>
              </tr>
            </thead>
            <tbody>
              {(members.data as Member[]).map((m) => (
                <tr key={m.user_id} className="border-b border-row">
                  <td className="py-3 pr-4 font-medium">{m.email}</td>
                  <td className="py-3 pr-4">{ROLE_LABELS[m.role].name}</td>
                  <td className="py-3 text-text-2">{ROLE_LABELS[m.role].description}</td>
                </tr>
              ))}
              {(invites.data as Invite[]).map((i) => (
                <tr key={i.id} className="border-b border-row">
                  <td className="py-3 pr-4 text-text-2">{i.email}</td>
                  <td className="py-3 pr-4">{ROLE_LABELS[i.role].name}</td>
                  <td className="py-3 text-text-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="size-2 rounded-full bg-[var(--st-pending)]" />
                      Convite pendente até <span className="tabular-nums">{dateFmt.format(new Date(i.expires_at))}</span>
                    </span>
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
