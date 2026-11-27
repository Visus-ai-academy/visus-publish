import { describe, expect, it } from "vitest";
import { MetaApiError, assignedInstagramAccounts, authorizeUrl, createContainer, exchangeCode, exchangeUnifiedCode, publishingLimit, type MetaConfig } from "./client";

function cfgWith(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const seen: Array<{ url: string; body?: string }> = [];
  const cfg: MetaConfig = {
    appId: "app",
    appSecret: "secret",
    redirectUri: "https://app.test/api/meta/oauth/callback",
    graphVersion: "v24.0",
    fetch: (async (url: string, init?: RequestInit) => {
      seen.push({ url, body: init?.body?.toString() });
      const r = handler(url, init);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as typeof fetch,
  };
  return { cfg, seen };
}

describe("cliente da Meta", () => {
  it("monta a URL de login com os escopos e o state", () => {
    const { cfg } = cfgWith(() => ({ body: {} }));
    const u = new URL(authorizeUrl(cfg, "abc"));
    expect(u.host).toBe("www.instagram.com");
    expect(u.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights");
    expect(u.searchParams.get("state")).toBe("abc");
  });

  it("aceita as duas formas de resposta da troca do code", async () => {
    const a = cfgWith(() => ({ body: { access_token: "t1", user_id: 123 } }));
    expect(await exchangeCode(a.cfg, "c")).toMatchObject({ access_token: "t1" });
    const b = cfgWith(() => ({ body: { data: [{ access_token: "t2", user_id: "9" }] } }));
    expect(await exchangeCode(b.cfg, "c")).toMatchObject({ access_token: "t2" });
  });

  it("envia is_ai_generated e legenda no container", async () => {
    const { cfg, seen } = cfgWith(() => ({ body: { id: "c1" } }));
    await createContainer(cfg, "tok", "42", { kind: "image", imageUrl: "https://x/y.jpg", caption: "Oi", aiGenerated: true });
    expect(seen[0].url).toBe("https://graph.instagram.com/v24.0/42/media");
    const body = new URLSearchParams(seen[0].body);
    expect(body.get("is_ai_generated")).toBe("true");
    expect(body.get("caption")).toBe("Oi");
    expect(body.get("image_url")).toBe("https://x/y.jpg");
  });

  it("lê o limite de publicação da resposta, sem número fixo", async () => {
    const { cfg } = cfgWith(() => ({ body: { data: [{ quota_usage: 7, config: { quota_total: 100, quota_duration: 86400 } }] } }));
    expect(await publishingLimit(cfg, "tok", "42")).toEqual({ used: 7, total: 100 });
  });

  it("marca erro temporário da Meta", async () => {
    const { cfg } = cfgWith(() => ({ status: 500, body: { error: { message: "Please retry", code: 2, is_transient: true } } }));
    await expect(createContainer(cfg, "t", "1", { kind: "image", imageUrl: "u" })).rejects.toMatchObject({ transient: true, code: 2 });
    const bad = cfgWith(() => ({ status: 400, body: { error: { message: "Invalid image", code: 9004 } } }));
    const err = await createContainer(bad.cfg, "t", "1", { kind: "image", imageUrl: "u" }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.transient).toBe(false);
  });

  it("login unificado: entra pelo Facebook com a configuração e usa graph.facebook.com", async () => {
    const { cfg, seen } = cfgWith((url) => {
      if (url.includes("/oauth/access_token")) return { body: { access_token: "suat", token_type: "bearer" } };
      if (url.includes("/me/assigned_instagram_accounts")) return { body: { data: [{ id: "1784" }] } };
      return { body: { id: "1784", username: "clinica", name: "Clínica" } };
    });
    const uni = { ...cfg, loginConfigId: "9876" };
    const u = new URL(authorizeUrl(uni, "st"));
    expect(u.host).toBe("www.facebook.com");
    expect(u.pathname).toBe("/v24.0/dialog/oauth");
    expect(u.searchParams.get("config_id")).toBe("9876");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBeNull();
    expect(await exchangeUnifiedCode(uni, "c")).toEqual({ access_token: "suat" });
    const profiles = await assignedInstagramAccounts(uni, "suat");
    expect(profiles).toEqual([{ user_id: "1784", username: "clinica", name: "Clínica", profile_picture_url: undefined, account_type: "BUSINESS" }]);
    expect(seen.every((s) => s.url.startsWith("https://graph.facebook.com/v24.0/"))).toBe(true);
    expect(seen[0].url).toContain("redirect_uri=");
  });
});
