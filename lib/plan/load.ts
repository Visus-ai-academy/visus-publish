import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { DEFAULT_CADENCE, readCadence, type Slot } from "./cadence";

/** Cadência salva da conta; sem registro, devolve o padrão (marcado como não salvo). */
export async function loadCadence(db: SupabaseClient<Database>, tenantId: string, accountId: string): Promise<{ slots: Slot[]; niche: string; saved: boolean }> {
  const { data } = await db.from("posting_cadences").select("slots, niche").eq("tenant_id", tenantId).eq("ig_account_id", accountId).maybeSingle();
  if (!data) return { slots: DEFAULT_CADENCE, niche: "", saved: false };
  return { slots: readCadence(data.slots), niche: data.niche ?? "", saved: true };
}
