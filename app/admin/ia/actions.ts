"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkKey } from "@/lib/ai/keys";
import { KEY_PROVIDERS, providersFromEnv } from "@/lib/ai/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin, requireUser } from "@/lib/tenant";

export type KeyState = { error?: string; ok?: string } | undefined;

const keySchema = z.object({
  provider: z.enum(KEY_PROVIDERS),
  key: z.string().trim().min(20, "Cole a chave completa.").max(400),
});

export async function saveAiKey(_: KeyState, formData: FormData): Promise<KeyState> {
  if (!(await isPlatformAdmin())) return { error: "Só a equipe da Visus cadastra chaves de IA." };
  const parsed = keySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { provider, key } = parsed.data;

  const problem = await checkKey(provider, key, providersFromEnv()).catch(() => "Não deu para conferir a chave agora. Tente de novo.");
  if (problem) return { error: problem };

  const { user } = await requireUser();
  const { error } = await createAdminClient().rpc("store_platform_ai_key", { p_provider: provider, p_key: key, p_actor: user.id });
  if (error) return { error: "Não foi possível guardar a chave." };
  revalidatePath("/admin/ia");
  return { ok: "Chave conferida e guardada com criptografia." };
}

export async function removeAiKey(provider: string) {
  if (!(await isPlatformAdmin())) return;
  const p = z.enum(KEY_PROVIDERS).parse(provider);
  await createAdminClient().rpc("store_platform_ai_key", { p_provider: p, p_key: "" });
  revalidatePath("/admin/ia");
}

export async function saveModel(_: KeyState, formData: FormData): Promise<KeyState> {
  if (!(await isPlatformAdmin())) return { error: "Só a equipe da Visus muda modelos." };
  const parsed = z
    .object({
      id: z.string().min(3).max(60),
      model: z.string().trim().regex(/^[\w.:\/-]{2,80}$/, "Nome de modelo inválido."),
      cost: z.coerce.number({ message: "Informe o custo em créditos." }).min(0, "O custo não pode ser negativo.").max(10000, "Custo alto demais."),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("ai_models").update({ model: parsed.data.model, unit_cost_credits: parsed.data.cost }).eq("id", parsed.data.id).select("id");
  if (error || !data?.length) return { error: "Não foi possível salvar o modelo." };
  revalidatePath("/admin/ia");
  return { ok: "Modelo salvo." };
}
