import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { charge, CreditError, NO_CREDITS } from "@/lib/ai/credits";
import { generatePost, PlanError, suggestThemes } from "@/lib/ai/plan";
import type { ProvidersConfig } from "@/lib/ai/providers";
import { pollVideoJobs } from "@/lib/ai/video";
import { createUser, must, ok, service, slug } from "./helpers";

type User = Awaited<ReturnType<typeof createUser>>;
let admin: User, editor: User, approver: User, outsider: User, platform: User;
let tenant: string, other: string, broke: string, account: string, brokeAccount: string;

const JPEG_B64 = "/9j/4AAQSkZJRgABAQ==";
const future = (days = 10) => new Date(Date.now() + days * 86_400_000).toISOString();
const balance = async (t: string) => Number(must(await service.rpc("credit_balance", { p_tenant: t })));

type Calls = { chat: string[]; images: number; video: { url: string; body?: Record<string, unknown>; auth?: string }[] };

/**
 * IA simulada: OpenAI (legenda e imagem), Veo (operação longa) e Higgsfield (request/status).
 * `video.done` controla se o vídeo já ficou pronto; `video.error` faz o provedor falhar.
 */
function fakeAi(video: { done?: boolean; error?: string } = {}) {
  const calls: Calls = { chat: [], images: 0, video: [] };
  const f = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (url.endsWith("/images/generations")) {
      calls.images++;
      return Response.json({ data: [{ b64_json: JPEG_B64 }] });
    }
    if (url.endsWith("/chat/completions")) {
      calls.chat.push(headers.authorization);
      const sys = String(body.messages[0].content);
      const reply = sys.includes("calendário editorial")
        ? { temas: [{ vaga: 1, tema: "Dica do mês" }] }
        : { tema: "x", legenda: "Legenda do Reels.", hashtags: ["#dica"], riscos: [], slides: [] };
      return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
    }
    if (url.includes(":predictLongRunning")) {
      calls.video.push({ url, body, auth: headers["x-goog-api-key"] });
      return Response.json({ name: "models/veo-teste/operations/op-1" });
    }
    if (url.endsWith("/models/veo-teste/operations/op-1")) {
      if (video.error) return Response.json({ done: true, error: { message: video.error } });
      return Response.json(video.done ? { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "http://fake-gemini/v1beta/files/v1:download?alt=media" } }] } } } : { done: false });
    }
    if (url.startsWith("http://fake-gemini/v1beta/files/") || url === "https://cdn.fake-higgsfield/out.mp4") {
      return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { headers: { "content-type": "video/mp4" } });
    }
    if (url === "http://fake-higgsfield/wan/v2.6/image-to-video") {
      calls.video.push({ url, body, auth: headers.authorization });
      return Response.json({ status: "queued", request_id: "req-1" });
    }
    if (url === "http://fake-higgsfield/requests/req-1/status") {
      return Response.json(video.done ? { status: "completed", video: { url: "https://cdn.fake-higgsfield/out.mp4" } } : { status: "in_progress" });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const cfg: ProvidersConfig = {
    openai: { baseUrl: "http://fake/v1", fetch: f },
    gemini: { baseUrl: "http://fake-gemini/v1beta", fetch: f },
    higgsfield: { baseUrl: "http://fake-higgsfield", fetch: f },
  };
  return { cfg, calls };
}

async function reels(t = tenant, acc = account) {
  return must(await service.from("posts").insert({ tenant_id: t, ig_account_id: acc, scheduled_at: future(), theme: "Bastidores da clínica", format: "reels", origin: "ai" }).select("id").single()).id;
}

beforeAll(async () => {
  [admin, editor, approver, outsider, platform] = await Promise.all(["cr-admin", "cr-editor", "cr-approver", "cr-out", "cr-platform"].map(createUser));
  tenant = must(await service.from("tenants").insert({ slug: slug("cr"), name: "CR" }).select("id").single()).id;
  other = must(await service.from("tenants").insert({ slug: slug("cr-o"), name: "CR O" }).select("id").single()).id;
  broke = must(await service.from("tenants").insert({ slug: slug("cr-b"), name: "CR B" }).select("id").single()).id;
  must(
    await service
      .from("memberships")
      .insert([
        { tenant_id: tenant, user_id: admin.id, role: "admin" },
        { tenant_id: tenant, user_id: editor.id, role: "editor" },
        { tenant_id: tenant, user_id: approver.id, role: "approver" },
        { tenant_id: other, user_id: outsider.id, role: "admin" },
        { tenant_id: broke, user_id: editor.id, role: "editor" },
      ])
      .select(),
  );
  ok(await service.from("platform_admins").insert({ user_id: platform.id }));
  account = must(await service.from("ig_accounts").insert({ tenant_id: tenant, ig_user_id: slug("cr-a"), username: "clinica", require_approval: false }).select("id").single()).id;
  brokeAccount = must(await service.from("ig_accounts").insert({ tenant_id: broke, ig_user_id: slug("cr-b"), username: "semsaldo" }).select("id").single()).id;
  ok(await service.rpc("store_platform_ai_key", { p_provider: "openai", p_key: "sk-plataforma" }));
  ok(await service.rpc("store_platform_ai_key", { p_provider: "gemini", p_key: "AIza-plataforma" }));
  ok(await service.rpc("store_platform_ai_key", { p_provider: "higgsfield", p_key: "id-plataforma:segredo" }));
  ok(await service.from("ai_models").update({ model: "veo-teste" }).eq("id", "gemini:video"));
});

afterAll(async () => {
  for (const p of ["openai", "gemini", "higgsfield"]) await service.rpc("store_platform_ai_key", { p_provider: p, p_key: "" });
  await service.from("ai_models").update({ model: "veo-3.0-fast-generate-001" }).eq("id", "gemini:video");
});

describe("créditos", () => {
  it("cliente novo começa sem saldo e só a Visus lança créditos", async () => {
    expect(await balance(tenant)).toBe(0);
    expect((await admin.client.rpc("grant_credits", { p_tenant: tenant, p_amount: 500, p_reason: "eu mesmo" })).error?.code).toBe("42501");
    expect((await admin.client.rpc("charge_credits", { p_tenant: tenant, p_amount: 1, p_reason: "x" })).error).not.toBeNull();
    expect(Number(must(await platform.client.rpc("grant_credits", { p_tenant: tenant, p_amount: 500, p_reason: "pacote" })))).toBe(500);
    const audit = must(await service.from("audit_log").select("action, actor").eq("tenant_id", tenant).eq("action", "credits.grant"));
    expect(audit).toEqual([{ action: "credits.grant", actor: platform.id }]);
  });

  it("saldo e extrato só para quem é do cliente", async () => {
    expect(Number(must(await approver.client.rpc("credit_balance", { p_tenant: tenant })))).toBe(500);
    expect((await outsider.client.rpc("credit_balance", { p_tenant: tenant })).error?.code).toBe("42501");
    expect(must(await admin.client.from("credit_ledger").select("delta").eq("tenant_id", tenant))).toHaveLength(1);
    expect(must(await outsider.client.from("credit_ledger").select("delta").eq("tenant_id", tenant))).toHaveLength(0);
    // Extrato é do administrador
    expect(must(await approver.client.from("credit_ledger").select("delta").eq("tenant_id", tenant))).toHaveLength(0);
  });

  it("débito pelo custo do modelo, estorno e bloqueio sem saldo", async () => {
    const c = await charge(service, tenant, { provider: "openai", task: "image", model: "gpt-image-1", units: 3 });
    expect(c.amount).toBe(12);
    expect(await balance(tenant)).toBe(488);
    await c.refund();
    await c.refund(); // só estorna uma vez
    expect(await balance(tenant)).toBe(500);
    await expect(charge(service, broke, { provider: "openai", task: "caption", model: "gpt-4.1-mini" })).rejects.toBeInstanceOf(CreditError);
  });

  it("sem saldo a IA nem é chamada", async () => {
    const { cfg, calls } = fakeAi();
    const p = suggestThemes(service, broke, { accountId: brokeAccount, monthLabel: "dezembro", slots: [{ date: "2026-12-10", day: 10, time: "10:00", format: "image" }], existing: [] }, { providers: cfg });
    await expect(p).rejects.toBeInstanceOf(PlanError);
    await expect(p).rejects.toThrow(NO_CREDITS);
    expect(calls.chat).toHaveLength(0);
  });
});

describe("chave própria", () => {
  it("só o servidor grava; o cliente vê só as próprias, sem o segredo", async () => {
    const fakeSecret = must(await service.from("ai_platform_keys").select("secret_id").eq("provider", "openai").single()).secret_id;
    // Ninguém aponta a credencial para o segredo da plataforma
    expect((await admin.client.from("ai_credentials").insert({ tenant_id: tenant, provider: "openai", secret_id: fakeSecret })).error).not.toBeNull();
    expect((await admin.client.rpc("store_tenant_ai_key", { p_tenant: tenant, p_provider: "openai", p_key: "sk-propria-123" })).error).not.toBeNull();
    ok(await service.rpc("store_tenant_ai_key", { p_tenant: tenant, p_provider: "openai", p_key: "sk-propria-123", p_actor: admin.id }));
    ok(await service.rpc("store_tenant_ai_key", { p_tenant: tenant, p_provider: "gemini", p_key: "AIza-propria", p_actor: admin.id }));
    expect(must(await admin.client.from("ai_credentials").select("provider").eq("tenant_id", tenant).order("provider"))).toEqual([{ provider: "gemini" }, { provider: "openai" }]);
    expect(must(await outsider.client.from("ai_credentials").select("provider").eq("tenant_id", tenant))).toHaveLength(0);
    expect((await admin.client.from("ai_credentials").delete().eq("tenant_id", tenant).select()).data ?? []).toHaveLength(0);
    const status = must(await editor.client.rpc("ai_key_status", { p_tenant: tenant }));
    expect(status.find((s) => s.provider === "openai")).toEqual({ provider: "openai", platform: true, own: true });
    expect(status.find((s) => s.provider === "higgsfield")).toEqual({ provider: "higgsfield", platform: true, own: false });
    expect((await outsider.client.rpc("ai_key_status", { p_tenant: tenant })).error?.code).toBe("42501");
  });

  it("no modo chave própria usa a chave do cliente e não gasta créditos", async () => {
    ok(await admin.client.from("ai_settings").update({ billing_mode: "own" }).eq("tenant_id", tenant));
    expect(must(await service.rpc("read_ai_key", { p_tenant: tenant, p_provider: "openai" }))).toBe("sk-propria-123");
    const before = await balance(tenant);
    const { cfg, calls } = fakeAi();
    await suggestThemes(service, tenant, { accountId: account, monthLabel: "dezembro", slots: [{ date: "2026-12-10", day: 10, time: "10:00", format: "image" }], existing: [] }, { providers: cfg });
    expect(calls.chat).toEqual(["Bearer sk-propria-123"]);
    expect(await balance(tenant)).toBe(before);
    ok(await admin.client.from("ai_settings").update({ billing_mode: "platform" }).eq("tenant_id", tenant));
    expect(must(await service.rpc("read_ai_key", { p_tenant: tenant, p_provider: "openai" }))).toBe("sk-plataforma");
  });
});

describe("provedor padrão", () => {
  it("o admin do cliente escolhe; valor inválido e outro cliente não passam", async () => {
    expect((await admin.client.from("ai_settings").update({ default_video_provider: "canva" }).eq("tenant_id", tenant)).error).not.toBeNull();
    expect(must(await editor.client.from("ai_settings").update({ default_video_provider: "veo" }).eq("tenant_id", tenant).select())).toHaveLength(0);
    expect(must(await outsider.client.from("ai_settings").update({ default_video_provider: "veo" }).eq("tenant_id", tenant).select())).toHaveLength(0);
    expect(must(await admin.client.from("ai_settings").update({ default_video_provider: "veo" }).eq("tenant_id", tenant).select())).toHaveLength(1);
  });
});

describe("vídeo do Reels", () => {
  it("Veo: legenda na hora, vídeo depois; vira a mídia do post e agenda", async () => {
    const id = await reels();
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    const before = await balance(tenant);
    const pending = fakeAi({ done: false });
    expect((await generatePost(service, tenant, id, { providers: pending.cfg })).status).toBe("generating");
    expect(pending.calls.video).toHaveLength(1);
    expect(pending.calls.video[0].body).toMatchObject({ parameters: { aspectRatio: "9:16" } });
    expect(pending.calls.video[0].auth).toBe("AIza-plataforma");
    // Legenda (1) + vídeo (40)
    expect(await balance(tenant)).toBe(before - 41);
    expect(must(await service.from("posts").select("status, caption").eq("id", id).single())).toMatchObject({ status: "generating", caption: expect.stringContaining("Legenda do Reels.") });
    // Com o vídeo rodando no provedor, ninguém pede de novo
    expect((await editor.client.rpc("begin_generation", { p_post: id })).error?.code).toBe("55P03");

    const running = await pollVideoJobs(service, { providers: pending.cfg });
    expect(running.find((r) => r.postId === id)?.state).toBe("running");

    const done = await pollVideoJobs(service, { providers: fakeAi({ done: true }).cfg });
    expect(done.find((r) => r.postId === id)?.state).toBe("done");
    const post = must(await service.from("posts").select("status, is_ai_generated, media_provider, post_media(kind)").eq("id", id).single());
    expect(post).toMatchObject({ status: "scheduled", is_ai_generated: true, media_provider: "veo", post_media: [{ kind: "video" }] });
    expect(must(await service.from("generation_jobs").select("status").eq("post_id", id).eq("task", "video").single()).status).toBe("succeeded");
    // Já terminou: a rotina não mexe mais nele
    expect((await pollVideoJobs(service, { providers: fakeAi({ done: true }).cfg })).find((r) => r.postId === id)).toBeUndefined();
  });

  it("falha do provedor estorna o vídeo e deixa o post para gerar de novo", async () => {
    const id = await reels();
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    const before = await balance(tenant);
    await generatePost(service, tenant, id, { providers: fakeAi().cfg });
    expect(await balance(tenant)).toBe(before - 41);
    const r = await pollVideoJobs(service, { providers: fakeAi({ error: "cota" }).cfg });
    expect(r.find((x) => x.postId === id)?.state).toBe("failed");
    // A legenda (que deu certo) fica cobrada; o vídeo volta
    expect(await balance(tenant)).toBe(before - 1);
    const post = must(await service.from("posts").select("status, last_error").eq("id", id).single());
    expect(post.status).toBe("generation_failed");
    expect(post.last_error).toMatch(/Veo não conseguiu gerar o vídeo/);
  });

  it("vídeo que passa de 30 minutos é dado como perdido", async () => {
    const id = await reels();
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    const { cfg } = fakeAi();
    await generatePost(service, tenant, id, { providers: cfg });
    const r = await pollVideoJobs(service, { providers: cfg, now: Date.now() + 31 * 60_000 });
    expect(r.find((x) => x.postId === id)).toMatchObject({ state: "failed", error: expect.stringMatching(/30 minutos/) });
    expect(must(await service.from("posts").select("status").eq("id", id).single()).status).toBe("generation_failed");
  });

  it("Higgsfield anima um quadro gerado pela IA de arte", async () => {
    ok(await admin.client.from("ai_settings").update({ default_video_provider: "higgsfield", default_image_provider: "openai_image" }).eq("tenant_id", tenant));
    const id = await reels();
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    const before = await balance(tenant);
    const { cfg, calls } = fakeAi();
    expect((await generatePost(service, tenant, id, { providers: cfg, only: "image" })).status).toBe("generating");
    expect(calls.images).toBe(1);
    expect(calls.video[0].auth).toBe("Key id-plataforma:segredo");
    expect(String(calls.video[0].body?.image_url)).toMatch(/^http.*ai-frame-/);
    // Só o vídeo: quadro (4) + vídeo (40), sem legenda
    expect(calls.chat).toHaveLength(0);
    expect(await balance(tenant)).toBe(before - 44);
    const done = await pollVideoJobs(service, { providers: fakeAi({ done: true }).cfg });
    expect(done.find((r) => r.postId === id)?.state).toBe("done");
    const media = must(await service.from("post_media").select("kind, storage_path").eq("post_id", id));
    expect(media).toHaveLength(1);
    expect(media[0].kind).toBe("video");
    // O quadro temporário sai do Storage
    const { data: files } = await service.storage.from("media").list(`${tenant}/${id}`);
    expect(files?.map((f) => f.name).some((n) => n.startsWith("ai-frame-"))).toBe(false);
  });

  it("vídeo desligado: Reels volta a planejado esperando o vídeo da equipe", async () => {
    ok(await admin.client.from("ai_settings").update({ default_video_provider: "none" }).eq("tenant_id", tenant));
    const id = await reels();
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    const { cfg, calls } = fakeAi();
    expect((await generatePost(service, tenant, id, { providers: cfg })).status).toBe("planned");
    expect(calls.video).toHaveLength(0);
  });
});
