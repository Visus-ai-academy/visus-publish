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
