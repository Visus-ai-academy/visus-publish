import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { z } from "zod";

export const POST_STATUSES = [
  "planned",
  "generating",
  "generation_failed",
  "pending_approval",
  "rejected",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "paused",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * Máquina de estados da SPEC §6. `user` = transição feita por uma pessoa
 * (função SQL transition_post/review_post); `system` = jobs com service_role.
 */
export const TRANSITIONS: Record<PostStatus, Partial<Record<PostStatus, "user" | "system">>> = {
  planned: { generating: "system", pending_approval: "user", scheduled: "user" },
  generating: { pending_approval: "system", scheduled: "system", generation_failed: "system" },
  generation_failed: { generating: "system" },
  pending_approval: { scheduled: "user", rejected: "user", generating: "user" },
  rejected: { generating: "system" },
  scheduled: { planned: "user", publishing: "system", pending_approval: "system", paused: "system", generating: "user" },
  publishing: { published: "system", failed: "system", scheduled: "system" },
  published: {},
  failed: { scheduled: "user" },
  paused: { scheduled: "system" },
};

/**
 * Pode excluir enquanto nada saiu para o Instagram: o envio ao Metricool ou à Meta só
 * acontece quando a rotina pega o post (status "publishing"), então um post "scheduled"
 * ainda não existe fora do app. O delete filtra por estes status, o que evita a corrida com a rotina.
 */
export const DELETABLE_STATUSES = ["planned", "rejected", "generation_failed", "pending_approval", "scheduled", "paused"] as const satisfies readonly PostStatus[];

export function canTransition(from: PostStatus, to: PostStatus, by: "user" | "system"): boolean {
  const who = TRANSITIONS[from][to];
  return who === by || (by === "system" && who === "user");
}

export const STATUS_LABELS: Record<PostStatus, string> = {
  planned: "Planejado",
  generating: "Gerando",
  generation_failed: "Falha na geração",
  pending_approval: "Aguardando aprovação",
  rejected: "Reprovado",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falha ao publicar",
  paused: "Pausado",
};

const statusSchema = z.enum(POST_STATUSES);

/** Transição feita por pessoa. O banco valida papel e regra de novo. */
export async function transitionPost(supabase: SupabaseClient<Database>, postId: string, to: PostStatus, note?: string) {
  const parsed = z.object({ postId: z.string().uuid(), to: statusSchema }).parse({ postId, to });
  const { data, error } = await supabase.rpc("transition_post", { p_post: parsed.postId, p_to: parsed.to, p_note: note });
  if (error) throw new Error(error.message);
  return statusSchema.parse(data);
}

export async function reviewPost(supabase: SupabaseClient<Database>, postId: string, approve: boolean, note?: string) {
  const id = z.string().uuid().parse(postId);
  const { data, error } = await supabase.rpc("review_post", { p_post: id, p_approve: approve, p_note: note });
  if (error) throw new Error(error.message);
  return statusSchema.parse(data);
}
