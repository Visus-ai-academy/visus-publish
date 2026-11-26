import type { Format } from "@/lib/posts/upload";

/** Formato do app a partir do tipo da mídia do Instagram. */
export function formatOf(mediaType: string | null | undefined, productType: string | null | undefined): Format {
  if (productType === "REELS") return "reels";
  if (productType === "STORY") return "story";
  if (mediaType === "CAROUSEL_ALBUM") return "carousel";
  if (mediaType === "VIDEO") return "reels";
  return "image";
}

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 80);

export type PostToMatch = { id: string; format: Format; caption: string | null; at: Date };
export type MediaToMatch = { igMediaId: string; mediaType?: string | null; productType?: string | null; caption?: string | null; at: Date };

/** Até 6 h de diferença: o Metricool publica uns 2 min depois e a confirmação pode atrasar. */
const WINDOW_MS = 6 * 3_600_000;

/**
 * Casa posts publicados pelo Metricool (sem id do Instagram) com as mídias da conta.
 * Legenda igual vale mais que horário; formato diferente nunca casa. Cada mídia vai para um post só.
 */
export function matchPosts(posts: PostToMatch[], media: MediaToMatch[]): Map<string, string> {
  type Pair = { post: string; media: string; score: number };
  const pairs: Pair[] = [];
  for (const p of posts) {
    const pc = norm(p.caption);
    for (const m of media) {
      const diff = Math.abs(m.at.getTime() - p.at.getTime());
      if (diff > WINDOW_MS) continue;
      if (formatOf(m.mediaType, m.productType) !== p.format) continue;
      const mc = norm(m.caption);
      const sameCaption = pc.length >= 10 && mc.length >= 10 && (mc.startsWith(pc.slice(0, 40)) || pc.startsWith(mc.slice(0, 40)));
      // Sem legenda igual, só casa se estiver bem perto do horário (30 min)
      if (!sameCaption && diff > 30 * 60_000) continue;
      pairs.push({ post: p.id, media: m.igMediaId, score: (sameCaption ? 1_000_000_000 : 0) - diff });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const x of pairs) {
    if (out.has(x.post) || used.has(x.media)) continue;
    out.set(x.post, x.media);
    used.add(x.media);
  }
  return out;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Quando ler as métricas de novo: mídia nova muda rápido, antiga quase nada.
 * Depois de 28 dias, lê uma vez só (o número final).
 */
export function needsRefresh(postedAt: Date, insightsAt: Date | null, now: Date): boolean {
  if (!insightsAt) return true;
  const age = now.getTime() - postedAt.getTime();
  const since = now.getTime() - insightsAt.getTime();
  if (age > 28 * DAY) return insightsAt.getTime() < postedAt.getTime() + 28 * DAY;
  if (age < 2 * DAY) return since >= HOUR - 5 * 60_000;
  if (age < 7 * DAY) return since >= 6 * HOUR;
  return since >= DAY;
}

export const SNAPSHOTS = [
  ["1h", HOUR],
  ["24h", DAY],
  ["72h", 3 * DAY],
  ["7d", 7 * DAY],
  ["28d", 28 * DAY],
] as const;
export type Snapshot = (typeof SNAPSHOTS)[number][0];

/** Foto da SPEC §4 que esta leitura representa (a maior já alcançada), ou null antes de 1 h. */
export function snapshotFor(postedAt: Date, now: Date): Snapshot | null {
  const age = now.getTime() - postedAt.getTime();
  let label: Snapshot | null = null;
  for (const [l, ms] of SNAPSHOTS) if (age >= ms) label = l;
  return label;
}
