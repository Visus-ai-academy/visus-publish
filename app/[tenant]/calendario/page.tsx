import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { SCREENS } from "@/components/shell/nav";
import { EmptyState, ErrorNote } from "@/components/ui/states";
import { StatusDot } from "@/components/ui/status";
import { can } from "@/lib/auth/permissions";
import { FORMAT_LABELS } from "@/lib/posts/upload";
import { resolveTenant } from "@/lib/tenant";
import { monthRange, shiftMonth, utcToZoned } from "@/lib/time";
import { PostButtons } from "../post-buttons";

export default async function CalendarPage({ params, searchParams }: PageProps<"/[tenant]/calendario">) {
  const { tenant, role, supabase } = await resolveTenant((await params).tenant);
  const sp = await searchParams;
  const current = utcToZoned(new Date(), tenant.timezone).date.slice(0, 7);
  const month = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : current;
  const { start, end } = monthRange(month, tenant.timezone);
  const canPublish = can(role, "publish");

  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, theme, format, status, scheduled_at, published_at, permalink, last_error, ig_accounts(username)")
    .eq("tenant_id", tenant.id)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .order("scheduled_at");

  const [y, m] = month.split("-").map(Number);
  const title = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone: tenant.timezone, weekday: "short", day: "2-digit", month: "short" });
  const hour = new Intl.DateTimeFormat("pt-BR", { timeZone: tenant.timezone, hour: "2-digit", minute: "2-digit" });

  const nav = (delta: number, label: string) => (
    <Link
      href={`/${tenant.slug}/calendario?mes=${shiftMonth(month, delta)}`}
      aria-label={label}
      className="inline-flex size-10 items-center justify-center rounded-md border border-border-strong hover:bg-subtle"
    >
      {delta < 0 ? "‹" : "›"}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={SCREENS.calendario.title}
        sub={SCREENS.calendario.sub(tenant.name)}
        actions={
          can(role, "edit_content") ? (
            <Link href={`/${tenant.slug}/criativos`} className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-semibold text-on-primary hover:bg-[#2a2d34]">
              Subir criativo
            </Link>
          ) : null
        }
      />
      <div className="flex max-w-[1120px] flex-col gap-4">
        <div className="flex items-center gap-3">
          {nav(-1, "Mês anterior")}
          <h2 className="min-w-[180px] text-center text-[16px] font-semibold first-letter:uppercase">{title}</h2>
          {nav(1, "Próximo mês")}
          <span className="ml-2 text-text-2 tabular-nums">{posts?.length ?? 0} publicações</span>
        </div>

        {error ? (
          <ErrorNote>Não foi possível carregar o calendário.</ErrorNote>
        ) : posts.length === 0 ? (
          <EmptyState title="Nada agendado neste mês" body="Suba um criativo pronto para agendar a primeira publicação." />
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[13px] text-muted-fg">
                <th className="py-2 pr-4 font-medium">Data</th>
                <th className="py-2 pr-4 font-medium">Hora</th>
                <th className="py-2 pr-4 font-medium">Tema</th>
                <th className="py-2 pr-4 font-medium">Conta</th>
                <th className="py-2 pr-4 font-medium">Formato</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => {
                const actions: Array<"publish" | "cancel" | "retry"> = !canPublish
                  ? []
                  : p.status === "scheduled"
                    ? ["publish", "cancel"]
                    : p.status === "failed"
                      ? ["retry"]
                      : [];
                return (
                  <tr key={p.id} className="border-b border-row align-top">
                    <td className="py-3 pr-4 whitespace-nowrap">{day.format(new Date(p.scheduled_at))}</td>
                    <td className="py-3 pr-4 tabular-nums">{hour.format(new Date(p.scheduled_at))}</td>
                    <td className="py-3 pr-4">
                      <p className="font-medium">{p.theme}</p>
                      {p.status === "failed" && p.last_error ? <p className="text-[13px] text-danger">{p.last_error}</p> : null}
                    </td>
                    <td className="py-3 pr-4 text-text-2">@{p.ig_accounts?.username}</td>
                    <td className="py-3 pr-4">{FORMAT_LABELS[p.format]}</td>
                    <td className="py-3 pr-4">
                      <StatusDot status={p.status} />
                    </td>
                    <td className="py-1.5">
                      {p.status === "published" && p.permalink ? (
                        <a href={p.permalink} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-md px-2.5 text-[13px] font-semibold hover:bg-muted">
                          Ver no Instagram
                        </a>
                      ) : actions.length ? (
                        <PostButtons slug={tenant.slug} postId={p.id} actions={actions} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
