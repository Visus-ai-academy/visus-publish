"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { providersFromEnv } from "@/lib/ai/providers";
import { can } from "@/lib/auth/permissions";
import { AnalysisError, runAnalysis } from "@/lib/insights/analysis";
import { applyFinding as applyFindingRpc } from "@/lib/insights/apply";
import { collectAccount, insightsPort } from "@/lib/insights/collect";
import { getMetaConfig } from "@/lib/meta/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenant } from "@/lib/tenant";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };
const uuid = z.string().uuid();

function refresh(slug: string) {
  for (const p of ["insights", "planejamento", "calendario"]) revalidatePath(`/${slug}/${p}`);
}

/** Lê as métricas da conta agora (admin e editor), sem esperar a rotina de hora em hora. */
export async function refreshInsights(slug: string, accountId: string): Promise<ActionResult> {
  const { tenant, role, supabase } = await resolveTenant(slug);
  if (!can(role, "edit_content")) return { ok: false, error: "Seu papel não permite atualizar as métricas." };
  const id = uuid.safeParse(accountId);
  if (!id.success) return { ok: false, error: "Conta inválida." };
  // Confere pelo RLS que a conta é deste cliente antes de usar o service_role
  const { data: acc } = await supabase.from("ig_accounts").select("id").eq("tenant_id", tenant.id).eq("id", id.data).maybeSingle();
  if (!acc) return { ok: false, error: "Conta não encontrada." };
  const cfg = getMetaConfig();
  if (!cfg) return { ok: false, error: "O app da Meta ainda não está configurado no servidor." };
  const r = await collectAccount(createAdminClient(), insightsPort(cfg), tenant.id, acc.id);
  refresh(slug);
  if (!r.ok) return { ok: false, error: r.error ?? "Não foi possível ler as métricas." };
  return { ok: true, message: r.read ? `Métricas de ${r.read} publicação(ões) atualizadas.` : "As métricas já estavam em dia." };
}

/** Pede à IA os achados da conta (admin e editor; debita créditos). */
export async function analyzeNow(slug: string, accountId: string): Promise<ActionResult> {
  const { tenant, role, supabase } = await resolveTenant(slug);
  if (!can(role, "edit_content")) return { ok: false, error: "Seu papel não permite pedir a análise." };
  const id = uuid.safeParse(accountId);
  if (!id.success) return { ok: false, error: "Conta inválida." };
  const { data: acc } = await supabase.from("ig_accounts").select("id").eq("tenant_id", tenant.id).eq("id", id.data).maybeSingle();
  if (!acc) return { ok: false, error: "Conta não encontrada." };
  try {
    const findings = await runAnalysis(createAdminClient(), tenant.id, acc.id, { providers: providersFromEnv() });
    refresh(slug);
    return { ok: true, message: `${findings.length} achado(s) novo(s).` };
  } catch (e) {
    return { ok: false, error: e instanceof AnalysisError ? e.message : "Não foi possível analisar agora. Tente de novo." };
  }
}

/** Aplica a ação de um achado no plano. O banco confere papel e cliente. */
export async function applyFinding(slug: string, findingId: string): Promise<ActionResult> {
  const { role, supabase } = await resolveTenant(slug);
  if (!can(role, "edit_content")) return { ok: false, error: "Seu papel não permite mudar o plano." };
  const id = uuid.safeParse(findingId);
  if (!id.success) return { ok: false, error: "Achado inválido." };
  const r = await applyFindingRpc(supabase, id.data);
  if (r.ok) refresh(slug);
  return r.ok ? { ok: true, message: r.count ? `${r.count} post(s) atualizado(s) no plano.` : "Nenhum post futuro precisava mudar." } : r;
}
