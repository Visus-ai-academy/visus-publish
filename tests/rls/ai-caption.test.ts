import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { complianceFor, SuggestError, suggestCaption } from "@/lib/ai/caption";
import type { ProvidersConfig } from "@/lib/ai/providers";
import { createUser, must, ok, service, slug } from "./helpers";

type User = Awaited<ReturnType<typeof createUser>>;
let admin: User, editor: User, approver: User, outsider: User, platform: User;
let tenant: string, other: string, health: string, plain: string, otherAccount: string;

const FRAME = "data:image/jpeg;base64,AAAA";

function fakeAi(reply: object) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  }) as unknown as typeof fetch;
  const cfg: ProvidersConfig = { openai: { baseUrl: "http://fake-openai/v1", fetch: f } };
  return { cfg, calls };
}

async function newPost(client: User["client"], account: string) {
  return must(
    await client
      .from("posts")
      .insert({ tenant_id: tenant, ig_account_id: account, scheduled_at: new Date(Date.now() + 3_600_000).toISOString(), theme: "T", format: "image", origin: "upload" })
      .select("id")
      .single(),
  ).id;
}

beforeAll(async () => {
  [admin, editor, approver, outsider, platform] = await Promise.all(["aic-admin", "aic-editor", "aic-approver", "aic-out", "aic-platform"].map(createUser));
  tenant = must(await service.from("tenants").insert({ slug: slug("aic"), name: "AIC" }).select("id").single()).id;
  other = must(await service.from("tenants").insert({ slug: slug("aic-o"), name: "AIC O" }).select("id").single()).id;
  must(
    await service
      .from("memberships")
      .insert([
        { tenant_id: tenant, user_id: admin.id, role: "admin" },
        { tenant_id: tenant, user_id: editor.id, role: "editor" },
        { tenant_id: tenant, user_id: approver.id, role: "approver" },
        { tenant_id: other, user_id: outsider.id, role: "admin" },
      ])
      .select(),
  );
  ok(await service.from("platform_admins").insert({ user_id: platform.id }));
  health = must(await service.from("ig_accounts").insert({ tenant_id: tenant, ig_user_id: slug("aic-h"), username: "clinica", require_approval: false }).select("id").single()).id;
  plain = must(await service.from("ig_accounts").insert({ tenant_id: tenant, ig_user_id: slug("aic-p"), username: "loja", require_approval: false }).select("id").single()).id;
  otherAccount = must(await service.from("ig_accounts").insert({ tenant_id: other, ig_user_id: slug("aic-x"), username: "outra" }).select("id").single()).id;
  ok(await service.from("brand_profiles").insert({ tenant_id: tenant, ig_account_id: health, is_healthcare: true, default_hashtags: ["#saude"], tone: "acolhedor" }));
  ok(await service.rpc("store_platform_ai_key", { p_provider: "openai", p_key: "sk-plataforma" }));
  ok(await service.rpc("store_platform_ai_key", { p_provider: "gemini", p_key: "" }));
});

afterAll(async () => {
  await service.rpc("store_platform_ai_key", { p_provider: "openai", p_key: "" });
});

describe("chaves de IA", () => {
  it("só o servidor grava e lê; o admin da plataforma vê só que existe", async () => {
    for (const u of [admin, editor, platform]) {
      expect((await u.client.rpc("read_ai_key", { p_tenant: tenant, p_provider: "openai" })).error).not.toBeNull();
      expect((await u.client.rpc("store_platform_ai_key", { p_provider: "openai", p_key: "x".repeat(30) })).error).not.toBeNull();
    }
    const seen = must(await platform.client.from("ai_platform_keys").select("*"));
    expect(seen.map((r) => r.provider)).toContain("openai");
    expect(JSON.stringify(seen)).not.toContain("sk-plataforma");
    expect(must(await admin.client.from("ai_platform_keys").select("*"))).toHaveLength(0);
    expect(must(await platform.client.from("ai_models").select("id").eq("task", "caption")).length).toBeGreaterThanOrEqual(2);
  });

  it("modo 'platform' usa a chave da Visus; modo 'own' só a do próprio cliente", async () => {
    expect(must(await service.rpc("read_ai_key", { p_tenant: tenant, p_provider: "openai" }))).toBe("sk-plataforma");
    ok(await service.from("ai_settings").update({ billing_mode: "own" }).eq("tenant_id", other));
    expect((await service.rpc("read_ai_key", { p_tenant: other, p_provider: "openai" })).data).toBeNull();
  });
});

describe("tema e legenda a partir do criativo", () => {
  it("gera com o brief da marca, grava o job sem as imagens e marca riscos de saúde", async () => {
    const { cfg, calls } = fakeAi({ tema: "Cuidados com a pele", legenda: "Resultado garantido no verão.", hashtags: ["pele"], riscos: ["Mostra antes e depois"] });
    const s = await suggestCaption(service, tenant, { accountId: health, format: "image", mediaKind: "image", frames: [FRAME] }, { providers: cfg });
    expect(s.theme).toBe("Cuidados com a pele");
    expect(s.caption).toBe("Resultado garantido no verão.\n\n#saude #pele");
    expect(s.flags).toEqual(["Promete resultado", "Mostra antes e depois"]);
    expect(calls[0].headers.authorization).toBe("Bearer sk-plataforma");
    expect(calls[0].body.model).toBe("gpt-4.1-mini");
    expect(JSON.stringify(calls[0].body)).toContain("CFM");

    const job = must(await service.from("generation_jobs").select("*").eq("id", s.jobId).single());
    expect(job).toMatchObject({ tenant_id: tenant, task: "caption", provider: "openai", status: "succeeded" });
    expect(JSON.stringify(job.request)).not.toContain("AAAA");
    // O job é visível para o cliente, não para outro
    expect(must(await editor.client.from("generation_jobs").select("id").eq("id", s.jobId))).toHaveLength(1);
    expect(must(await outsider.client.from("generation_jobs").select("id").eq("id", s.jobId))).toHaveLength(0);
  });

  it("não usa conta de outro cliente e explica quando falta chave", async () => {
    const { cfg } = fakeAi({ tema: "x" });
    await expect(suggestCaption(service, tenant, { accountId: otherAccount, format: "image", mediaKind: "image", frames: [FRAME] }, { providers: cfg })).rejects.toThrow(
      "Conta não encontrada.",
    );
    const e = await suggestCaption(service, other, { accountId: otherAccount, format: "image", mediaKind: "image", frames: [FRAME] }, { providers: cfg }).catch((x) => x);
    expect(e).toBeInstanceOf(SuggestError);
    expect(e.message).toMatch(/chave de IA/);
  });

  it("resposta fora do formato vira erro claro e job com falha", async () => {
    const { cfg } = fakeAi({ titulo: "sem tema" });
    await expect(suggestCaption(service, tenant, { accountId: plain, format: "reels", mediaKind: "video", frames: [FRAME, FRAME] }, { providers: cfg })).rejects.toThrow(
      /formato inesperado/,
    );
    const [job] = must(await service.from("generation_jobs").select("status, error").eq("tenant_id", tenant).order("created_at", { ascending: false }).limit(1));
    expect(job.status).toBe("failed");
  });
});

describe("alertas de publicidade médica no post", () => {
  it("quem usa a API não grava nem apaga alertas direto", async () => {
    const ins = await editor.client.from("posts").insert({
      tenant_id: tenant,
      ig_account_id: plain,
      scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
      theme: "T",
      format: "image",
      origin: "upload",
      compliance_flags: ["x"],
    });
    expect(ins.error?.message).toMatch(/alertas/);
    const id = await newPost(editor.client, health);
    ok(await editor.client.rpc("add_post_flags", { p_post: id, p_flags: ["Promete cura"] }));
    const upd = await editor.client.from("posts").update({ compliance_flags: [] }).eq("id", id);
    expect(upd.error?.message).toMatch(/alertas/);
    // Aprovador e outro cliente não acrescentam
    expect((await approver.client.rpc("add_post_flags", { p_post: id, p_flags: ["x"] })).error).not.toBeNull();
    expect((await outsider.client.rpc("add_post_flags", { p_post: id, p_flags: ["x"] })).error).not.toBeNull();
    expect(must(await service.from("posts").select("compliance_flags").eq("id", id).single()).compliance_flags).toEqual(["Promete cura"]);
  });

  it("post com alerta vai para aprovação mesmo em conta que publica direto", async () => {
    const flagged = await newPost(editor.client, health);
    const clean = await newPost(editor.client, health);
    ok(await editor.client.rpc("add_post_flags", { p_post: flagged, p_flags: ["Fala em antes e depois"] }));
    for (const id of [flagged, clean]) {
      ok(await editor.client.from("post_media").insert({ tenant_id: tenant, post_id: id, kind: "image", storage_path: `${tenant}/${id}/00.jpg` }));
    }
    expect(must(await editor.client.rpc("transition_post", { p_post: flagged, p_to: "scheduled" }))).toBe("pending_approval");
    expect(must(await editor.client.rpc("transition_post", { p_post: clean, p_to: "scheduled" }))).toBe("scheduled");
    expect((await editor.client.rpc("add_post_flags", { p_post: clean, p_flags: ["x"] })).error).not.toBeNull();
  });

  it("o servidor confere o texto final e reaproveita os riscos do job da IA", async () => {
    const { cfg } = fakeAi({ tema: "Pele", legenda: "Dicas", riscos: ["Imagem com antes e depois"] });
    const s = await suggestCaption(service, tenant, { accountId: health, format: "image", mediaKind: "image", frames: [FRAME] }, { providers: cfg });
    const r = await complianceFor(editor.client, tenant, health, "Sem dor e com desconto", s.jobId);
    expect(r.flags).toEqual(["Promete ausência de dor", "Fala de preço ou promoção", "Imagem com antes e depois"]);
    expect(r.job?.provider).toBe("openai");
    expect((await complianceFor(editor.client, tenant, plain, "Sem dor", null)).flags).toEqual([]);
    // Job de outro cliente não é aceito
    expect((await complianceFor(outsider.client, other, otherAccount, "x", s.jobId)).job).toBeNull();
  });
});
