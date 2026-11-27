import type { SupabaseClient } from "@supabase/supabase-js";
import * as meta from "@/lib/meta/client";
import type { Format } from "@/lib/posts/upload";
import type { Database } from "@/lib/supabase/database.types";
import { utcToZoned, zonedToUtc } from "@/lib/time";
import { matchPosts, needsRefresh, snapshotFor } from "./match";

type Db = SupabaseClient<Database>; // service_role: toda query filtra tenant_id

/** O que a coleta usa da Meta. Os testes trocam por uma Meta simulada. */
export type InsightsPort = {
  listMedia(token: string, igUserId: string, opts: { since: Date; max?: number }): Promise<meta.IgMediaItem[]>;
  mediaInsights(token: string, mediaId: string, productType?: string): Promise<meta.MediaMetrics>;
  accountDay(token: string, igUserId: string, since: Date, until: Date): Promise<meta.AccountDay>;
  followerDemographics(token: string, igUserId: string): Promise<Awaited<ReturnType<typeof meta.followerDemographics>>>;
};

export function insightsPort(cfg: meta.MetaConfig): InsightsPort {
  return {
    listMedia: (t, ig, o) => meta.listMedia(cfg, t, ig, o),
    mediaInsights: (t, id, p) => meta.mediaInsights(cfg, t, id, p),
    accountDay: (t, ig, s, u) => meta.accountDay(cfg, t, ig, s, u),
    followerDemographics: (t, ig) => meta.followerDemographics(cfg, t, ig),
  };
}

const DAY = 86_400_000;
/** Na primeira leitura, traz 90 dias de histórico; depois, só o último mês e pouco. */
const FIRST_SYNC_DAYS = 90;
const SYNC_DAYS = 35;
/** Leituras de métricas por conta em cada rodada (limite de chamadas da Meta e tempo da rotina). */
const MAX_READS = 40;

export type CollectResult = { accountId: string; ok: boolean; media: number; matched: number; read: number; error?: string };

const tokenProblem = (e: unknown) => e instanceof meta.MetaApiError && (e.status === 401 || e.code === 190);

export function publicError(e: unknown): string {
  if (tokenProblem(e)) return "O acesso da Meta a esta conta venceu ou foi retirado. Conecte a conta de novo pela Meta.";
  if (e instanceof meta.MetaApiError) return `A Meta recusou a leitura das métricas: ${e.message}`;
  return "Não foi possível ler as métricas agora. Tente de novo mais tarde.";
}

/** Lê mídias, métricas, totais do dia e público de uma conta ligada pela Meta. */
export async function collectAccount(db: Db, port: InsightsPort, tenantId: string, accountId: string, now = new Date()): Promise<CollectResult> {
  const { data: acc } = await db
    .from("ig_accounts")
    .select("id, ig_user_id, username, tenants(timezone)")
    .eq("tenant_id", tenantId)
    .eq("id", accountId)
    .maybeSingle();
  if (!acc) return { accountId, ok: false, media: 0, matched: 0, read: 0, error: "Conta não encontrada." };
  const tz = acc.tenants?.timezone ?? "America/Sao_Paulo";
  const done = async (error: string | null, r: Omit<CollectResult, "accountId" | "ok" | "error">) => {
    await db.from("ig_accounts").update({ insights_checked_at: now.toISOString(), insights_error: error }).eq("tenant_id", tenantId).eq("id", accountId);
    return { accountId, ok: !error, ...r, ...(error ? { error } : {}) };
  };
  if (acc.ig_user_id.startsWith("metricool:")) return done("Conecte a conta pela Meta para ler as métricas.", { media: 0, matched: 0, read: 0 });

  const { data: token } = await db.rpc("read_ig_token", { p_account: accountId });
  if (!token) return done("Conecte a conta pela Meta para ler as métricas.", { media: 0, matched: 0, read: 0 });

  let media = 0;
  let matched = 0;
  let read = 0;
  try {
    // 1. Mídias da conta
    const { count: known } = await db.from("ig_media").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("ig_account_id", accountId);
    const since = new Date(now.getTime() - (known ? SYNC_DAYS : FIRST_SYNC_DAYS) * DAY);
    const items = await port.listMedia(token, acc.ig_user_id, { since });
    media = items.length;
    if (items.length) {
      const { error } = await db.from("ig_media").upsert(
        items.map((m) => ({
          tenant_id: tenantId,
          ig_account_id: accountId,
          ig_media_id: m.id,
          media_type: m.media_type ?? null,
          media_product_type: m.media_product_type ?? null,
          caption: m.caption ?? null,
          permalink: m.permalink ?? null,
          posted_at: new Date(m.timestamp).toISOString(),
        })),
        { onConflict: "ig_account_id,ig_media_id" },
      );
      if (error) throw new Error(`ig_media: ${error.message}`);
    }

    // 2. Liga os posts do app às mídias (os da Meta já têm o id; os do Metricool casam por legenda e horário)
    matched = await linkPosts(db, tenantId, accountId, now);

    // 3. Métricas de cada mídia, das mais atrasadas primeiro
    const { data: rows } = await db
      .from("ig_media")
      .select("id, ig_media_id, post_id, media_product_type, posted_at, insights_at")
      .eq("tenant_id", tenantId)
      .eq("ig_account_id", accountId)
      .order("insights_at", { ascending: true, nullsFirst: true })
      .limit(500);
    const due = (rows ?? []).filter((r) => needsRefresh(new Date(r.posted_at), r.insights_at ? new Date(r.insights_at) : null, now)).slice(0, MAX_READS);
    for (const r of due) {
      try {
        const m = await port.mediaInsights(token, r.ig_media_id, r.media_product_type ?? undefined);
        const values = {
          views: m.views ?? null,
          reach: m.reach ?? null,
          likes: m.likes ?? null,
          comments: m.comments ?? null,
          saved: m.saved ?? null,
          shares: m.shares ?? null,
          total_interactions: m.total_interactions ?? null,
          profile_visits: m.profile_visits ?? null,
          follows: m.follows ?? null,
        };
        await db.from("ig_media").update({ ...values, insights_at: now.toISOString(), insights_error: null }).eq("tenant_id", tenantId).eq("id", r.id);
        read++;
        // Foto do post do app (1h, 24h, 72h, 7d, 28d): a primeira leitura depois de cada marco
        const snap = r.post_id ? snapshotFor(new Date(r.posted_at), now) : null;
        if (r.post_id && snap) {
          await db
            .from("media_insights")
            .upsert({ tenant_id: tenantId, post_id: r.post_id, snapshot: snap, collected_at: now.toISOString(), ...values, raw: m }, { onConflict: "post_id,snapshot", ignoreDuplicates: true });
        }
      } catch (e) {
        if (tokenProblem(e) || (e instanceof meta.MetaApiError && e.transient)) throw e;
        // Mídia sem métricas (apagada, anúncio, tipo sem suporte): marca e segue
        await db
          .from("ig_media")
          .update({ insights_at: now.toISOString(), insights_error: e instanceof Error ? e.message.slice(0, 300) : "erro" })
          .eq("tenant_id", tenantId)
          .eq("id", r.id);
      }
    }

    // 4. Totais de ontem da conta (1× por dia)
    const today = utcToZoned(now, tz).date;
    const yesterday = utcToZoned(new Date(zonedToUtc(today, "12:00", tz).getTime() - DAY), tz).date;
    const { data: hasDay } = await db.from("account_insights_daily").select("day").eq("tenant_id", tenantId).eq("ig_account_id", accountId).eq("day", yesterday).maybeSingle();
    if (!hasDay) {
      const d = await port.accountDay(token, acc.ig_user_id, zonedToUtc(yesterday, "00:00", tz), zonedToUtc(today, "00:00", tz));
      await db.from("account_insights_daily").upsert(
        {
          tenant_id: tenantId,
          ig_account_id: accountId,
          day: yesterday,
          views: d.views ?? null,
          reach: d.reach ?? null,
          profile_views: d.profile_views ?? null,
          follower_count: d.follower_count ?? null,
          raw: d,
        },
        { onConflict: "ig_account_id,day" },
      );
    }

    // 5. Público (1× por semana)
    const { data: lastAud } = await db
      .from("audience_snapshots")
      .select("collected_at")
      .eq("tenant_id", tenantId)
      .eq("ig_account_id", accountId)
      .order("collected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lastAud || now.getTime() - new Date(lastAud.collected_at).getTime() > 7 * DAY) {
      const aud = await port.followerDemographics(token, acc.ig_user_id);
      if (aud) await db.from("audience_snapshots").insert({ tenant_id: tenantId, ig_account_id: accountId, collected_at: now.toISOString(), ...aud });
    }

    return done(null, { media, matched, read });
  } catch (e) {
    if (!(e instanceof meta.MetaApiError)) console.error("collect-insights", acc.username, e instanceof Error ? e.message : e);
    return done(publicError(e), { media, matched, read });
  }
}

/** Liga posts publicados às mídias do Instagram. Devolve quantos posts do Metricool foram casados. */
async function linkPosts(db: Db, tenantId: string, accountId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 40 * DAY).toISOString();
  const [{ data: posts }, { data: media }] = await Promise.all([
    db
      .from("posts")
      .select("id, format, caption, ig_media_id, permalink, published_at, scheduled_at")
      .eq("tenant_id", tenantId)
      .eq("ig_account_id", accountId)
      .eq("status", "published")
      .gte("scheduled_at", since),
    db.from("ig_media").select("id, ig_media_id, post_id, media_type, media_product_type, caption, permalink, posted_at").eq("tenant_id", tenantId).eq("ig_account_id", accountId).gte("posted_at", since),
  ]);
  if (!posts?.length || !media?.length) return 0;
  const byIgId = new Map(media.map((m) => [m.ig_media_id, m]));
  const linked = new Set(media.filter((m) => m.post_id).map((m) => m.post_id));

  // Posts que já sabem o id da mídia (publicados pela Meta)
  for (const p of posts) {
    const m = p.ig_media_id ? byIgId.get(p.ig_media_id) : undefined;
    if (m && m.post_id !== p.id) {
      await db.from("ig_media").update({ post_id: p.id }).eq("tenant_id", tenantId).eq("id", m.id);
      linked.add(p.id);
    }
  }

  // Posts do Metricool: sem id do Instagram
  const pending = posts.filter((p) => !p.ig_media_id && !linked.has(p.id));
  const free = media.filter((m) => !m.post_id && !posts.some((p) => p.ig_media_id === m.ig_media_id));
  const pairs = matchPosts(
    pending.map((p) => ({ id: p.id, format: p.format as Format, caption: p.caption, at: new Date(p.published_at ?? p.scheduled_at) })),
    free.map((m) => ({ igMediaId: m.ig_media_id, mediaType: m.media_type, productType: m.media_product_type, caption: m.caption, at: new Date(m.posted_at) })),
  );
  let n = 0;
  for (const [postId, igMediaId] of pairs) {
    const m = byIgId.get(igMediaId)!;
    const p = pending.find((x) => x.id === postId)!;
    const { error } = await db.from("ig_media").update({ post_id: postId }).eq("tenant_id", tenantId).eq("id", m.id);
    if (error) continue;
    await db
      .from("posts")
      .update({ ig_media_id: igMediaId, permalink: p.permalink ?? m.permalink })
      .eq("tenant_id", tenantId)
      .eq("id", postId);
    n++;
  }
  return n;
}

/** Rotina `collect-insights`: todas as contas ligadas pela Meta, no máximo 1× por hora cada. */
export async function collectInsights(db: Db, port: InsightsPort, now = new Date()): Promise<CollectResult[]> {
  const stale = new Date(now.getTime() - 55 * 60_000).toISOString();
  const { data: accounts, error } = await db
    .from("ig_accounts")
    .select("id, tenant_id, tenants!inner(status)")
    .eq("status", "connected")
    .eq("tenants.status", "active")
    .not("token_secret_id", "is", null)
    .not("ig_user_id", "like", "metricool:%")
    .or(`insights_checked_at.is.null,insights_checked_at.lt.${stale}`)
    .limit(50);
  if (error) throw new Error(error.message);
  const out: CollectResult[] = [];
  for (const a of accounts ?? []) out.push(await collectAccount(db, port, a.tenant_id, a.id, now));
  return out;
}
