"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string } | undefined;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  password: z.string().min(8, "A senha tem pelo menos 8 caracteres."),
  next: z.string().optional(),
});

function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function signIn(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: "E-mail ou senha incorretos." };
  redirect(safeNext(parsed.data.next));
}

const signUpSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8, "Use pelo menos 8 caracteres."),
});

/** Cria a conta de quem recebeu convite, com o e-mail do convite, e já aceita. */
export async function signUpFromInvite(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: preview } = await supabase.rpc("invitation_preview", { p_token: parsed.data.token });
  const inv = preview?.[0];
  if (!inv?.valid) return { error: "Este convite não é mais válido." };

  const { data, error } = await supabase.auth.signUp({ email: inv.email, password: parsed.data.password });
  if (error) return { error: "Não foi possível criar a conta. Se você já tem conta, entre com sua senha." };
  if (!data.session) return { error: "Enviamos um e-mail de confirmação. Confirme e abra o convite de novo." };

  return acceptInvite(parsed.data.token);
}

export async function acceptInviteAction(_: FormState, formData: FormData): Promise<FormState> {
  const token = z.string().min(16).safeParse(formData.get("token"));
  if (!token.success) return { error: "Convite inválido." };
  return acceptInvite(token.data);
}

async function acceptInvite(token: string): Promise<FormState> {
  const supabase = await createClient();
  const { data: tenantId, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) {
    if (error.message.includes("outro e-mail")) return { error: "Este convite é para outro e-mail. Saia e entre com o e-mail convidado." };
    return { error: "Este convite não é mais válido." };
  }
  const { data: tenant } = await supabase.from("tenants").select("slug").eq("id", tenantId).single();
  redirect(tenant ? `/${tenant.slug}/calendario` : "/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
