"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/permissions";
import { createInvitation, inviteSchema } from "@/lib/invitations/create";
import { resolveTenant } from "@/lib/tenant";

export type InviteState = { error?: string; link?: string; email?: string } | undefined;

export async function inviteMember(slug: string, _: InviteState, formData: FormData): Promise<InviteState> {
  const { tenant, role, supabase } = await resolveTenant(slug);
  if (!can(role, "manage_tenant")) return { error: "Só administradores convidam pessoas." };

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const link = await createInvitation(supabase, tenant.id, parsed.data);
    revalidatePath(`/${slug}/equipe`);
    return { link, email: parsed.data.email };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
