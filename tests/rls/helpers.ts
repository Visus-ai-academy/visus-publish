import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type Client = SupabaseClient<Database>;

// Chaves de demonstração do `supabase start` local (públicas, iguais em toda instalação).
// Em CI ou outro ambiente, sobrescreva pelas variáveis.
const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anonKey =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export const service = createClient<Database>(url, serviceKey, opts);

export function anon(): Client {
  return createClient<Database>(url, anonKey, opts);
}

const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = "senha-de-teste-123";

export async function createUser(label: string): Promise<{ id: string; email: string; client: Client }> {
  const email = `${label}-${run}@teste.visus.local`;
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser falhou");
  const client = anon();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

export function slug(base: string) {
  return `${base}-${run}`;
}

export function must<R extends { data: unknown; error: { message: string } | null }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error("sem dados");
  return res.data as NonNullable<R["data"]>;
}

export function ok(res: { error: { message: string } | null }) {
  if (res.error) throw new Error(res.error.message);
}
