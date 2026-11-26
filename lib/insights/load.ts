import type { SupabaseClient } from "@supabase/supabase-js";
import type { Format } from "@/lib/posts/upload";
import type { Database } from "@/lib/supabase/database.types";
import type { MediaRow } from "./aggregate";
import { formatOf } from "./match";

type Db = SupabaseClient<Database>;

/** Título para a tabela: tema do post do app, ou a primeira linha da legenda. */
export function titleOf(theme: string | null | undefined, caption: string | null | undefined, postedAt: Date): string {
  if (theme) return theme;
  const first = (caption ?? "").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
  if (first) return first.length > 80 ? `${first.slice(0, 77)}…` : first;
  return `Publicação de ${postedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

/**
 * Publicações da conta no período, com as métricas mais recentes. Serve à tela (cliente do
 * usuário, com RLS) e à análise (service_role): as duas filtram tenant_id.
 */
export async function loadMediaRows(db: Db, tenantId: string, accountId: string, from: Date, to: Date): Promise<MediaRow[]> {
  const { data, error } = await db
    .from("ig_media")
    .select("id, post_id, caption, permalink, media_type, media_product_type, posted_at, views, reach, likes, comments, saved, shares, profile_visits, follows, insights_at, posts(theme, format)")
    .eq("tenant_id", tenantId)
    .eq("ig_account_id", accountId)
    .gte("posted_at", from.toISOString())
    .lt("posted_at", to.toISOString())
    .not("insights_at", "is", null)
    .order("posted_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => {
    const postedAt = new Date(m.posted_at);
    return {
      id: m.id,
      postId: m.post_id,
      title: titleOf(m.posts?.theme, m.caption, postedAt),
      format: (m.posts?.format as Format | undefined) ?? formatOf(m.media_type, m.media_product_type),
      postedAt,
      permalink: m.permalink,
      views: m.views,
      reach: m.reach,
      likes: m.likes,
      comments: m.comments,
      saved: m.saved,
      shares: m.shares,
      profileVisits: m.profile_visits,
      follows: m.follows,
    };
  });
}

export type Upcoming = { id: string; status: string; format: Format; scheduledAt: Date; hasMedia: boolean };

/** Posts futuros que uma ação ainda pode mudar (planejados ou agendados). */
export async function loadUpcoming(db: Db, tenantId: string, accountId: string, now = new Date()): Promise<Upcoming[]> {
  const { data, error } = await db
    .from("posts")
    .select("id, status, format, scheduled_at, post_media(id)")
    .eq("tenant_id", tenantId)
    .eq("ig_account_id", accountId)
    .in("status", ["planned", "scheduled"])
    .gt("scheduled_at", now.toISOString())
    .order("scheduled_at")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ id: p.id, status: p.status, format: p.format as Format, scheduledAt: new Date(p.scheduled_at), hasMedia: p.post_media.length > 0 }));
}
