import type { Format } from "@/lib/posts/upload";

/** Uma publicação com as métricas mais recentes (SPEC §8). */
export type MediaRow = {
  id: string;
  postId: string | null;
  title: string;
  format: Format;
  postedAt: Date;
  permalink: string | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  profileVisits: number | null;
  follows: number | null;
};

const n = (v: number | null | undefined) => v ?? 0;

export const interactions = (r: MediaRow) => n(r.likes) + n(r.comments) + n(r.saved) + n(r.shares);

/** Taxa de engajamento = (curtidas + comentários + salvos + compartilhamentos) / alcance. */
export function engagementRate(r: MediaRow): number | null {
  return r.reach && r.reach > 0 ? interactions(r) / r.reach : null;
}

export type Summary = {
  posts: number;
  likes: number;
  comments: number;
  profileVisits: number;
  reach: number;
  follows: number;
  /** Engajamento médio ponderado pelo alcance (0–1), ou null sem alcance. */
  rate: number | null;
};

export function summarize(rows: MediaRow[]): Summary {
  const withReach = rows.filter((r) => r.reach && r.reach > 0);
  const reach = withReach.reduce((s, r) => s + n(r.reach), 0);
  return {
    posts: rows.length,
    likes: rows.reduce((s, r) => s + n(r.likes), 0),
    comments: rows.reduce((s, r) => s + n(r.comments), 0),
    profileVisits: rows.reduce((s, r) => s + n(r.profileVisits), 0),
    reach: rows.reduce((s, r) => s + n(r.reach), 0),
    follows: rows.reduce((s, r) => s + n(r.follows), 0),
    rate: reach > 0 ? withReach.reduce((s, r) => s + interactions(r), 0) / reach : null,
  };
}

/** Variação relativa (0,18 = +18%), ou null quando não há base para comparar. */
export function delta(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous : null;
}

// ---------- Mapa de calor dia × faixa horária ----------

export const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;
/** Faixas horárias: [início, fim) em horas locais. */
export const BANDS = [
  { label: "até 9h", from: 0, to: 9 },
  { label: "9h–12h", from: 9, to: 12 },
  { label: "12h–15h", from: 12, to: 15 },
  { label: "15h–18h", from: 15, to: 18 },
  { label: "18h–21h", from: 18, to: 21 },
  { label: "21h+", from: 21, to: 24 },
] as const;
/** Menos de 3 posts numa célula não vira conclusão (SPEC §8). */
export const MIN_POSTS = 3;

const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<string, number>;

/** Dia da semana (0 = segunda) e hora local no fuso do cliente. */
export function localSlot(at: Date, timeZone: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const day = DOW[parts.find((p) => p.type === "weekday")?.value ?? "Mon"] ?? 0;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return { day, hour };
}

export const bandOf = (hour: number) => BANDS.findIndex((b) => hour >= b.from && hour < b.to);

export type HeatCell = { count: number; rate: number | null; reach: number };

export function heatmap(rows: MediaRow[], timeZone: string): HeatCell[][] {
  const acc = WEEKDAYS.map(() => BANDS.map(() => ({ count: 0, inter: 0, reach: 0 })));
  for (const r of rows) {
    if (!r.reach) continue;
    const { day, hour } = localSlot(r.postedAt, timeZone);
    const c = acc[day][bandOf(hour)];
    c.count++;
    c.inter += interactions(r);
    c.reach += n(r.reach);
  }
  return acc.map((row) => row.map((c) => ({ count: c.count, reach: c.reach, rate: c.reach > 0 ? c.inter / c.reach : null })));
}

// ---------- Formato ----------

export type FormatStat = { format: Format; count: number; rate: number | null; avgReach: number; avgVisits: number };

export function byFormat(rows: MediaRow[]): FormatStat[] {
  const groups = new Map<Format, MediaRow[]>();
  for (const r of rows) groups.set(r.format, [...(groups.get(r.format) ?? []), r]);
  return [...groups.entries()]
    .map(([format, rs]) => {
      const s = summarize(rs);
      return { format, count: rs.length, rate: s.rate, avgReach: Math.round(s.reach / rs.length), avgVisits: Math.round(s.profileVisits / rs.length) };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}

export function topPosts(rows: MediaRow[], limit = 5): MediaRow[] {
  return [...rows].filter((r) => engagementRate(r) !== null).sort((a, b) => engagementRate(b)! - engagementRate(a)!).slice(0, limit);
}

// ---------- Público ----------

export type Share = { label: string; value: number; pct: number };

function shares(dict: Record<string, number> | null | undefined, order?: (a: string, b: string) => number): Share[] {
  const entries = Object.entries(dict ?? {}).filter(([, v]) => typeof v === "number" && v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) return [];
  const list = entries.map(([label, value]) => ({ label, value, pct: value / total }));
  return order ? list.sort((a, b) => order(a.label, b.label)) : list.sort((a, b) => b.value - a.value);
}

export const ageShares = (age: Record<string, number> | null | undefined) =>
  shares(age, (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)).map((s) => ({ ...s, label: s.label.replace("-", "–") }));

const GENDER: Record<string, string> = { F: "Mulheres", M: "Homens", U: "Não informado" };
export const genderShares = (g: Record<string, number> | null | undefined) => shares(g).map((s) => ({ ...s, label: GENDER[s.label] ?? s.label }));

/** Cidades vêm como "Curitiba, Paraná": fica só o nome da cidade. */
export const cityShares = (c: Record<string, number> | null | undefined, limit = 5) =>
  shares(c)
    .slice(0, limit)
    .map((s) => ({ ...s, label: s.label.split(",")[0].trim() }));

// ---------- Formatação pt-BR ----------

export const fmtInt = (v: number) => new Intl.NumberFormat("pt-BR").format(Math.round(v));
export const fmtPct = (v: number | null, digits = 1) => (v === null ? "—" : `${(v * 100).toFixed(digits).replace(".", ",")}%`);
export function fmtDelta(v: number | null) {
  if (v === null) return null;
  const pct = Math.round(v * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;
}
