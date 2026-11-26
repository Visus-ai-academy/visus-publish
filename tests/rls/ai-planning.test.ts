import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePost, suggestCadence, suggestThemes } from "@/lib/ai/plan";
import type { ProvidersConfig } from "@/lib/ai/providers";
import { createUser, must, ok, service, slug } from "./helpers";

type User = Awaited<ReturnType<typeof createUser>>;
let admin: User, editor: User, approver: User, outsider: User;
let tenant: string, other: string, direct: string, approval: string, health: string;

const JPEG_B64 = "/9j/4AAQSkZJRgABAQ=="; // só cabeçalho; o teste não decodifica

/** IA simulada: responde temas ou legenda conforme o pedido, e imagens JPEG. */
function fakeAi(opts: { caption?: object; themes?: object; imageStatus?: number } = {}) {
  const calls = { chat: 0, images: 0 };
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/images/generations")) {
      calls.images++;
      if (opts.imageStatus) return new Response("{}", { status: opts.imageStatus });
      return Response.json({ data: [{ b64_json: JPEG_B64 }] });
    }
    calls.chat++;
    const sys = String(body.messages[0].content);
    const themes = sys.includes("calendário editorial") || sys.includes("cadência semanal");
    const reply = themes
      ? (opts.themes ?? { itens: [{ dia: 20, horario: "10:00", formato: "foto", tema: "Dica do mês" }] })
      : (opts.caption ?? { tema: "x", legenda: "Legenda gerada.", hashtags: ["#dica"], riscos: [], slides: [{ titulo: "Um", texto: "a" }, { titulo: "Dois", texto: "b" }, { titulo: "Três", texto: "c" }] });
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  }) as unknown as typeof fetch;
  const cfg: ProvidersConfig = { openai: { baseUrl: "http://fake/v1", fetch: f } };
  return { cfg, calls };
}

const future = (days = 10) => new Date(Date.now() + days * 86_400_000).toISOString();

async function planned(account: string, format: "image" | "carousel" | "reels" | "story", client = editor.client) {
  return must(await client.from("posts").insert({ tenant_id: tenant, ig_account_id: account, scheduled_at: future(), theme: `Tema ${format}`, format, origin: "ai" }).select("id").single()).id;
}

beforeAll(async () => {
  [admin, editor, approver, outsider] = await Promise.all(["aip-admin", "aip-editor", "aip-approver", "aip-out"].map(createUser));
  tenant = must(await service.from("tenants").insert({ slug: slug("aip"), name: "AIP" }).select("id").single()).id;
  other = must(await service.from("tenants").insert({ slug: slug("aip-o"), name: "AIP O" }).select("id").single()).id;
  // Gerações no modo Créditos da Visus precisam de saldo
  ok(await service.rpc("grant_credits", { p_tenant: tenant, p_amount: 1000, p_reason: "teste" }));
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
  const acc = async (u: string, require_approval: boolean) =>
    must(await service.from("ig_accounts").insert({ tenant_id: tenant, ig_user_id: slug(u), username: u, require_approval }).select("id").single()).id;
  [direct, approval, health] = await Promise.all([acc("aip-direto", false), acc("aip-aprova", true), acc("aip-saude", false)]);
  ok(await service.from("brand_profiles").insert({ tenant_id: tenant, ig_account_id: health, is_healthcare: true }));
  ok(await service.rpc("store_platform_ai_key", { p_provider: "openai", p_key: "sk-teste" }));
});

afterAll(async () => {
  await service.rpc("store_platform_ai_key", { p_provider: "openai", p_key: "" });
});

describe("pedir geração", () => {
  it("só admin/editor do cliente pedem; só o sistema termina", async () => {
    const id = await planned(direct, "image");
    expect((await approver.client.rpc("begin_generation", { p_post: id })).error).not.toBeNull();
    expect((await outsider.client.rpc("begin_generation", { p_post: id })).error).not.toBeNull();
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    // Em geração há pouco: não começa de novo
    expect((await admin.client.rpc("begin_generation", { p_post: id })).error?.code).toBe("55P03");
    expect((await editor.client.rpc("finish_generation", { p_post: id })).error).not.toBeNull();
    // Status não muda direto pela API
    expect((await editor.client.from("posts").update({ status: "scheduled" }).eq("id", id)).error).not.toBeNull();
  });
});

describe("gerar legenda e arte", () => {
  it("foto em conta que publica direto: arte salva, selo de IA e agendado", async () => {
    const id = await planned(direct, "image");
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    const { cfg, calls } = fakeAi();
    expect(await generatePost(service, tenant, id, { providers: cfg })).toEqual({ status: "scheduled" });
    expect(calls).toEqual({ chat: 1, images: 1 });
    const post = must(await service.from("posts").select("caption, is_ai_generated, caption_provider, media_provider, post_media(storage_path, kind)").eq("id", id).single());
    expect(post).toMatchObject({ caption: "Legenda gerada.\n\n#dica", is_ai_generated: true, caption_provider: "openai", media_provider: "openai" });
    expect(post.post_media).toHaveLength(1);
    expect(post.post_media[0].storage_path).toMatch(new RegExp(`^${tenant}/${id}/ai-.*\\.jpg$`));
    // A equipe do cliente vê a arte; outro cliente não
    expect((await editor.client.storage.from("media").download(post.post_media[0].storage_path)).error).toBeNull();
    expect((await outsider.client.storage.from("media").download(post.post_media[0].storage_path)).data).toBeNull();
    const events = must(await service.from("post_events").select("from_status, to_status").eq("post_id", id).order("id"));
    expect(events.map((e) => `${e.from_status}>${e.to_status}`)).toEqual(["planned>generating", "generating>scheduled"]);
  });

  it("carrossel gera um slide por item do roteiro e vai para aprovação na conta que pede", async () => {
    const id = await planned(approval, "carousel");
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    const { cfg, calls } = fakeAi();
    expect((await generatePost(service, tenant, id, { providers: cfg })).status).toBe("pending_approval");
    expect(calls.images).toBe(3);
    expect(must(await service.from("post_media").select("position").eq("post_id", id).order("position")).map((m) => m.position)).toEqual([0, 1, 2]);
  });

  it("Reels sai só com legenda e volta a planejado esperando o vídeo", async () => {
    const id = await planned(direct, "reels");
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    const { cfg, calls } = fakeAi();
    expect((await generatePost(service, tenant, id, { providers: cfg })).status).toBe("planned");
    expect(calls.images).toBe(0);
    const post = must(await service.from("posts").select("caption, is_ai_generated").eq("id", id).single());
    expect(post).toMatchObject({ is_ai_generated: false });
    expect(post.caption).toContain("Legenda gerada.");
  });

  it("marca de saúde com risco vai para aprovação mesmo publicando direto", async () => {
    const id = await planned(health, "image");
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    const { cfg } = fakeAi({ caption: { tema: "x", legenda: "Resultado garantido.", riscos: [] } });
    expect((await generatePost(service, tenant, id, { providers: cfg })).status).toBe("pending_approval");
    expect(must(await service.from("posts").select("compliance_flags").eq("id", id).single()).compliance_flags).toEqual(["Promete resultado"]);
  });

  it("falha do provedor vira generation_failed com mensagem e pode gerar de novo, trocando a arte", async () => {
    const id = await planned(direct, "image");
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    const bad = await generatePost(service, tenant, id, { providers: fakeAi({ imageStatus: 429 }).cfg });
    expect(bad.status).toBe("generation_failed");
    expect(bad.error).toMatch(/limite de uso/);
    expect(must(await service.from("posts").select("last_error").eq("id", id).single()).last_error).toMatch(/limite de uso/);

    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    expect((await generatePost(service, tenant, id, { providers: fakeAi().cfg })).status).toBe("scheduled");
    // gerar de novo depois de cancelar troca a mídia em vez de somar
    ok(await editor.client.rpc("transition_post", { p_post: id, p_to: "planned" }));
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    await generatePost(service, tenant, id, { providers: fakeAi().cfg });
    expect(must(await service.from("post_media").select("id").eq("post_id", id))).toHaveLength(1);
  });

  it("não gera post de outro cliente", async () => {
    const id = await planned(direct, "image");
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    await expect(generatePost(service, other, id, { providers: fakeAi().cfg })).rejects.toThrow("Post não encontrado.");
  });
});

describe("gerar de novo só a legenda ou só a arte", () => {
  it("agendado volta a gerar só a legenda com a orientação, mantém a arte e volta para a agenda", async () => {
    const id = await planned(direct, "image");
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    expect(await generatePost(service, tenant, id, { providers: fakeAi().cfg })).toEqual({ status: "scheduled" });
    const before = must(await service.from("post_media").select("storage_path").eq("post_id", id));

    // Aprovadora e outro cliente não pedem; editor pede
    expect((await approver.client.rpc("begin_generation", { p_post: id })).error).not.toBeNull();
    expect((await outsider.client.rpc("begin_generation", { p_post: id })).error).not.toBeNull();
    ok(await editor.client.rpc("begin_generation", { p_post: id, p_note: "nova legenda com IA" }));
    const { cfg, calls } = fakeAi({ caption: { tema: "x", legenda: "Legenda mais curta.", hashtags: [], riscos: [] } });
    expect(await generatePost(service, tenant, id, { providers: cfg, only: "caption", hint: "mais curta" })).toEqual({ status: "scheduled" });
    expect(calls).toEqual({ chat: 1, images: 0 });
    const post = must(await service.from("posts").select("caption, is_ai_generated").eq("id", id).single());
    expect(post).toEqual({ caption: "Legenda mais curta.", is_ai_generated: true });
    expect(must(await service.from("post_media").select("storage_path").eq("post_id", id))).toEqual(before);
  });

  it("aguardando aprovação gera só a arte nova e volta para aprovação", async () => {
    const id = await planned(approval, "image");
    ok(await editor.client.rpc("begin_generation", { p_post: id }));
    expect(await generatePost(service, tenant, id, { providers: fakeAi().cfg })).toEqual({ status: "pending_approval" });
    const caption = must(await service.from("posts").select("caption").eq("id", id).single()).caption;
    const before = must(await service.from("post_media").select("storage_path").eq("post_id", id));

    ok(await editor.client.rpc("begin_generation", { p_post: id, p_note: "nova arte com IA" }));
    const { cfg, calls } = fakeAi();
    expect(await generatePost(service, tenant, id, { providers: cfg, only: "image", hint: "fundo claro" })).toEqual({ status: "pending_approval" });
    expect(calls).toEqual({ chat: 0, images: 1 });
    expect(must(await service.from("posts").select("caption").eq("id", id).single()).caption).toBe(caption);
    const after = must(await service.from("post_media").select("storage_path").eq("post_id", id));
    expect(after).toHaveLength(1);
    expect(after[0].storage_path).not.toBe(before[0].storage_path);
  });

  it("post enviado pela equipe não volta a ser gerado", async () => {
    const id = must(await editor.client.from("posts").insert({ tenant_id: tenant, ig_account_id: direct, scheduled_at: future(), theme: "Upload", format: "image", origin: "upload" }).select("id").single()).id;
    must(await service.from("posts").update({ status: "pending_approval" }).eq("id", id).select("id"));
    expect((await editor.client.rpc("begin_generation", { p_post: id })).error?.code).toBe("22023");
  });
});

describe("sugerir temas", () => {
  it("dá um tema por vaga da cadência e não aceita conta de outro", async () => {
    const { cfg } = fakeAi({ themes: { temas: [{ vaga: 1, tema: "Dica A" }, { vaga: 2, tema: "Bastidores" }] } });
    const slots = [
      { date: "2026-12-07", day: 7, time: "18:00", format: "image" as const },
      { date: "2026-12-09", day: 9, time: "12:00", format: "reels" as const },
    ];
    const input = { accountId: direct, monthLabel: "dezembro de 2026", slots, existing: [] };
    const items = await suggestThemes(service, tenant, input, { providers: cfg });
    expect(items.map((i) => `${i.date} ${i.format} ${i.theme}`)).toEqual(["2026-12-07 image Dica A", "2026-12-09 reels Bastidores"]);
    await expect(suggestThemes(service, other, input, { providers: cfg })).rejects.toThrow("Conta não encontrada.");
  });

  it("propõe cadência pelo nicho sem salvar", async () => {
    const { cfg } = fakeAi({ themes: { vagas: [{ dia: "seg", horario: "18:00", formato: "foto" }], motivo: "ok" } });
    const r = await suggestCadence(service, tenant, { accountId: direct, niche: "Odontologia estética" }, { providers: cfg });
    expect(r).toEqual({ slots: [{ weekday: 1, time: "18:00", format: "image" }], reason: "ok" });
    expect(must(await service.from("posting_cadences").select("ig_account_id").eq("ig_account_id", direct))).toHaveLength(0);
    await expect(suggestCadence(service, other, { accountId: direct, niche: "x x x" }, { providers: cfg })).rejects.toThrow("Conta não encontrada.");
  });
});

describe("cadência: isolamento e papéis", () => {
  const slots = [{ weekday: 1, time: "18:00", format: "image" }];
  it("editor do cliente grava; aprovador só lê; outro cliente não vê nem grava", async () => {
    ok(await editor.client.from("posting_cadences").upsert({ tenant_id: tenant, ig_account_id: approval, slots, niche: "Clínica" }));
    expect(must(await approver.client.from("posting_cadences").select("niche").eq("ig_account_id", approval))).toEqual([{ niche: "Clínica" }]);
    await approver.client.from("posting_cadences").update({ niche: "mudou" }).eq("ig_account_id", approval);
    expect(must(await outsider.client.from("posting_cadences").select("niche").eq("ig_account_id", approval))).toHaveLength(0);
    await outsider.client.from("posting_cadences").update({ niche: "invadiu" }).eq("ig_account_id", approval);
    expect(must(await service.from("posting_cadences").select("niche").eq("ig_account_id", approval).single()).niche).toBe("Clínica");
    // Outro cliente não cria cadência apontando para conta deste
    expect((await outsider.client.from("posting_cadences").insert({ tenant_id: other, ig_account_id: health, slots })).error).not.toBeNull();
    // Lista inválida é recusada pelo banco
    expect((await service.from("posting_cadences").upsert({ tenant_id: tenant, ig_account_id: health, slots: { a: 1 } })).error).not.toBeNull();
  });
});
