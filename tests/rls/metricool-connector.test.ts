import { beforeAll, describe, expect, it } from "vitest";
import { linkMetricoolAccount } from "@/lib/meta/accounts";
import type { MetaPort } from "@/lib/meta/port";
import { loadMetricoolAuth } from "@/lib/metricool/auth";
import type { MetricoolPostStatus } from "@/lib/metricool/client";
import type { MetricoolAuth, MetricoolPort } from "@/lib/metricool/port";
import { publishDue } from "@/lib/publishing/publisher";
import { createUser, must, ok, service, slug } from "./helpers";

const noMeta: MetaPort = new Proxy({} as MetaPort, {
  get: () => async () => {
    throw new Error("Meta não deveria ser chamada");
  },
});

type User = Awaited<ReturnType<typeof createUser>>;
let admin: User, editor: User;
let tenant: string, other: string, account: string;

const soon = () => new Date(Date.now() + 60 * 60_000).toISOString();

async function storeOAuth(t: string, access: string, refresh: string | null, expiresAt: string) {
  ok(await service.rpc("store_metricool_oauth", { p_tenant: t, p_client_id: "cid", p_access: access, p_refresh: refresh ?? undefined, p_expires_at: expiresAt }));
}

beforeAll(async () => {
  [admin, editor] = await Promise.all([createUser("mcc-admin"), createUser("mcc-editor")]);
  tenant = must(await service.from("tenants").insert({ slug: slug("mcc"), name: "MCC" }).select("id").single()).id;
  other = must(await service.from("tenants").insert({ slug: slug("mcc-o"), name: "MCC O" }).select("id").single()).id;
  must(
    await service
      .from("memberships")
      .insert([
        { tenant_id: tenant, user_id: admin.id, role: "admin" },
        { tenant_id: tenant, user_id: editor.id, role: "editor" },
      ])
      .select(),
  );
  await storeOAuth(tenant, "acc-1", "ref-1", soon());
  const a = await linkMetricoolAccount(service, { tenantId: tenant, userId: admin.id, blogId: slug("blog-mcc"), username: "mcc", requireApproval: false });
  if (!a.ok) throw new Error("vínculo falhou");
  account = a.accountId;
});

describe("conexão pelo conector (OAuth)", () => {
  it("tokens só no Vault e só o servidor lê", async () => {
    const [c] = must(await service.rpc("read_metricool_credentials", { p_tenant: tenant }));
    expect(c).toMatchObject({ auth_mode: "oauth", user_id: null, token: "acc-1", refresh_token: "ref-1", client_id: "cid", client_secret: null });

    for (const u of [admin, editor]) {
      expect((await u.client.rpc("read_metricool_credentials", { p_tenant: tenant })).error).not.toBeNull();
      expect((await u.client.rpc("store_metricool_oauth", { p_tenant: tenant, p_client_id: "x", p_access: "x" })).error).not.toBeNull();
      expect((await u.client.rpc("set_metricool_tools", { p_tenant: tenant, p_tools: [] })).error).not.toBeNull();
    }
    const seen = must(await admin.client.from("metricool_connections").select("*").eq("tenant_id", tenant));
    expect(seen).toHaveLength(1);
    expect(seen[0].auth_mode).toBe("oauth");
    expect(JSON.stringify(seen)).not.toContain("acc-1");
    expect(must(await editor.client.from("metricool_connections").select("*").eq("tenant_id", tenant))).toHaveLength(0);
    // Outro cliente não enxerga
    expect(must(await admin.client.from("metricool_connections").select("*").eq("tenant_id", other))).toHaveLength(0);
  });

  it("refresh nulo mantém o atual; trocar para token da API limpa o OAuth e volta", async () => {
    await storeOAuth(other, "o-1", "o-ref", soon());
    await storeOAuth(other, "o-2", null, soon());
    let [c] = must(await service.rpc("read_metricool_credentials", { p_tenant: other }));
    expect(c).toMatchObject({ token: "o-2", refresh_token: "o-ref" });

    ok(await service.rpc("store_metricool_token", { p_tenant: other, p_user_id: "9", p_token: "api-tok" }));
    [c] = must(await service.rpc("read_metricool_credentials", { p_tenant: other }));
    expect(c).toMatchObject({ auth_mode: "api_token", user_id: "9", token: "api-tok", refresh_token: null, client_id: null });

    await storeOAuth(other, "o-3", "o-ref3", soon());
    [c] = must(await service.rpc("read_metricool_credentials", { p_tenant: other }));
    expect(c).toMatchObject({ auth_mode: "oauth", user_id: null, token: "o-3", refresh_token: "o-ref3" });

    ok(await service.rpc("delete_metricool_connection", { p_tenant: other }));
    expect(must(await service.rpc("read_metricool_credentials", { p_tenant: other }))).toEqual([]);
  });

  it("renova o token que está vencendo e grava o novo", async () => {
    await storeOAuth(other, "old", "r1", new Date(Date.now() + 60_000).toISOString());
    const bodies: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/.well-known/oauth-protected-resource")) return Response.json({ authorization_servers: ["https://as.test"] });
      if (url.endsWith("/.well-known/oauth-authorization-server")) return Response.json({ authorization_endpoint: "https://as.test/a", token_endpoint: "https://as.test/t" });
      bodies.push(String(init?.body));
      return Response.json({ access_token: "new", refresh_token: "r2", expires_in: 3600 });
    }) as typeof fetch;
    const auth = await loadMetricoolAuth(service, other, { oauth: { mcpUrl: "https://mcp.test/mcp", fetch: f } });
    expect(auth).toEqual({ accessToken: "new" });
    expect(bodies[0]).toContain("grant_type=refresh_token");
    expect(bodies[0]).toContain("refresh_token=r1");
    const [c] = must(await service.rpc("read_metricool_credentials", { p_tenant: other }));
    expect(c).toMatchObject({ token: "new", refresh_token: "r2" });
    expect(new Date(c.expires_at).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);

    // Longe de vencer: não chama o login
    expect(await loadMetricoolAuth(service, other, { oauth: { fetch: (async () => { throw new Error("não devia"); }) as typeof fetch } })).toEqual({ accessToken: "new" });
    ok(await service.rpc("delete_metricool_connection", { p_tenant: other }));
  });
});

describe("publicação pelo conector", () => {
  async function due() {
    await service.from("posts").update({ status: "planned" }).in("status", ["scheduled", "publishing"]);
    const post = must(
      await service
        .from("posts")
        .insert({ tenant_id: tenant, ig_account_id: account, scheduled_at: new Date(Date.now() - 60_000).toISOString(), theme: "Conector", format: "image", caption: "Pelo conector", status: "scheduled" })
        .select("*")
        .single(),
    );
    const path = `${tenant}/${post.id}/0.jpg`;
    must(await service.storage.from("media").upload(path, new Blob(["x"]), { upsert: true }));
    must(await service.from("post_media").insert({ tenant_id: tenant, post_id: post.id, position: 0, kind: "image", storage_path: path }).select());
    return post;
  }
  const row = async (id: string) => must(await service.from("posts").select("status, external_post_id, permalink").eq("id", id).single());

  it("envia com o token do login e, sumindo da lista depois do horário, marca como publicado", async () => {
    const seen: MetricoolAuth[] = [];
    let status: MetricoolPostStatus = { status: "NOT_FOUND", publicUrl: null, detail: null };
    const port: MetricoolPort = {
      normalizeMedia: async (_a, _b, u) => u,
      schedulePost: async (a) => (seen.push(a), "cx-1"),
      getPostStatus: async () => status,
      deletePost: async () => undefined,
    };
    const p = await due();
    await publishDue({ db: service, meta: noMeta, metricool: port });
    expect(seen[0]).toEqual({ accessToken: "acc-1" });
    expect(await row(p.id)).toMatchObject({ status: "publishing", external_post_id: "cx-1" });

    // Sumiu logo depois de enviar: ainda espera (pode ser atraso da lista)
    await service.from("posts").update({ last_checked_at: new Date(Date.now() - 5 * 60_000).toISOString() }).eq("id", p.id);
    await publishDue({ db: service, meta: noMeta, metricool: port });
    expect((await row(p.id)).status).toBe("publishing");

    // Passou da folga: saiu
    await service
      .from("posts")
      .update({ last_checked_at: new Date(Date.now() - 5 * 60_000).toISOString(), publishing_started_at: new Date(Date.now() - 10 * 60_000).toISOString() })
      .eq("id", p.id);
    await publishDue({ db: service, meta: noMeta, metricool: port });
    expect(await row(p.id)).toMatchObject({ status: "published", permalink: null });

    status = { status: "PENDING", publicUrl: null, detail: null };
  });
});
