"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createInvitation } from "@/lib/invitations/create";
import { isPlatformAdmin, requireUser } from "@/lib/tenant";
import { slugify, tenantSlugSchema } from "@/lib/tenant-core";

export type CreateTenantState = { error?: string; link?: string; email?: string; name?: string } | undefined;

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cliente.").max(80),
  plan: z.enum(["Essencial", "Profissional", "Agência"]),
  adminEmail: z.string().trim().toLowerCase().email("Informe o e-mail do administrador do cliente."),
});

export async function createTenant(_: CreateTenantState, formData: FormData): Promise<CreateTenantState> {
  if (!(await isPlatformAdmin())) return { error: "Só a equipe da Visus cria clientes." };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const slug = slugify(parsed.data.name);
  if (!tenantSlugSchema.safeParse(slug).success) return { error: "Use um nome com letras ou números." };

  const { supabase } = await requireUser();
  const { data: tenant, error } = await supabase
    .from("tenants")
    .insert({ name: parsed.data.name, plan: parsed.data.plan, slug })
    .select("id")
    .single();
  if (error) {
    return { error: error.code === "23505" ? "Já existe um cliente com esse nome." : "Não foi possível criar o cliente." };
  }

  try {
    const link = await createInvitation(supabase, tenant.id, { email: parsed.data.adminEmail, role: "admin" });
    revalidatePath("/admin/clientes");
    return { link, email: parsed.data.adminEmail, name: parsed.data.name };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setTenantStatus(tenantId: string, status: "active" | "suspended") {
  if (!(await isPlatformAdmin())) return;
  const id = z.string().uuid().parse(tenantId);
  const { supabase } = await requireUser();
  await supabase.from("tenants").update({ status }).eq("id", id);
  revalidatePath("/admin/clientes");
}

export type CreditsState = { error?: string; ok?: string } | undefined;

const creditsSchema = z.object({
  tenantId: z.string().uuid("Escolha o cliente."),
  amount: z.coerce
    .number({ message: "Informe quantos créditos." })
    .refine((n) => n !== 0, "Informe quantos créditos.")
    .refine((n) => Math.abs(n) <= 1_000_000, "Valor alto demais."),
  reason: z.string().trim().max(120).optional(),
});

/** Adiciona (ou retira, com número negativo) créditos de IA de um cliente. Fica no extrato e no audit_log. */
export async function grantCredits(_: CreditsState, formData: FormData): Promise<CreditsState> {
  if (!(await isPlatformAdmin())) return { error: "Só a equipe da Visus adiciona créditos." };
  const parsed = creditsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { supabase } = await requireUser();
  const { tenantId, amount, reason } = parsed.data;
  const { data, error } = await supabase.rpc("grant_credits", { p_tenant: tenantId, p_amount: amount, p_reason: reason || (amount > 0 ? "Créditos adicionados pela Visus" : "Ajuste da Visus") });
  if (error) return { error: "Não foi possível lançar os créditos." };
  revalidatePath("/admin/clientes");
  const fmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  return { ok: `${amount > 0 ? "Créditos adicionados" : "Créditos retirados"}. Novo saldo: ${fmt.format(Number(data))}.` };
}
