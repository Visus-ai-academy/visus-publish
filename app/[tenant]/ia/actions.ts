"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { checkKey } from "@/lib/ai/keys";
import { KEY_PROVIDERS, providersFromEnv } from "@/lib/ai/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenant } from "@/lib/tenant";

export type FormState = { error?: string; ok?: string } | undefined;

async function admin(slug: string) {
  const ctx = await resolveTenant(z.string().parse(slug));
  if (!can(ctx.role, "manage_tenant")) throw new Error("Só o administrador do cliente muda as integrações de IA.");
  return ctx;
}

const settingsSchema = z.object({
  caption: z.enum(["openai", "gemini"]),
  image: z.enum(["openai_image", "gemini_image"]),
  video: z.enum(["none", "veo", "higgsfield"]),
});

export async function saveProviders(slug: string, _: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenant, supabase } = await admin(slug);
    const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "Escolha um provedor válido para cada tarefa." };
    const { data, error } = await supabase
      .from("ai_settings")
      .update({ default_caption_provider: parsed.data.caption, default_image_provider: parsed.data.image, default_video_provider: parsed.data.video })
      .eq("tenant_id", tenant.id)
      .select("tenant_id");
    if (error || !data?.length) return { error: "Não foi possível salvar os provedores." };
    revalidatePath(`/${slug}/ia`);
    return { ok: "Provedores salvos. As próximas gerações já usam esta escolha." };
  } catch (e) {
    return { error: e instanceof Error && e.message.startsWith("Só") ? e.message : "Não foi possível salvar os provedores." };
  }
}

export async function saveBilling(slug: string, _: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenant, supabase } = await admin(slug);
    const parsed = z.object({ mode: z.enum(["platform", "own"]) }).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "Escolha a forma de cobrança." };
    const { data, error } = await supabase.from("ai_settings").update({ billing_mode: parsed.data.mode }).eq("tenant_id", tenant.id).select("tenant_id");
    if (error || !data?.length) return { error: "Não foi possível mudar a cobrança." };
    revalidatePath(`/${slug}/ia`);
    return { ok: parsed.data.mode === "own" ? "Agora as gerações usam as chaves próprias do cliente, sem gastar créditos." : "Agora as gerações usam os créditos da Visus." };
  } catch (e) {
    return { error: e instanceof Error && e.message.startsWith("Só") ? e.message : "Não foi possível mudar a cobrança." };
  }
}

const keySchema = z.object({
  provider: z.enum(KEY_PROVIDERS),
  key: z.string().trim().min(20, "Cole a chave completa.").max(400),
});

export async function saveOwnKey(slug: string, _: FormState, formData: FormData): Promise<FormState> {
  try {
    const { tenant, user } = await admin(slug);
    const parsed = keySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const problem = await checkKey(parsed.data.provider, parsed.data.key, providersFromEnv()).catch(() => "Não deu para conferir a chave agora. Tente de novo.");
    if (problem) return { error: problem };
    // O cofre só é gravado pelo servidor, sempre com o tenant_id já validado acima
    const { error } = await createAdminClient().rpc("store_tenant_ai_key", { p_tenant: tenant.id, p_provider: parsed.data.provider, p_key: parsed.data.key, p_actor: user.id });
    if (error) return { error: "Não foi possível guardar a chave." };
    revalidatePath(`/${slug}/ia`);
    return { ok: "Chave conferida e guardada com criptografia." };
  } catch (e) {
    return { error: e instanceof Error && e.message.startsWith("Só") ? e.message : "Não foi possível guardar a chave." };
  }
}

export async function removeOwnKey(slug: string, provider: string) {
  const { tenant, user } = await admin(slug);
  const p = z.enum(KEY_PROVIDERS).parse(provider);
  await createAdminClient().rpc("store_tenant_ai_key", { p_tenant: tenant.id, p_provider: p, p_key: "", p_actor: user.id });
  revalidatePath(`/${slug}/ia`);
}
