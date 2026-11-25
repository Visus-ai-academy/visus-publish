"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { linkMetricoolAccount } from "@/lib/meta/accounts";
import { listBrands } from "@/lib/metricool/client";
import { metricoolConfigFromEnv } from "@/lib/metricool/port";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin, resolveTenant } from "@/lib/tenant";

export type McState = { error?: string; ok?: string } | undefined;

const credsSchema = z.object({
  userId: z.string().trim().regex(/^\d+$/, "O userId do Metricool tem só números."),
  token: z.string().trim().min(10, "Cole o token da API do Metricool."),
});

/** Só a equipe da Visus conecta o Metricool: o mesmo token pode enxergar marcas de vários clientes. */
async function guard(slug: string) {
  const ctx = await resolveTenant(slug);
  if (!(await isPlatformAdmin())) throw new Error("forbidden");
  return ctx;
}

export async function saveMetricool(slug: string, _: McState, formData: FormData): Promise<McState> {
  let ctx;
  try {
    ctx = await guard(slug);
  } catch {
    return { error: "Só a equipe da Visus conecta o Metricool." };
  }
  const parsed = credsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await listBrands(metricoolConfigFromEnv(), parsed.data); // confere o token antes de guardar
  } catch (e) {
    return { error: (e as Error).message || "O Metricool recusou o token." };
  }
  const db = createAdminClient();
  const { error } = await db.rpc("store_metricool_token", {
    p_tenant: ctx.tenant.id,
    p_user_id: parsed.data.userId,
    p_token: parsed.data.token,
    p_actor: ctx.user.id,
  });
  if (error) return { error: "Não foi possível guardar o token." };
  await db.from("audit_log").insert({ tenant_id: ctx.tenant.id, actor: ctx.user.id, action: "metricool.connected" });
  revalidatePath(`/${slug}/contas`);
  return { ok: "Metricool conectado." };
}

export async function removeMetricool(slug: string) {
  const ctx = await guard(slug);
  const db = createAdminClient();
  await db.rpc("delete_metricool_connection", { p_tenant: ctx.tenant.id });
  await db.from("audit_log").insert({ tenant_id: ctx.tenant.id, actor: ctx.user.id, action: "metricool.disconnected" });
  revalidatePath(`/${slug}/contas`);
}

const linkSchema = z.object({
  blogId: z.string().regex(/^\d+$/, "Escolha a marca."),
  username: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, ""))
    .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, "Informe o @ do Instagram desta marca.")),
  requireApproval: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export async function linkBrand(slug: string, _: McState, formData: FormData): Promise<McState> {
  let ctx;
  try {
    ctx = await guard(slug);
  } catch {
    return { error: "Só a equipe da Visus vincula marcas do Metricool." };
  }
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = createAdminClient();
  const { data: creds } = await db.rpc("read_metricool_credentials", { p_tenant: ctx.tenant.id });
  const c = creds?.[0];
  if (!c) return { error: "Conecte o Metricool primeiro." };

  // Só marcas que este token enxerga
  try {
    const brands = await listBrands(metricoolConfigFromEnv(), { userId: c.user_id, token: c.token });
    if (!brands.some((b) => b.blogId === parsed.data.blogId)) return { error: "Esta marca não aparece no Metricool conectado." };
  } catch (e) {
    return { error: (e as Error).message };
  }

  const r = await linkMetricoolAccount(db, {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    blogId: parsed.data.blogId,
    username: parsed.data.username,
    requireApproval: parsed.data.requireApproval,
  });
  if (!r.ok) return { error: r.reason === "other_tenant" ? "Esta marca já está vinculada a outro cliente." : "Não foi possível vincular a marca." };
  revalidatePath(`/${slug}/contas`);
  return { ok: `@${parsed.data.username} vai publicar pelo Metricool.` };
}
