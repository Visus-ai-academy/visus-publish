import type { SupabaseClient } from "@supabase/supabase-js";
import { pickProvider } from "@/lib/ai/caption";
import { charge, type Charge } from "@/lib/ai/credits";
import { analysisOutputSchema, analysisPrompt, toFindings, type Finding, type FindingAction } from "@/lib/ai/prompts/analysis";
import { captionProvider, type ProvidersConfig } from "@/lib/ai/providers";
import { AiProviderError } from "@/lib/ai/providers/types";
import { FORMAT_LABELS } from "@/lib/posts/upload";
import type { Database } from "@/lib/supabase/database.types";
import { utcToZoned, zonedToUtc } from "@/lib/time";
import { BANDS, MIN_POSTS, WEEKDAYS, ageShares, byFormat, cityShares, engagementRate, genderShares, heatmap, localSlot, summarize, type MediaRow } from "./aggregate";
import { loadMediaRows, loadUpcoming, type Upcoming } from "./load";

type Db = SupabaseClient<Database>; // service_role: toda query filtra tenant_id

export const ANALYSIS_DAYS = 90;
const DAY = 86_400_000;
/** Menos que isso não dá para tirar conclusão. */
export const MIN_ANALYSIS_POSTS = 5;

export class AnalysisError extends Error {}

const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
const SUN_FIRST = [1, 2, 3, 4, 5, 6, 0]; // índice 0 = segunda → dow do Postgres (0 = domingo)

/** Posts futuros que a ação muda agora (a mesma regra da função apply_finding do banco). */
export function affected(action: FindingAction | null | undefined, upcoming: Upcoming[], timeZone: string, now = new Date()): number {
  if (!action) return 0;
  if (action.type === "reschedule") {
    const { from_hour, to_hour, weekdays } = action.params;
    return upcoming.filter((p) => {
      if (p.scheduledAt <= now) return false;
      const { day, hour } = localSlot(p.scheduledAt, timeZone);
      if (hour !== from_hour) return false;
      if (weekdays?.length && !weekdays.includes(SUN_FIRST[day])) return false;
      const target = zonedToUtc(utcToZoned(p.scheduledAt, timeZone).date, `${String(to_hour).padStart(2, "0")}:00`, timeZone);
      return target > now;
    }).length;
  }
  if (action.type === "change_format") {
    return upcoming.filter((p) => p.status === "planned" && p.format === action.params.from && !p.hasMedia && p.scheduledAt > now).length;
  }
  return 0;
}

/** Agregados que vão para a IA: números da conta, sem dados de terceiros. */
export function analysisData(rows: MediaRow[], audience: { age?: unknown; gender?: unknown; cities?: unknown } | null, upcoming: Upcoming[], timeZone: string) {
  const s = summarize(rows);
  const heat = heatmap(rows, timeZone);
  const cells = heat.flatMap((row, d) =>
    row.map((c, b) => ({ dia: WEEKDAYS[d], faixa: BANDS[b].label, posts: c.count, engajamento_pct: pct(c.rate) })).filter((c) => c.posts > 0),
  );
  const ranked = [...rows].filter((r) => engagementRate(r) !== null).sort((a, b) => engagementRate(b)! - engagementRate(a)!);
  const post = (r: MediaRow) => {
    const { day, hour } = localSlot(r.postedAt, timeZone);
    return { titulo: r.title, formato: FORMAT_LABELS[r.format], dia: WEEKDAYS[day], hora: hour, alcance: r.reach, engajamento_pct: pct(engagementRate(r)), visitas_perfil: r.profileVisits };
  };
  // Próximos posts agrupados por hora local, para a IA saber o que dá para mover
  const groups = new Map<string, { hora: number; dias: Set<string>; formatos: Set<string>; planejados_sem_arte: number; quantidade: number }>();
  for (const p of upcoming) {
    const { day, hour } = localSlot(p.scheduledAt, timeZone);
    const key = String(hour);
    const g = groups.get(key) ?? { hora: hour, dias: new Set(), formatos: new Set(), planejados_sem_arte: 0, quantidade: 0 };
    g.dias.add(WEEKDAYS[day]);
    g.formatos.add(FORMAT_LABELS[p.format]);
    g.quantidade++;
    if (p.status === "planned" && !p.hasMedia) g.planejados_sem_arte++;
    groups.set(key, g);
  }
  const asDict = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, number>) : null);
  return {
    resumo: { posts: s.posts, alcance_total: s.reach, curtidas: s.likes, comentarios: s.comments, visitas_perfil: s.profileVisits, engajamento_medio_pct: pct(s.rate) },
    minimo_posts_por_celula: MIN_POSTS,
    mapa_de_calor: cells,
    por_formato: byFormat(rows).map((f) => ({ formato: FORMAT_LABELS[f.format], posts: f.count, engajamento_pct: pct(f.rate), alcance_medio: f.avgReach, visitas_medias: f.avgVisits })),
    melhores: ranked.slice(0, 5).map(post),
    piores: ranked.length > 8 ? ranked.slice(-3).map(post) : [],
    publico: audience
      ? {
          idade: ageShares(asDict(audience.age)).map((x) => ({ faixa: x.label, pct: pct(x.pct) })),
          genero: genderShares(asDict(audience.gender)).map((x) => ({ grupo: x.label, pct: pct(x.pct) })),
          cidades: cityShares(asDict(audience.cities)).map((x) => ({ cidade: x.label, pct: pct(x.pct) })),
        }
      : null,
    proximos: [...groups.values()]
      .sort((a, b) => a.hora - b.hora)
      .map((g) => ({ hora: g.hora, dias: [...g.dias], formatos: [...g.formatos], quantidade: g.quantidade, planejados_sem_arte: g.planejados_sem_arte })),
  };
}

const publicMessage = (e: unknown) => (e instanceof AiProviderError || e instanceof AnalysisError ? e.message : "Não foi possível analisar agora. Tente de novo.");

/**
 * Gera os achados da conta com a IA de texto do cliente (debita créditos antes, estorna se falhar)
 * e troca os achados ainda não aplicados pelos novos.
 */
export async function runAnalysis(db: Db, tenantId: string, accountId: string, opts: { providers?: ProvidersConfig; now?: Date } = {}): Promise<Finding[]> {
  const now = opts.now ?? new Date();
  const [{ data: account }, { data: tenant }, { data: brand }] = await Promise.all([
    db.from("ig_accounts").select("id, username").eq("tenant_id", tenantId).eq("id", accountId).maybeSingle(),
    db.from("tenants").select("timezone").eq("id", tenantId).maybeSingle(),
    db.from("brand_profiles").select("is_healthcare").eq("tenant_id", tenantId).eq("ig_account_id", accountId).maybeSingle(),
  ]);
  if (!account || !tenant) throw new AnalysisError("Conta não encontrada.");
  const from = new Date(now.getTime() - ANALYSIS_DAYS * DAY);
  const rows = await loadMediaRows(db, tenantId, accountId, from, now);
  if (rows.length < MIN_ANALYSIS_POSTS) throw new AnalysisError(`A análise precisa de pelo menos ${MIN_ANALYSIS_POSTS} publicações com métricas nos últimos ${ANALYSIS_DAYS} dias.`);
  const { data: aud } = await db
    .from("audience_snapshots")
    .select("age, gender, cities")
    .eq("tenant_id", tenantId)
    .eq("ig_account_id", accountId)
    .order("collected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const upcoming = await loadUpcoming(db, tenantId, accountId, now);

  const provider = await pickProvider(db, tenantId, "caption");
  if (!provider) throw new AnalysisError("A IA ainda não foi configurada. Um administrador precisa cadastrar a chave de IA.");
  const prompt = analysisPrompt({ username: account.username, days: ANALYSIS_DAYS, isHealthcare: !!brand?.is_healthcare, data: analysisData(rows, aud, upcoming, tenant.timezone) });
  const request = { source: "analysis", account_id: accountId, posts: rows.length };
  let credits: Charge | null = null;
  try {
    // A análise usa o modelo de texto do cliente e custa como uma legenda
    credits = await charge(db, tenantId, { provider: provider.id, task: "caption", model: provider.model });
    const raw = await captionProvider(provider.id, opts.providers).generateCaption({ apiKey: provider.key, model: provider.model, system: prompt.system, user: prompt.user, images: [] });
    const parsed = analysisOutputSchema.safeParse(raw);
    if (!parsed.success) throw new AiProviderError("A IA respondeu num formato inesperado. Tente de novo.");
    const findings = toFindings(parsed.data);
    if (!findings.length) throw new AiProviderError("A IA não encontrou achados. Tente de novo mais tarde.");

    // Troca os achados pendentes pelos novos; os já aplicados ficam no histórico
    await db.from("analysis_findings").delete().eq("tenant_id", tenantId).eq("ig_account_id", accountId).is("applied_at", null);
    const period = { period_start: utcToZoned(from, tenant.timezone).date, period_end: utcToZoned(now, tenant.timezone).date };
    const { error } = await db.from("analysis_findings").insert(
      findings.map((f, i) => ({
        tenant_id: tenantId,
        ig_account_id: accountId,
        ...period,
        title: f.title,
        body: f.body,
        evidence: f.evidence as Database["public"]["Tables"]["analysis_findings"]["Insert"]["evidence"],
        action: f.action,
        model: provider.model,
        position: i + 1,
        created_at: now.toISOString(),
      })),
    );
    if (error) throw new Error(`analysis_findings: ${error.message}`);
    await db.from("generation_jobs").insert({ tenant_id: tenantId, task: "analysis", provider: provider.id, model: provider.model, status: "succeeded", credits: credits.amount || null, request, result: { findings: findings.length }, finished_at: new Date().toISOString() });
    return findings;
  } catch (e) {
    await credits?.refund();
    await db.from("generation_jobs").insert({ tenant_id: tenantId, task: "analysis", provider: provider.id, model: provider.model, status: "failed", request, error: publicMessage(e), finished_at: new Date().toISOString() });
    if (!(e instanceof AiProviderError)) console.error("runAnalysis", e instanceof Error ? e.message : e);
    throw new AnalysisError(publicMessage(e));
  }
}

/** Rotina `weekly-analysis`: contas com métricas suficientes e sem análise na última semana. */
export async function weeklyAnalysis(db: Db, opts: { providers?: ProvidersConfig; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const { data: accounts, error } = await db
    .from("ig_accounts")
    .select("id, tenant_id, tenants!inner(status)")
    .eq("tenants.status", "active")
    .not("insights_checked_at", "is", null);
  if (error) throw new Error(error.message);
  const out: Array<{ accountId: string; ok: boolean; error?: string }> = [];
  for (const a of accounts ?? []) {
    const { data: last } = await db
      .from("analysis_findings")
      .select("created_at")
      .eq("tenant_id", a.tenant_id)
      .eq("ig_account_id", a.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last && now.getTime() - new Date(last.created_at).getTime() < 6 * DAY) continue;
    try {
      await runAnalysis(db, a.tenant_id, a.id, opts);
      out.push({ accountId: a.id, ok: true });
    } catch (e) {
      out.push({ accountId: a.id, ok: false, error: e instanceof Error ? e.message : "erro" });
    }
  }
  return out;
}

/** Ângulos de conteúdo que a análise mais recente pediu para priorizar (vão para a sugestão de temas). */
export async function themeLearnings(db: Db, tenantId: string, accountId: string): Promise<string[]> {
  const { data } = await db
    .from("analysis_findings")
    .select("title, action, created_at")
    .eq("tenant_id", tenantId)
    .eq("ig_account_id", accountId)
    .gte("created_at", new Date(Date.now() - 60 * DAY).toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? [])
    .map((f) => {
      const a = f.action as { type?: string; params?: { angle?: string } } | null;
      return a?.type === "suggest_themes" && a.params?.angle ? `${a.params.angle} (${f.title})` : null;
    })
    .filter((x): x is string => !!x)
    .slice(0, 3);
}
