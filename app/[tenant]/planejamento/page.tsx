import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { SCREENS } from "@/components/shell/nav";
import { EmptyState, ErrorNote } from "@/components/ui/states";
import { StatusDot } from "@/components/ui/status";
import { firstMediaUrls, Thumb } from "@/components/ui/thumb";
import { PROVIDER_LABELS, type CaptionProviderId } from "@/lib/ai/providers";
import { can } from "@/lib/auth/permissions";
import { FORMAT_LABELS } from "@/lib/posts/upload";
import { resolveTenant } from "@/lib/tenant";
import { monthRange, shiftMonth, tomorrowIn, utcToZoned } from "@/lib/time";
import { AddItemForm, GenerateAll, RowActions, SuggestForm } from "./plan-forms";

// Cada geração (legenda + arte) roda numa chamada; carrossel pode levar alguns minutos
export const maxDuration = 300;

const GENERATABLE = new Set(["planned", "rejected", "generation_failed"]);

export default async function PlanningPage({ params, searchParams }: PageProps<"/[tenant]/planejamento">) {
  const { tenant, role, supabase } = await resolveTenant((await params).tenant);
  const sp = await searchParams;
  const canEdit = can(role, "edit_content");
  const current = utcToZoned(new Date(), tenant.timezone).date.slice(0, 7);
  const month = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : current;
  const { start, end } = monthRange(month, tenant.timezone);

  const { data: accounts } = await supabase.from("ig_accounts").select("id, username, require_approval").eq("tenant_id", tenant.id).eq("status", "connected").order("username");
  const account = accounts?.find((a) => a.id === sp.conta) ?? accounts?.[0];

  const header = <PageHeader title={SCREENS.planejamento.title} sub={SCREENS.planejamento.sub(tenant.name)} />;
  if (!account) {
    return (
      <>
        {header}
        <EmptyState
          title="Conecte uma conta para planejar"
          body="O planejamento é feito por conta do Instagram."
          action={<Link className="font-semibold underline" href={`/${tenant.slug}/contas`}>Abrir Contas do Instagram</Link>}
        />
      </>
    );
  }

  const { data: rows, error } = await supabase
    .from("posts")
    .select("id, theme, format, status, scheduled_at, caption, caption_provider, media_provider, origin, last_error, compliance_flags, post_media(storage_path, kind, position)")
    .eq("tenant_id", tenant.id)
    .eq("ig_account_id", account.id)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .order("scheduled_at");

  const thumbOf = await firstMediaUrls(supabase.storage, rows ?? []);
  const [y, m] = month.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: tenant.timezone, weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const base = `/${tenant.slug}/planejamento`;
  const q = (o: { mes?: string; conta?: string }) => `${base}?mes=${o.mes ?? month}&conta=${o.conta ?? account.id}`;
  const pending = (rows ?? []).filter((r) => r.origin === "ai" && GENERATABLE.has(r.status) && !(r.status === "planned" && r.caption));
  const providerLabel = (p: string | null) => (p && p in PROVIDER_LABELS ? PROVIDER_LABELS[p as CaptionProviderId] : "—");
  const defaultDate = month === current ? tomorrowIn(tenant.timezone) : `${month}-01`;

  return (
    <>
      {header}
      <div className="flex flex-col gap-5">
        <nav aria-label="Conta e mês" className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Conta">
            {accounts!.map((a) => (
              <Link
                key={a.id}
                href={q({ conta: a.id })}
                aria-current={a.id === account.id ? "page" : undefined}
                className={`inline-flex h-10 items-center rounded-md px-3 text-[14px] ${a.id === account.id ? "bg-muted font-semibold" : "text-text-2 hover:bg-subtle"}`}
              >
                @{a.username}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href={q({ mes: shiftMonth(month, -1) })} aria-label="Mês anterior" className="inline-flex size-10 items-center justify-center rounded-md border border-border-strong hover:bg-subtle">
              ‹
            </Link>
            <span className="min-w-32 text-center font-semibold capitalize tabular-nums">
              {monthName} {y}
            </span>
            <Link href={q({ mes: shiftMonth(month, 1) })} aria-label="Próximo mês" className="inline-flex size-10 items-center justify-center rounded-md border border-border-strong hover:bg-subtle">
              ›
            </Link>
          </div>
        </nav>

        <section className="flex flex-wrap items-start gap-5">
          {canEdit ? (
            <div className="flex flex-[1_1_300px] flex-col gap-5 rounded-lg border border-border p-5">
              <AddItemForm slug={tenant.slug} accountId={account.id} defaultDate={defaultDate} />
              <div className="border-t border-border pt-5">
                <SuggestForm slug={tenant.slug} accountId={account.id} month={month} monthName={monthName} />
              </div>
              <p className="border-t border-border pt-4 text-[13px] text-text-2">
                Depois de gerar, @{account.username} {account.require_approval ? "manda os posts para aprovação." : "agenda direto (posts com alerta de saúde vão para aprovação)."}{" "}
                <Link href={`/${tenant.slug}/contas`} className="underline">
                  Mudar em Contas
                </Link>
              </p>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-[999_1_560px] flex-col rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5">
              <div>
                <h2 className="text-[15px] font-semibold">
                  Plano de {monthName} · @{account.username}
                </h2>
                <p className="text-[13px] tabular-nums text-text-2">
                  {rows?.length ?? 0} itens · {pending.length} sem conteúdo gerado
                </p>
              </div>
              {canEdit && pending.length ? <GenerateAll slug={tenant.slug} ids={pending.map((r) => r.id)} /> : null}
            </div>
            {error ? (
              <div className="p-4">
                <ErrorNote>Não foi possível carregar o planejamento.</ErrorNote>
              </div>
            ) : !rows.length ? (
              <p className="p-4 text-text-2">Nada planejado para {monthName}. Adicione um tema ou peça sugestões à IA.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[660px] border-collapse text-left text-[14px]">
                  <thead>
                    <tr className="border-b border-border text-[13px] text-muted-fg">
                      <th className="px-4 py-2 font-medium">Data</th>
                      <th className="py-2 pr-3 font-medium">
                        <span className="sr-only">Mídia</span>
                      </th>
                      <th className="py-2 pr-4 font-medium">Tema</th>
                      <th className="py-2 pr-4 font-medium">Formato</th>
                      <th className="py-2 pr-4 font-medium">Gerado por</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const waitingVideo = r.status === "planned" && r.format === "reels" && !!r.caption && !r.post_media.length;
                      return (
                        <tr key={r.id} className="border-b border-row align-top">
                          <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums">{fmt.format(new Date(r.scheduled_at))}</td>
                          <td className="py-2 pr-3">
                            <Thumb {...thumbOf(r.id)} alt={r.theme} />
                          </td>
                          <td className="py-3 pr-4">
                            <Link href={`${base}/${r.id}`} className="font-medium hover:underline">
                              {r.theme}
                            </Link>
                            {r.status === "generation_failed" && r.last_error ? <p className="text-[13px] text-danger">{r.last_error}</p> : null}
                            {r.compliance_flags.length ? <p className="text-[13px] text-danger">Atenção: {r.compliance_flags.join("; ")}</p> : null}
                          </td>
                          <td className="py-3 pr-4 text-text-2">{FORMAT_LABELS[r.format]}</td>
                          <td className="py-3 pr-4 text-text-2">{r.origin === "upload" ? "Equipe" : providerLabel(r.media_provider ?? r.caption_provider)}</td>
                          <td className="py-3 pr-4">{waitingVideo ? <span className="text-text-2">Aguardando vídeo</span> : <StatusDot status={r.status} />}</td>
                          <td className="py-3 pr-4 text-right">
                            {canEdit ? <RowActions slug={tenant.slug} postId={r.id} canGenerate={r.origin === "ai" && GENERATABLE.has(r.status)} regenerate={!!r.caption} /> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
