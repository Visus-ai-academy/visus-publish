"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { complianceFor } from "@/lib/ai/caption";
import { generatePost, PlanError, suggestCadence, suggestThemes } from "@/lib/ai/plan";
import { cadenceSchema, monthSlots, sortSlots, takenKeys, type Slot } from "@/lib/plan/cadence";
import { loadCadence } from "@/lib/plan/load";
import { providersFromEnv } from "@/lib/ai/providers";
import { can } from "@/lib/auth/permissions";
import { FORMATS, storagePath, validateFiles } from "@/lib/posts/upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenant } from "@/lib/tenant";
import { monthRange, utcToZoned, zonedToUtc } from "@/lib/time";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const EDITABLE = ["planned", "rejected", "generation_failed"] as const;

function refresh(slug: string) {
  for (const p of ["planejamento", "calendario", "aprovacoes"]) revalidatePath(`/${slug}/${p}`);
}

async function editor(slug: string) {
  const ctx = await resolveTenant(slug);
  if (!can(ctx.role, "edit_content")) throw new PlanError("Seu papel não permite editar o planejamento.");
  return ctx;
}

const itemSchema = z.object({
  accountId: z.string().uuid("Escolha a conta."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha a data."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Escolha o horário."),
  format: z.enum(FORMATS),
  theme: z.string().trim().min(3, "Escreva o tema.").max(120),
});

export async function addPlanItem(slug: string, raw: unknown): Promise<Result> {
  try {
    const { tenant, supabase } = await editor(slug);
    const parsed = itemSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const i = parsed.data;
    const at = zonedToUtc(i.date, i.time, tenant.timezone);
    if (at.getTime() < Date.now() + 5 * 60_000) return { ok: false, error: "Escolha um dia e horário no futuro." };
    const { error } = await supabase
      .from("posts")
      .insert({ tenant_id: tenant.id, ig_account_id: i.accountId, scheduled_at: at.toISOString(), theme: i.theme, format: i.format, origin: "ai" });
    if (error) return { ok: false, error: "Não foi possível adicionar o tema." };
    refresh(slug);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof PlanError ? e.message : "Não foi possível adicionar o tema." };
  }
}

const suggestSchema = z.object({
  accountId: z.string().uuid("Escolha a conta."),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  hint: z.string().trim().max(300).optional(),
});

/** Preenche com temas da IA as vagas livres da cadência da conta no mês. */
export async function suggestPlan(slug: string, raw: unknown): Promise<Result<{ added: number }>> {
  try {
    const { tenant, supabase } = await editor(slug);
    const parsed = suggestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const s = parsed.data;
    const [y, m] = s.month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const today = utcToZoned(new Date(), tenant.timezone).date;
    if (`${s.month}-${String(daysInMonth).padStart(2, "0")}` <= today) return { ok: false, error: "Escolha um mês que ainda não terminou." };
    const firstDay = today.startsWith(s.month) ? Number(today.slice(8)) + 1 : 1;

    const cadence = await loadCadence(supabase, tenant.id, s.accountId);
    if (!cadence.slots.length) return { ok: false, error: "Defina a cadência da conta antes de sugerir temas." };
    const { start, end } = monthRange(s.month, tenant.timezone);
    const { data: inMonth } = await supabase
      .from("posts")
      .select("scheduled_at, format")
      .eq("tenant_id", tenant.id)
      .eq("ig_account_id", s.accountId)
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString());
    const taken = takenKeys(inMonth ?? [], tenant.timezone);
    const slots = monthSlots(s.month, cadence.slots, firstDay, taken).filter((x) => zonedToUtc(x.date, x.time, tenant.timezone).getTime() > Date.now() + 60 * 60_000);
    if (!slots.length) return { ok: false, error: "Todas as vagas da cadência deste mês já têm tema." };

    const { data: existing } = await supabase
      .from("posts")
      .select("theme")
      .eq("tenant_id", tenant.id)
      .eq("ig_account_id", s.accountId)
      .gte("scheduled_at", new Date(Date.UTC(y, m - 2, 1)).toISOString())
      .limit(80);

    const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
    const items = await suggestThemes(
      createAdminClient(),
      tenant.id,
      { accountId: s.accountId, monthLabel, slots, existing: (existing ?? []).map((p) => p.theme), hint: s.hint, niche: cadence.niche },
      { providers: providersFromEnv() },
    );
    const rows = items.map((i) => ({
      tenant_id: tenant.id,
      ig_account_id: s.accountId,
      scheduled_at: zonedToUtc(i.date, i.time, tenant.timezone).toISOString(),
      theme: i.theme,
      format: i.format,
      origin: "ai" as const,
    }));
    const { error } = await supabase.from("posts").insert(rows);
    if (error) return { ok: false, error: "Não foi possível salvar os temas." };
    refresh(slug);
    return { ok: true, added: rows.length };
  } catch (e) {
    if (!(e instanceof PlanError)) console.error("suggestPlan", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof PlanError ? e.message : "Não foi possível sugerir temas agora." };
  }
}

const cadenceInput = z.object({
  accountId: z.string().uuid("Escolha a conta."),
  niche: z.string().trim().max(200, "O nicho passa de 200 caracteres.").optional().default(""),
  slots: cadenceSchema,
});

export async function saveCadence(slug: string, raw: unknown): Promise<Result> {
  try {
    const { tenant, supabase, user } = await editor(slug);
    const parsed = cadenceInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const c = parsed.data;
    const { error } = await supabase.from("posting_cadences").upsert({
      tenant_id: tenant.id,
      ig_account_id: c.accountId,
      niche: c.niche || null,
      slots: sortSlots(c.slots),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: "Não foi possível salvar a cadência." };
    revalidatePath(`/${slug}/planejamento`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof PlanError ? e.message : "Não foi possível salvar a cadência." };
  }
}

const proposeInput = z.object({
  accountId: z.string().uuid("Escolha a conta."),
  niche: z.string().trim().min(3, "Descreva o nicho do cliente.").max(200, "O nicho passa de 200 caracteres."),
  hint: z.string().trim().max(300).optional(),
});

/** Pede à IA uma cadência pelo nicho. Não salva: volta para a tela revisar. */
export async function proposeCadence(slug: string, raw: unknown): Promise<Result<{ slots: Slot[]; reason: string }>> {
  try {
    const { tenant } = await editor(slug);
    const parsed = proposeInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const r = await suggestCadence(createAdminClient(), tenant.id, parsed.data, { providers: providersFromEnv() });
    return { ok: true, ...r };
  } catch (e) {
    if (!(e instanceof PlanError)) console.error("proposeCadence", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof PlanError ? e.message : "Não foi possível sugerir a cadência agora." };
  }
}

/** Gera legenda e arte de um item do plano (uma chamada por post, para caber no tempo da função). */
export async function generateItem(slug: string, postId: string): Promise<Result<{ status: string }>> {
  try {
    const { tenant, supabase } = await editor(slug);
    const id = uuid.parse(postId);
    const { error } = await supabase.rpc("begin_generation", { p_post: id });
    if (error) return { ok: false, error: error.code === "55P03" ? "Este post já está sendo gerado." : "Este post não pode ser gerado agora." };
    const r = await generatePost(createAdminClient(), tenant.id, id, { providers: providersFromEnv() });
    refresh(slug);
    revalidatePath(`/${slug}/planejamento/${id}`);
    return r.error ? { ok: false, error: r.error } : { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof PlanError ? e.message : "Não foi possível gerar agora." };
  }
}

export async function saveCaption(slug: string, postId: string, caption: string): Promise<Result> {
  try {
    const { tenant, supabase } = await editor(slug);
    const text = z.string().max(2200, "A legenda passa de 2.200 caracteres.").parse(caption);
    const { data, error } = await supabase
      .from("posts")
      .update({ caption: text || null })
      .eq("tenant_id", tenant.id)
      .eq("id", uuid.parse(postId))
      .in("status", [...EDITABLE, "pending_approval", "scheduled"])
      .select("id, status, theme, ig_account_id");
    if (error || !data?.length) return { ok: false, error: "Não foi possível salvar a legenda." };
    const saved = data[0];
    if (saved.status === "planned" || saved.status === "rejected") {
      const { flags } = await complianceFor(supabase, tenant.id, saved.ig_account_id, `${saved.theme}\n${text}`);
      if (flags.length) await supabase.rpc("add_post_flags", { p_post: saved.id, p_flags: flags });
    }
    refresh(slug);
    revalidatePath(`/${slug}/planejamento/${postId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof z.ZodError ? e.issues[0].message : e instanceof PlanError ? e.message : "Não foi possível salvar a legenda." };
  }
}

/** Caminhos no Storage para anexar a mídia enviada pela equipe (ex.: vídeo do Reels). */
export async function attachPaths(slug: string, postId: string, files: { name: string; type: string; size: number }[]): Promise<Result<{ paths: string[] }>> {
  try {
    const { tenant, supabase } = await editor(slug);
    const id = uuid.parse(postId);
    const { data: post } = await supabase.from("posts").select("format, status").eq("tenant_id", tenant.id).eq("id", id).maybeSingle();
    if (!post || !EDITABLE.includes(post.status as (typeof EDITABLE)[number])) return { ok: false, error: "Este post não aceita arquivos agora." };
    const problem = validateFiles(post.format, files);
    if (problem) return { ok: false, error: problem };
    const { count } = await supabase.from("post_media").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("post_id", id);
    if (count) return { ok: false, error: "Este post já tem mídia. Gere de novo ou remova o item." };
    return { ok: true, paths: files.map((f, i) => storagePath(tenant.id, id, i, f.name)) };
  } catch (e) {
    return { ok: false, error: e instanceof PlanError ? e.message : "Não foi possível preparar o envio." };
  }
}

/** Post reprovado com mídia volta para aprovação (ou agendado, conforme a conta) depois de ajustado. */
export async function resubmit(slug: string, postId: string): Promise<Result<{ status: string }>> {
  try {
    const { supabase } = await editor(slug);
    const { data, error } = await supabase.rpc("transition_post", { p_post: uuid.parse(postId), p_to: "scheduled", p_note: "reenviado depois de ajuste" });
    if (error || !data) return { ok: false, error: "Não foi possível reenviar." };
    refresh(slug);
    revalidatePath(`/${slug}/planejamento/${postId}`);
    return { ok: true, status: data };
  } catch (e) {
    return { ok: false, error: e instanceof PlanError ? e.message : "Não foi possível reenviar." };
  }
}
