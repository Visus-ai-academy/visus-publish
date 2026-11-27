import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Aplica a ação de um achado ("mover horário", "trocar formato") nos posts futuros ainda não
 * publicados. Roda com o cliente do usuário: a função apply_finding confere papel e cliente,
 * muda só posts planned/scheduled e grava cada mudança em post_events.
 */
export async function applyFinding(supabase: SupabaseClient<Database>, findingId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("apply_finding", { p_finding: findingId });
  if (!error) return { ok: true, count: data ?? 0 };
  if (error.code === "42501") return { ok: false, error: "Seu papel não permite mudar o plano." };
  if (error.code === "VP409") return { ok: false, error: error.message.replace(/^./, (c) => c.toUpperCase()) + "." };
  return { ok: false, error: "Não foi possível aplicar agora. Tente de novo." };
}
