"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { disconnectAccount } from "@/lib/meta/accounts";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenant } from "@/lib/tenant";

export async function setApprovalMode(slug: string, accountId: string, requireApproval: boolean) {
  const { tenant, role, supabase } = await resolveTenant(slug);
  if (!can(role, "manage_tenant")) return;
  await supabase
    .from("ig_accounts")
    .update({ require_approval: requireApproval })
    .eq("tenant_id", tenant.id)
    .eq("id", z.string().uuid().parse(accountId));
  revalidatePath(`/${slug}/contas`);
}

export async function disconnect(slug: string, accountId: string) {
  const { tenant, role, user } = await resolveTenant(slug);
  if (!can(role, "manage_tenant")) return;
  await disconnectAccount(createAdminClient(), tenant.id, z.string().uuid().parse(accountId), user.id);
  revalidatePath(`/${slug}/contas`);
}

/** Troca por onde a conta publica (Meta ou Metricool). O banco confere o papel e se o provedor está ligado. */
export async function setPublishVia(slug: string, accountId: string, via: "meta" | "metricool") {
  const { role, supabase } = await resolveTenant(slug);
  if (!can(role, "manage_tenant")) return;
  await supabase.rpc("set_publish_via", { p_account: z.string().uuid().parse(accountId), p_via: z.enum(["meta", "metricool"]).parse(via) });
  revalidatePath(`/${slug}/contas`);
}
