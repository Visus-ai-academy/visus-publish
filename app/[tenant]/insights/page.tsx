import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { SCREENS } from "@/components/shell/nav";
import { FormatTag } from "@/components/ui/format-tag";
import { EmptyState, ErrorNote } from "@/components/ui/states";
import type { FindingAction } from "@/lib/ai/prompts/analysis";
import { can } from "@/lib/auth/permissions";
import {
  BANDS,
  MIN_POSTS,
  WEEKDAYS,
  ageShares,
  byFormat,
  cityShares,
  delta,
  engagementRate,
  fmtDelta,
  fmtInt,
  fmtPct,
  genderShares,
  heatmap,
  summarize,
  topPosts,
  type MediaRow,
} from "@/lib/insights/aggregate";
import { affected, MIN_ANALYSIS_POSTS } from "@/lib/insights/analysis";
import { loadMediaRows, loadUpcoming, type Upcoming } from "@/lib/insights/load";
import { getMetaConfig } from "@/lib/meta/config";
import { FORMAT_LABELS } from "@/lib/posts/upload";
import { resolveTenant } from "@/lib/tenant";
import { ActionButton } from "./action-button";
import { analyzeNow, applyFinding, refreshInsights } from "./actions";

const DAY = 86_400_000;
const PERIODS = [30, 90] as const;

/** Cor da célula: do quase branco ao oliva escuro, só para células com posts suficientes. */
function heatStyle(t: number) {
  const a = [0xf4, 0xf5, 0xee];
  const b = [0x3d, 0x4d, 0x1c];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return { background: `rgb(${c.join(",")})`, color: t > 0.52 ? "#FFFFFF" : "#16181D" };
}

function actionLabel(a: FindingAction): string | null {
  if (a.type === "reschedule") return `Mover das ${a.params.from_hour}h para as ${a.params.to_hour}h`;
  if (a.type === "change_format") return `Trocar ${FORMAT_LABELS[a.params.from]} por ${FORMAT_LABELS[a.params.to]}`;
  return null;
}

function actionNote(a: FindingAction, n: number): string | null {
  if (a.type === "reschedule") return n ? `${n} post(s) futuro(s) marcado(s) às ${a.params.from_hour}h.` : `Nenhum post futuro marcado às ${a.params.from_hour}h.`;
  if (a.type === "change_format") return n ? `${n} post(s) planejado(s) em ${FORMAT_LABELS[a.params.from]} ainda sem arte.` : `Nenhum post planejado em ${FORMAT_LABELS[a.params.from]} sem arte.`;
  if (a.type === "suggest_themes") return "A IA passa a priorizar esse ângulo ao sugerir os próximos temas.";
  return null;
}

export default async function InsightsPage({ params, searchParams }: PageProps<"/[tenant]/insights">) {
  const { tenant, role, supabase } = await resolveTenant((await params).tenant);
  const sp = await searchParams;
  const canEdit = can(role, "edit_content");
  const isAdmin = can(role, "manage_tenant");
  const days = PERIODS.find((p) => String(p) === sp.periodo) ?? 30;

  const { data: accounts, error: accError } = await supabase
    .from("ig_accounts")
    .select("id, username, ig_user_id, token_expires_at, insights_checked_at, insights_error, publish_via")
    .eq("tenant_id", tenant.id)
    .neq("status", "disconnected")
    .order("username");

  const header = <PageHeader title={SCREENS.insights.title} sub={SCREENS.insights.sub(tenant.name)} />;
  if (accError) {
    return (
      <>
        {header}
        <ErrorNote>Não foi possível carregar as contas.</ErrorNote>
      </>
    );
  }
  if (!accounts.length) {
    return (
      <>
        {header}
        <EmptyState
          title="Nenhuma conta do Instagram neste cliente"
          body="Os insights aparecem depois que uma conta for conectada e tiver publicações."
          action={<Link className="font-semibold text-brand-dark underline" href={`/${tenant.slug}/contas`}>Abrir Contas do Instagram</Link>}
        />
      </>
    );
  }

  const account = accounts.find((a) => a.id === sp.conta) ?? accounts[0];
  const href = (q: { conta?: string; periodo?: number }) => `/${tenant.slug}/insights?conta=${q.conta ?? account.id}&periodo=${q.periodo ?? days}`;
  const linkedToMeta = !account.ig_user_id.startsWith("metricool:") && !!account.token_expires_at;
  const metaReady = getMetaConfig() !== null;
  const checkedFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: tenant.timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const whenFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: tenant.timezone, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  const pills = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Conta" className="inline-flex flex-wrap rounded-md border border-border-strong p-0.5">
        {accounts.map((a) => (
          <Link
            key={a.id}
            href={href({ conta: a.id })}
            aria-current={a.id === account.id ? "true" : undefined}
            className={`inline-flex h-9 items-center rounded-sm px-3 text-[13px] font-semibold transition-colors duration-150 ${a.id === account.id ? "bg-primary text-on-primary" : "text-text-2 hover:bg-muted"}`}
          >
            @{a.username}
          </Link>
        ))}
      </div>
      <div role="group" aria-label="Período" className="inline-flex rounded-md border border-border-strong p-0.5">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={href({ periodo: p })}
            aria-current={p === days ? "true" : undefined}
            className={`inline-flex h-9 items-center rounded-sm px-3 text-[13px] font-semibold tabular-nums transition-colors duration-150 ${p === days ? "bg-primary text-on-primary" : "text-text-2 hover:bg-muted"}`}
          >
            Últimos {p} dias
          </Link>
        ))}
      </div>
    </div>
  );

  if (!linkedToMeta) {
    return (
      <>
        {header}
        <div className="flex max-w-[1120px] flex-col gap-5">
          {pills}
          <EmptyState
            title={`Ligue @${account.username} pela Meta para ver as métricas`}
            body={
              account.publish_via === "metricool"
                ? "Esta conta publica pelo Metricool, que não entrega métricas no plano gratuito. Conecte a mesma conta pelo login da Meta: ela continua publicando pelo Metricool e o app passa a ler curtidas, alcance, horário e público."
                : "O acesso da Meta a esta conta não está ativo. Conecte de novo pelo login da Meta para o app ler as métricas."
            }
            action={
              isAdmin && metaReady ? (
                <a href={`/api/meta/oauth/start?tenant=${tenant.slug}`} className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-semibold text-on-primary transition-transform duration-150 hover:bg-primary-hover active:scale-[.98]">
                  Conectar pela Meta
                </a>
              ) : !metaReady ? (
                <p className="text-[13px] text-muted-fg">O app da Meta ainda não está configurado no servidor. A equipe da Visus faz essa etapa uma vez.</p>
              ) : (
                <p className="text-[13px] text-muted-fg">Peça a um administrador deste cliente para conectar a conta.</p>
              )
            }
          />
        </div>
      </>
    );
  }

  const now = new Date();
  const from = new Date(now.getTime() - days * DAY);
  const prevFrom = new Date(now.getTime() - 2 * days * DAY);
  let rows: MediaRow[] = [];
  let prev: MediaRow[] = [];
  let upcoming: Upcoming[] = [];
  let loadError = false;
  try {
    [rows, prev, upcoming] = await Promise.all([
      loadMediaRows(supabase, tenant.id, account.id, from, now),
      loadMediaRows(supabase, tenant.id, account.id, prevFrom, from),
      loadUpcoming(supabase, tenant.id, account.id, now),
    ]);
  } catch {
    loadError = true;
  }
  const [{ data: daily }, { data: audience }, { data: findingsRaw }] = await Promise.all([
    supabase
      .from("account_insights_daily")
      .select("day, follower_count")
      .eq("tenant_id", tenant.id)
      .eq("ig_account_id", account.id)
      .gte("day", from.toISOString().slice(0, 10))
      .order("day"),
    supabase.from("audience_snapshots").select("age, gender, cities, collected_at").eq("tenant_id", tenant.id).eq("ig_account_id", account.id).order("collected_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("analysis_findings").select("id, title, body, action, applied_at, applied_count, created_at, position").eq("tenant_id", tenant.id).eq("ig_account_id", account.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const latestBatch = findingsRaw?.[0]?.created_at;
  const findings = (findingsRaw ?? []).filter((f) => f.created_at === latestBatch).sort((a, b) => a.position - b.position);

  const status = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-muted-fg">
        Métricas lidas pela Meta
        {account.insights_checked_at ? <> · atualizadas em <span className="tabular-nums">{checkedFmt.format(new Date(account.insights_checked_at))}</span></> : " · primeira leitura em andamento"}
        {account.publish_via === "metricool" ? " · publica pelo Metricool" : null}
      </p>
      {canEdit ? <ActionButton run={refreshInsights.bind(null, tenant.slug, account.id)} label="Atualizar métricas" pendingLabel="Lendo métricas…" variant="ghost" /> : null}
    </div>
  );

  if (loadError) {
    return (
      <>
        {header}
        <div className="flex max-w-[1120px] flex-col gap-5">
          {pills}
          <ErrorNote>Não foi possível carregar as métricas. Recarregue a página.</ErrorNote>
        </div>
      </>
    );
  }

  if (!rows.length) {
    return (
      <>
        {header}
        <div className="flex max-w-[1120px] flex-col gap-5">
          {pills}
          {status}
          {account.insights_error ? <ErrorNote>{account.insights_error}</ErrorNote> : null}
          <EmptyState
            title={`Ainda não há métricas de @${account.username} nos últimos ${days} dias`}
            body={
              account.insights_checked_at
                ? "A conta não tem publicações no feed neste período, ou a Meta ainda não liberou os números. Os Stories não entram: a Meta só mostra as métricas deles por 24 horas."
                : "A primeira leitura traz até 90 dias de histórico e leva alguns minutos. Clique em Atualizar métricas ou volte daqui a pouco."
            }
          />
        </div>
      </>
    );
  }

  const cur = summarize(rows);
  const old = summarize(prev);
  const followers = (daily ?? []).filter((d) => d.follower_count !== null);
  const newFollowers = followers.length >= 2 ? followers[followers.length - 1].follower_count! - followers[0].follower_count! : cur.follows;
  const kpis = [
    { label: "Curtidas", value: fmtInt(cur.likes), d: fmtDelta(prev.length ? delta(cur.likes, old.likes) : null) },
    { label: "Comentários", value: fmtInt(cur.comments), d: fmtDelta(prev.length ? delta(cur.comments, old.comments) : null) },
    { label: "Visitas ao perfil", value: fmtInt(cur.profileVisits), d: fmtDelta(prev.length ? delta(cur.profileVisits, old.profileVisits) : null) },
    { label: "Alcance dos posts", value: fmtInt(cur.reach), d: fmtDelta(prev.length ? delta(cur.reach, old.reach) : null) },
    { label: "Novos seguidores", value: `${newFollowers > 0 ? "+" : ""}${fmtInt(newFollowers)}`, d: null },
    {
      label: "Engajamento médio",
      value: fmtPct(cur.rate),
      d: prev.length && cur.rate !== null && old.rate !== null ? `${cur.rate >= old.rate ? "+" : "−"}${(Math.abs(cur.rate - old.rate) * 100).toFixed(1).replace(".", ",")} p.p.` : null,
    },
  ];

  const heat = heatmap(rows, tenant.timezone);
  const solid = heat.flat().filter((c) => c.count >= MIN_POSTS && c.rate !== null);
  const lo = Math.min(...solid.map((c) => c.rate!));
  const hi = Math.max(...solid.map((c) => c.rate!));
  const formats = byFormat(rows);
  const maxFormat = Math.max(...formats.map((f) => f.rate ?? 0), 0.0001);
  const ages = ageShares(audience?.age as Record<string, number> | null);
  const genders = genderShares(audience?.gender as Record<string, number> | null);
  const cities = cityShares(audience?.cities as Record<string, number> | null);
  const maxAge = Math.max(...ages.map((a) => a.pct), 0.0001);
  const top = topPosts(rows, 8);

  return (
    <>
      {header}
      <div className="flex max-w-[1120px] flex-col gap-5">
        {pills}
        {status}
        {account.insights_error ? <ErrorNote>{account.insights_error}</ErrorNote> : null}

        <section aria-label="Resumo" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] overflow-hidden rounded-lg border border-border">
          {kpis.map((k) => (
            <div key={k.label} className="-mb-px -mr-px flex flex-col gap-0.5 border-r border-b border-border px-4 py-3.5">
              <span className="text-[12px] text-muted-fg">{k.label}</span>
              <span className="text-[22px] font-bold tracking-tight tabular-nums">{k.value}</span>
              <span className="text-[12px] font-semibold text-[#1F6B3A] tabular-nums">{k.d ? `${k.d} vs. ${days} dias antes` : `${cur.posts} publicações`}</span>
            </div>
          ))}
        </section>

        <div className="flex flex-wrap items-stretch gap-5">
          <section aria-labelledby="heat-title" className="flex min-w-0 flex-[999_1_520px] flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h2 id="heat-title" className="text-[15px] font-bold">
                Engajamento por dia e horário
              </h2>
              <span className="text-[12px] text-muted-fg">Taxa média dos posts publicados em cada janela, {tenant.timezone === "America/Sao_Paulo" ? "no horário de Brasília" : `no fuso ${tenant.timezone}`}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-separate border-spacing-[3px] text-[12px]">
                <thead>
                  <tr>
                    <th className="w-11" />
                    {BANDS.map((b) => (
                      <th key={b.label} scope="col" className="pb-1.5 text-center font-normal text-muted-fg">
                        {b.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heat.map((row, d) => (
                    <tr key={WEEKDAYS[d]}>
                      <th scope="row" className="pr-1 text-left font-normal text-text-2">
                        {WEEKDAYS[d]}
                      </th>
                      {row.map((c, b) => {
                        const label = `${WEEKDAYS[d]}, ${BANDS[b].label}: ${c.count} post(s)${c.rate !== null ? `, ${fmtPct(c.rate)}` : ""}`;
                        if (c.count >= MIN_POSTS && c.rate !== null) {
                          const t = hi > lo ? (c.rate - lo) / (hi - lo) : 0.5;
                          return (
                            <td key={b} title={label} className="h-9 rounded-[4px] text-center font-medium tabular-nums" style={heatStyle(t)}>
                              {fmtPct(c.rate)}
                            </td>
                          );
                        }
                        return (
                          <td key={b} title={label} className="h-9 rounded-[4px] border border-dashed border-border-strong text-center text-muted-fg tabular-nums">
                            {c.count ? `${c.count} post${c.count > 1 ? "s" : ""}` : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12px] text-muted-fg">Células tracejadas têm menos de {MIN_POSTS} publicações e ainda não servem de conclusão.</p>
          </section>

          <section aria-label="Formato e público" className="flex flex-[1_1_280px] flex-col gap-3 rounded-lg border border-border p-4">
            <h2 className="text-[15px] font-bold">Por formato</h2>
            {formats.map((f) => (
              <div key={f.format} className="flex flex-col gap-1.5">
                <div className="flex justify-between text-[13px]">
                  <span>
                    {FORMAT_LABELS[f.format]} <span className="text-muted-fg tabular-nums">· {f.count}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{fmtPct(f.rate)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${((f.rate ?? 0) / maxFormat) * 100}%` }} />
                </div>
                <span className="text-[12px] text-muted-fg tabular-nums">Alcance médio {fmtInt(f.avgReach)}</span>
              </div>
            ))}

            <h2 className="mt-2.5 text-[15px] font-bold">Público por idade</h2>
            {ages.length ? (
              <>
                {ages.map((a) => (
                  <div key={a.label} className="grid grid-cols-[48px_1fr_40px] items-center gap-2 text-[12px]">
                    <span className="text-text-2">{a.label}</span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${(a.pct / maxAge) * 100}%` }} />
                    </div>
                    <span className="text-right tabular-nums">{fmtPct(a.pct, 0)}</span>
                  </div>
                ))}
                {genders.length ? <p className="text-[12px] text-muted-fg tabular-nums">{genders.map((g) => `${g.label} ${fmtPct(g.pct, 0)}`).join(" · ")}</p> : null}
                {cities.length ? <p className="text-[12px] text-muted-fg">Principais cidades: {cities.map((c) => c.label).join(", ")}</p> : null}
              </>
            ) : (
              <p className="text-[13px] text-muted-fg">A Meta só mostra o público de contas com pelo menos 100 seguidores. Os dados aparecem aqui quando forem liberados.</p>
            )}
          </section>
        </div>

        <section aria-labelledby="findings-title" className="rounded-lg border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 id="findings-title" className="text-[15px] font-bold">
                O que a análise encontrou
              </h2>
              {latestBatch ? <p className="text-[12px] text-muted-fg tabular-nums">Análise de {checkedFmt.format(new Date(latestBatch))}. Uma nova sai toda semana.</p> : null}
            </div>
            {canEdit ? (
              <ActionButton
                run={analyzeNow.bind(null, tenant.slug, account.id)}
                label={latestBatch ? "Analisar de novo" : "Analisar agora"}
                pendingLabel="Analisando…"
                disabled={rows.length < MIN_ANALYSIS_POSTS}
              />
            ) : null}
          </div>
          {findings.length ? (
            <ol>
              {findings.map((f, i) => {
                const action = (f.action ?? { type: "none", params: {} }) as FindingAction;
                const label = actionLabel(action);
                const n = affected(action, upcoming, tenant.timezone, now);
                const note = f.applied_at ? `Aplicado: ${f.applied_count ?? 0} post(s) mudaram.` : actionNote(action, n);
                return (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-row px-4 py-3.5 last:border-b-0">
                    <div className="flex min-w-0 flex-[1_1_420px] gap-3.5">
                      <span aria-hidden className="flex size-6 flex-none items-center justify-center rounded-md bg-brand-soft text-[12px] font-bold text-brand-dark tabular-nums">
                        {i + 1}
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-semibold">{f.title}</span>
                        <span className="text-[13px] text-text-2">{f.body}</span>
                        {note ? <span className="text-[12px] text-muted-fg">{note}</span> : null}
                      </div>
                    </div>
                    {label ? (
                      f.applied_at ? (
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1F6B3A]">
                          <span aria-hidden className="size-2 rounded-full bg-[#2e8b57]" />
                          {action.type === "reschedule" ? "Horários atualizados" : "Formatos atualizados"}
                        </span>
                      ) : canEdit ? (
                        <ActionButton run={applyFinding.bind(null, tenant.slug, f.id)} label={label} pendingLabel="Aplicando…" disabled={n === 0} />
                      ) : null
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="px-4 py-6 text-text-2">
              {rows.length < MIN_ANALYSIS_POSTS
                ? `A análise começa quando a conta tiver ${MIN_ANALYSIS_POSTS} publicações com métricas (agora: ${rows.length}).`
                : canEdit
                  ? "Ainda não há análise desta conta. Clique em Analisar agora: a IA lê os números agregados e sugere ajustes de horário, formato e tema."
                  : "Ainda não há análise desta conta. Ela sai uma vez por semana."}
            </p>
          )}
        </section>

        <section aria-labelledby="top-title" className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-3">
            <h2 id="top-title" className="text-[15px] font-bold">
              Publicações com melhor desempenho
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-brand/40 text-brand-dark">
                  <th className="px-4 py-2 font-medium">Publicação</th>
                  <th className="py-2 pr-4 font-medium">Formato</th>
                  <th className="py-2 pr-4 font-medium">Publicado</th>
                  <th className="py-2 pr-4 text-right font-medium">Alcance</th>
                  <th className="py-2 pr-4 text-right font-medium">Curtidas</th>
                  <th className="py-2 pr-4 text-right font-medium">Comentários</th>
                  <th className="py-2 pr-4 text-right font-medium">Visitas ao perfil</th>
                  <th className="py-2 pr-4 text-right font-medium">Engajamento</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.id} className="border-b border-row transition-colors duration-150 last:border-b-0 hover:bg-subtle">
                    <td className="max-w-[320px] px-4 py-2.5 font-semibold">
                      {r.permalink ? (
                        <a href={r.permalink} target="_blank" rel="noreferrer" className="hover:underline">
                          {r.title}
                        </a>
                      ) : (
                        r.title
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <FormatTag format={r.format} />
                    </td>
                    <td className="py-2.5 pr-4 text-text-2 tabular-nums">{whenFmt.format(r.postedAt)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{fmtInt(r.reach ?? 0)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{fmtInt(r.likes ?? 0)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{fmtInt(r.comments ?? 0)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{r.profileVisits === null ? "—" : fmtInt(r.profileVisits)}</td>
                    <td className="py-2.5 pr-4 text-right font-semibold tabular-nums">{fmtPct(engagementRate(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
