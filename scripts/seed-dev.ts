// Dados de desenvolvimento para o Supabase LOCAL. Recusa rodar contra outro host.
// Uso: pnpm db:seed   (depois de `supabase start` / `supabase db reset`)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error("Defina SUPABASE_SERVICE_ROLE_KEY (veja `supabase status`).");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`Seed só roda no Supabase local, não em ${url}.`);

const db = createClient(url, key, { auth: { persistSession: false } });
const PASSWORD = "visus-dev-123";

async function user(email: string) {
  const { data: list } = await db.auth.admin.listUsers();
  const found = list.users.find((u) => u.email === email);
  if (found) return found.id;
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

async function tenant(slug: string, name: string, plan: string) {
  const { data, error } = await db.from("tenants").upsert({ slug, name, plan }, { onConflict: "slug" }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function member(tenantId: string, userId: string, role: string) {
  const { error } = await db.from("memberships").upsert({ tenant_id: tenantId, user_id: userId, role });
  if (error) throw error;
}

const platform = await user("admin@visus.local");
await db.from("platform_admins").upsert({ user_id: platform });

const aurora = await tenant("clinica-aurora", "Clínica Aurora", "Profissional");
const belaPele = await tenant("bela-pele", "Bela Pele Dermatologia", "Essencial");

await member(aurora, await user("ana@aurora.local"), "admin");
await member(aurora, await user("edu@aurora.local"), "editor");
await member(aurora, await user("dra.lucia@aurora.local"), "approver");
await member(belaPele, await user("bia@belapele.local"), "admin");

async function account(tenantId: string, igUserId: string, username: string, requireApproval: boolean) {
  const { data, error } = await db
    .from("ig_accounts")
    .upsert({ tenant_id: tenantId, ig_user_id: igUserId, username, require_approval: requireApproval }, { onConflict: "ig_user_id" })
    .select("id")
    .single();
  if (error) throw error;
  // Token falso: só funciona com a Meta simulada dos testes.
  const { error: e } = await db.rpc("store_ig_token", { p_account: data.id, p_token: `dev-token-${username}`, p_expires_at: new Date(Date.now() + 50 * 86_400_000).toISOString() });
  if (e) throw e;
}

await account(aurora, "17841400000000001", "clinicaaurora", true);
await account(aurora, "17841400000000002", "aurora.estetica", false);
await account(belaPele, "17841400000000003", "belapele", false);

console.log(`Pronto. Senha de todos: ${PASSWORD}
  admin@visus.local       admin da plataforma
  ana@aurora.local        admin da Clínica Aurora
  edu@aurora.local        editor da Clínica Aurora
  dra.lucia@aurora.local  aprovadora da Clínica Aurora
  bia@belapele.local      admin da Bela Pele`);
