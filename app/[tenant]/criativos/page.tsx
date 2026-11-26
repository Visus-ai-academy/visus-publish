import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { SCREENS } from "@/components/shell/nav";
import { EmptyState, ErrorNote } from "@/components/ui/states";
import { StatusDot } from "@/components/ui/status";
import { can } from "@/lib/auth/permissions";
import { FORMAT_LABELS } from "@/lib/posts/upload";
import { resolveTenant } from "@/lib/tenant";
import { tomorrowIn } from "@/lib/time";
import { UploadForm } from "./upload-form";

export default async function CreativesPage({ params }: PageProps<"/[tenant]/criativos">) {
  const { tenant, role, supabase } = await resolveTenant((await params).tenant);
  const canEdit = can(role, "edit_content");

  const [accounts, recent] = await Promise.all([
    supabase.from("ig_accounts").select("id, username, require_approval").eq("tenant_id", tenant.id).eq("status", "connected").order("username"),
    supabase
      .from("posts")
      .select("id, theme, format, status, scheduled_at, ig_accounts(username)")
      .eq("tenant_id", tenant.id)
      .eq("origin", "upload")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: tenant.timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const tomorrow = tomorrowIn(tenant.timezone);

  return (
    <>
      <PageHeader title={SCREENS.criativos.title} sub={SCREENS.criativos.sub(tenant.name)} />
      <div className="flex max-w-[1040px] flex-col gap-8">
        {!canEdit ? null : accounts.data?.length ? (
          <UploadForm slug={tenant.slug} accounts={accounts.data} defaultDate={tomorrow} />
        ) : (
          <EmptyState
            title="Conecte uma conta antes de subir criativos"
            body="Os posts saem por uma conta do Instagram conectada a este cliente."
            action={<Link className="font-semibold text-brand-dark underline" href={`/${tenant.slug}/contas`}>Abrir Contas do Instagram</Link>}
          />
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">Biblioteca</h2>
          {recent.error ? (
            <ErrorNote>Não foi possível carregar os criativos.</ErrorNote>
          ) : recent.data.length === 0 ? (
            <p className="text-text-2">Nenhum arquivo deste cliente ainda.</p>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-brand/40 text-[13px] text-brand-dark">
                  <th className="py-2 pr-4 font-medium">Data</th>
                  <th className="py-2 pr-4 font-medium">Tema</th>
                  <th className="py-2 pr-4 font-medium">Conta</th>
                  <th className="py-2 pr-4 font-medium">Formato</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.map((p) => (
                  <tr key={p.id} className="border-b border-row">
                    <td className="py-3 pr-4 tabular-nums">{fmt.format(new Date(p.scheduled_at))}</td>
                    <td className="py-3 pr-4 font-medium">{p.theme}</td>
                    <td className="py-3 pr-4 text-text-2">@{p.ig_accounts?.username}</td>
                    <td className="py-3 pr-4">{FORMAT_LABELS[p.format]}</td>
                    <td className="py-3">
                      <StatusDot status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
