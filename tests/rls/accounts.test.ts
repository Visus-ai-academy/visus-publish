import { beforeAll, describe, expect, it } from "vitest";
import { connectAccount, disconnectAccount, refreshExpiringTokens } from "@/lib/meta/accounts";
import { createUser, must, service, slug } from "./helpers";

let userId: string, tenantA: string, tenantB: string;

beforeAll(async () => {
  userId = (await createUser("conn-admin")).id;
  tenantA = must(await service.from("tenants").insert({ slug: slug("conn-a"), name: "Conn A" }).select("id").single()).id;
  tenantB = must(await service.from("tenants").insert({ slug: slug("conn-b"), name: "Conn B" }).select("id").single()).id;
});

const profile = (id: string) => ({ user_id: id, username: `user_${id}`, account_type: "BUSINESS" });

describe("conectar conta do Instagram", () => {
  it("cria a conta com token no Vault e reconecta sem duplicar", async () => {
    const ig = slug("ig1");
    const r1 = await connectAccount(service, { tenantId: tenantA, userId, profile: profile(ig), token: "tok-1", expiresInSeconds: 5_184_000 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(must(await service.rpc("read_ig_token", { p_account: r1.accountId }))).toBe("tok-1");

    const r2 = await connectAccount(service, { tenantId: tenantA, userId, profile: profile(ig), token: "tok-2", expiresInSeconds: 5_184_000 });
    expect(r2).toEqual(r1);
    expect(must(await service.rpc("read_ig_token", { p_account: r1.accountId }))).toBe("tok-2");
    expect(must(await service.from("ig_accounts").select("id").eq("ig_user_id", ig))).toHaveLength(1);
  });

  it("a mesma conta não entra em outro cliente", async () => {
    const ig = slug("ig2");
    await connectAccount(service, { tenantId: tenantA, userId, profile: profile(ig), token: "a", expiresInSeconds: 100 });
    const r = await connectAccount(service, { tenantId: tenantB, userId, profile: profile(ig), token: "b", expiresInSeconds: 100 });
    expect(r).toEqual({ ok: false, reason: "other_tenant" });
  });

  it("desconectar apaga o token e não mexe em conta de outro cliente", async () => {
    const r = await connectAccount(service, { tenantId: tenantA, userId, profile: profile(slug("ig3")), token: "x", expiresInSeconds: 100 });
    if (!r.ok) throw new Error("falhou");
    expect(await disconnectAccount(service, tenantB, r.accountId, userId)).toBe(false);
    expect(must(await service.rpc("read_ig_token", { p_account: r.accountId }))).toBe("x");
    expect(await disconnectAccount(service, tenantA, r.accountId, userId)).toBe(true);
    const { data } = await service.rpc("read_ig_token", { p_account: r.accountId });
    expect(data).toBeNull();
    expect(must(await service.from("ig_accounts").select("status").eq("id", r.accountId).single()).status).toBe("disconnected");
  });
});

describe("renovação de tokens", () => {
  it("renova os que vencem em menos de 10 dias e marca falhas para reconectar", async () => {
    const soon = await connectAccount(service, { tenantId: tenantA, userId, profile: profile(slug("soon")), token: "velho", expiresInSeconds: 3 * 86_400 });
    const later = await connectAccount(service, { tenantId: tenantA, userId, profile: profile(slug("later")), token: "longe", expiresInSeconds: 40 * 86_400 });
    const broken = await connectAccount(service, { tenantId: tenantA, userId, profile: profile(slug("broken")), token: "quebrado", expiresInSeconds: 86_400 });
    if (!soon.ok || !later.ok || !broken.ok) throw new Error("falhou");

    const res = await refreshExpiringTokens(service, async (t) => {
      if (t === "quebrado") throw new Error("invalid");
      return { access_token: `${t}-novo`, expires_in: 60 * 86_400 };
    });
    const ids = res.map((r) => r.accountId);
    expect(ids).toEqual(expect.arrayContaining([soon.accountId, broken.accountId]));
    expect(ids).not.toContain(later.accountId);
    expect(must(await service.rpc("read_ig_token", { p_account: soon.accountId }))).toBe("velho-novo");
    expect(must(await service.rpc("read_ig_token", { p_account: later.accountId }))).toBe("longe");
    expect(must(await service.from("ig_accounts").select("status").eq("id", broken.accountId).single()).status).toBe("needs_reauth");
  });
});
