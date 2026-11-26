import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { AiProviderError } from "./providers/types";

type Db = SupabaseClient<Database>;
type Task = Database["public"]["Enums"]["ai_task"];

export const NO_CREDITS =
  "Os créditos de IA deste cliente acabaram. Peça mais créditos à equipe da Visus ou cadastre a chave própria em Integrações de IA.";

/** Sem saldo: a mensagem chega a quem pediu a geração. */
export class CreditError extends AiProviderError {
  constructor() {
    super(NO_CREDITS, 402);
  }
}

export const TASK_LABELS: Record<Task, string> = { caption: "Texto", image: "Arte", video: "Vídeo", analysis: "Análise", transcription: "Áudio do vídeo" };

/** Custo de uma unidade da tarefa no provedor, pela tabela ai_models (editável pelo admin). */
export async function unitCost(db: Db, provider: string, task: Task): Promise<number> {
  const { data } = await db.from("ai_models").select("unit_cost_credits").eq("provider", provider).eq("task", task).eq("active", true).limit(1).maybeSingle();
  return Number(data?.unit_cost_credits ?? 0);
}

export type Charge = { amount: number; refund: (why?: string) => Promise<void> };

/**
 * Debita os créditos antes de chamar a IA (só no modo 'platform'; no modo chave própria é 0).
 * Sem saldo, lança CreditError e nada é chamado. Se a geração falhar, `refund` devolve o valor.
 * `db` é service_role; a função do banco trava o saldo do cliente.
 */
export async function charge(db: Db, tenantId: string, item: { provider: string; task: Task; model: string; units?: number }): Promise<Charge> {
  const units = item.units ?? 1;
  const amount = (await unitCost(db, item.provider, item.task)) * units;
  const reason = `${TASK_LABELS[item.task]} · ${item.model}${units > 1 ? ` × ${units}` : ""}`;
  const { data, error } = await db.rpc("charge_credits", { p_tenant: tenantId, p_amount: amount, p_reason: reason });
  if (error) {
    if (error.code === "VP402") throw new CreditError();
    throw new Error(`charge_credits: ${error.message}`);
  }
  const charged = Number(data ?? 0);
  let refunded = false;
  return {
    amount: charged,
    async refund(why = "falha na geração") {
      if (refunded || charged <= 0) return;
      refunded = true;
      const { error: e } = await db.rpc("grant_credits", { p_tenant: tenantId, p_amount: charged, p_reason: `Estorno (${why}): ${reason}` });
      if (e) console.error("estorno de créditos", e.message);
    },
  };
}

/** Debita, roda a geração e estorna se ela falhar. */
export async function withCredits<T>(db: Db, tenantId: string, item: Parameters<typeof charge>[2], run: (c: Charge) => Promise<T>): Promise<T> {
  const c = await charge(db, tenantId, item);
  try {
    return await run(c);
  } catch (e) {
    await c.refund();
    throw e;
  }
}
