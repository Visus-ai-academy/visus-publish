import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { z } from "zod";
import { ROLES } from "@/lib/auth/permissions";
import { newInviteToken } from "./token";

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  role: z.enum(ROLES),
});

/**
 * Cria (ou renova) o convite com o cliente do usuário: o RLS só deixa
 * admin do tenant ou admin da plataforma. Devolve o link para copiar.
 */
export async function createInvitation(supabase: SupabaseClient<Database>, tenantId: string, input: z.infer<typeof inviteSchema>) {
  const { token, hash } = newInviteToken();
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("invitations").upsert(
    {
      tenant_id: tenantId,
      email: input.email,
      role: input.role,
      token_hash: hash,
      invited_by: auth.user?.id,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      accepted_at: null,
    },
    { onConflict: "tenant_id,email" },
  );
  if (error) throw new Error("Não foi possível criar o convite.");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}/convite/${token}`;
}
