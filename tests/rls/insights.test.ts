import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProvidersConfig } from "@/lib/ai/providers";
import { runAnalysis } from "@/lib/insights/analysis";
import { collectAccount, type InsightsPort } from "@/lib/insights/collect";
import { MetaApiError } from "@/lib/meta/client";
import type { Json } from "@/lib/supabase/database.types";
import { createUser, must, ok, service, slug } from "./helpers";

type User = Awaited<ReturnType<typeof createUser>>;
let admin: User, editor: User, approver: User, viewer: User, outsider: User;
let tenant: string, other: string, acc: string, otherAcc: string;
const TZ = "America/Sao_Paulo";
const H = 3_600_000;
const D = 24 * H;

/** "dias a partir de hoje, hora local de São Paulo" → ISO. */
function at(days: number, hour: number) {
  const d = new Date(Date.now() + days * D);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00-03:00`).toISOString();
}

async function post(over: Record<string, unknown> = {}, tenantId = tenant, accountId = acc) {
  return must(
    await service
      .from("posts")
      .insert({ tenant_id: tenantId, ig_account_id: accountId, scheduled_at: at(5, 12), theme: "Tema", format: "image", ...over })
      .select("id")
      .single(),
  ).id;
}

async function finding(action: Json, tenantId = tenant, accountId = acc) {
  return must(
    await service
      .from("analysis_findings")
      .insert({ tenant_id: tenantId, ig_account_id: accountId, period_start: "2026-01-01", period_end: "2026-01-31", title: "Teste", body: "Corpo", action })
      .select("id")
      .single(),
  ).id;
}

beforeAll(async () => {
  [admin, editor, approver, viewer, outsider] = await Promise.all(["ins-admin", "ins-editor", "ins-approver", "ins-viewer", "ins-out"].map(createUser));
  tenant = must(await service.from("tenants").insert({ slug: slug("ins"), name: "INS", timezone: TZ }).select("id").single()).id;
  other = must(await service.from("tenants").insert({ slug: slug("ins-o"), name: "INS O" }).select("id").single()).id;
  ok(
    await service.from("memberships").insert([
      { tenant_id: tenant, user_id: admin.id, role: "admin" },
      { tenant_id: tenant, user_id: editor.id, role: "editor" },
      { tenant_id: tenant, user_id: approver.id, role: "approver" },
      { tenant_id: tenant, user_id: viewer.id, role: "viewer" },
      { tenant_id: other, user_id: outsider.id, role: "admin" },
    ]),
  );
  acc = must(await service.from("ig_accounts").insert({ tenant_id: tenant, ig_user_id: slug("ins-ig"), username: "ins.conta" }).select("id").single()).id;
  otherAcc = must(await service.from("ig_accounts").insert({ tenant_id: other, ig_user_id: slug("ins-ig-o"), username: "ins.outra" }).select("id").single()).id;
  ok(await service.rpc("store_ig_token", { p_account: acc, p_token: "tok-ins", p_expires_at: new Date(Date.now() + 50 * D).toISOString() }));
});

afterAll(async () => {
  await service.rpc("store_platform_ai_key", { p_provider: "openai", p_key: "" });
});

describe("isolamento das métricas", () => {
  it("membro lê as mídias e achados do próprio cliente e não vê os de outro; ninguém grava pela API", async () => {
    ok(await service.from("ig_media").insert({ tenant_id: other, ig_account_id: otherAcc, ig_media_id: "m-outro", posted_at: new Date().toISOString(), reach: 10 }));
    ok(await service.from("ig_media").insert({ tenant_id: tenant, ig_account_id: acc, ig_media_id: "m-meu", posted_at: new Date().toISOString(), reach: 10 }));
    await finding({ type: "none", params: {} }, other, otherAcc);
    const mine = must(await viewer.client.from("ig_media").select("ig_media_id"));
    expect(mine.map((m) => m.ig_media_id)).toEqual(["m-meu"]);
    expect(must(await viewer.client.from("analysis_findings").select("tenant_id")).every((f) => f.tenant_id === tenant)).toBe(true);
    expect(must(await outsider.client.from("ig_media").select("ig_media_id")).map((m) => m.ig_media_id)).toEqual(["m-outro"]);

    const ins = await admin.client.from("ig_media").insert({ tenant_id: tenant, ig_account_id: acc, ig_media_id: "x", posted_at: new Date().toISOString() });
    expect(ins.error).not.toBeNull();
    const upd = await admin.client.from("ig_media").update({ reach: 999 }).eq("ig_media_id", "m-meu").select();
    expect(upd.data ?? []).toHaveLength(0);
    const fi = await admin.client.from("analysis_findings").insert({ tenant_id: tenant, ig_account_id: acc, period_start: "2026-01-01", period_end: "2026-01-31", title: "x", body: "y" });
    expect(fi.error).not.toBeNull();
  });

  it("mídia não aponta para conta ou post de outro cliente", async () => {
    const r = await service.from("ig_media").insert({ tenant_id: tenant, ig_account_id: otherAcc, ig_media_id: "cruzada", posted_at: new Date().toISOString() });
    expect(r.error).not.toBeNull();
    const p = await post({}, other, otherAcc);
    const r2 = await service.from("ig_media").insert({ tenant_id: tenant, ig_account_id: acc, ig_media_id: "cruzada-2", post_id: p, posted_at: new Date().toISOString() });
    expect(r2.error).not.toBeNull();
  });

  it("estado da coleta da conta não muda pela API", async () => {
    const r = await admin.client.from("ig_accounts").update({ insights_error: null, insights_checked_at: new Date().toISOString() }).eq("id", acc);
    expect(r.error?.code).toBe("42501");
  });
});

describe("aplicar achado", () => {
  it("mover horário: só admin e editor do cliente; muda posts futuros não publicados e registra o evento", async () => {
    const p12 = await post({ scheduled_at: at(3, 12), status: "planned" });
    const p12b = await post({ scheduled_at: at(4, 12), status: "scheduled" });
    const p10 = await post({ scheduled_at: at(3, 10), status: "planned" });
    const pub = await post({ scheduled_at: at(-2, 12), status: "published" });
    const f = await finding({ type: "reschedule", params: { from_hour: 12, to_hour: 18 } });

    expect((await outsider.client.rpc("apply_finding", { p_finding: f })).error?.code).toBe("42501");
    expect((await approver.client.rpc("apply_finding", { p_finding: f })).error?.code).toBe("42501");
    expect((await viewer.client.rpc("apply_finding", { p_finding: f })).error?.code).toBe("42501");

    const n = must(await editor.client.rpc("apply_finding", { p_finding: f }));
    expect(n).toBe(2);
    const rows = must(await service.from("posts").select("id, scheduled_at, status").in("id", [p12, p12b, p10, pub]));
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(new Date(by.get(p12)!.scheduled_at).toISOString()).toBe(at(3, 18));
    expect(new Date(by.get(p12b)!.scheduled_at).toISOString()).toBe(at(4, 18));
    expect(by.get(p12b)!.status).toBe("scheduled");
    expect(new Date(by.get(p10)!.scheduled_at).toISOString()).toBe(at(3, 10));
    expect(new Date(by.get(pub)!.scheduled_at).toISOString()).toBe(at(-2, 12));

    const ev = must(await service.from("post_events").select("note, actor").eq("post_id", p12));
    expect(ev.at(-1)).toMatchObject({ actor: editor.id, note: expect.stringContaining("12:00 para 18:00") });
    const fr = must(await service.from("analysis_findings").select("applied_at, applied_by, applied_count").eq("id", f).single());
    expect(fr).toMatchObject({ applied_by: editor.id, applied_count: 2 });

    // Não aplica duas vezes
    expect((await editor.client.rpc("apply_finding", { p_finding: f })).error?.code).toBe("VP409");
  });

  it("trocar formato: só posts planejados ainda sem arte", async () => {
    const acc2 = must(await service.from("ig_accounts").insert({ tenant_id: tenant, ig_user_id: slug("ins-ig2"), username: "ins.dois" }).select("id").single()).id;
    const post2 = (over: Record<string, unknown>) => post(over, tenant, acc2);
    const a = await post2({ scheduled_at: at(6, 9), status: "planned", format: "image", theme: "sem arte" });
    const b = await post2({ scheduled_at: at(6, 10), status: "planned", format: "image", theme: "com arte" });
    ok(await service.from("post_media").insert({ tenant_id: tenant, post_id: b, kind: "image", storage_path: `${tenant}/${b}/0.jpg` }));
    const c = await post2({ scheduled_at: at(6, 11), status: "scheduled", format: "image" });
    const f = await finding({ type: "change_format", params: { from: "image", to: "reels" } }, tenant, acc2);
    expect(must(await admin.client.rpc("apply_finding", { p_finding: f }))).toBe(1);
    const rows = must(await service.from("posts").select("id, format").in("id", [a, b, c]));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.format]))).toEqual({ [a]: "reels", [b]: "image", [c]: "image" });
  });

  it("achado de outro cliente ou sem ação não aplica", async () => {
    const fo = await finding({ type: "reschedule", params: { from_hour: 12, to_hour: 18 } }, other, otherAcc);
    expect((await admin.client.rpc("apply_finding", { p_finding: fo })).error?.code).toBe("42501");
    const fn = await finding({ type: "none", params: {} });
    expect((await admin.client.rpc("apply_finding", { p_finding: fn })).error?.code).toBe("VP409");
  });
});

/** Meta simulada: mídias, métricas por mídia, dia da conta e público. */
function fakePort(media: Array<{ id: string; timestamp: string; caption?: string; media_type?: string; media_product_type?: string }>, opts: { failToken?: boolean } = {}) {
  const calls = { insights: 0, day: 0, aud: 0 };
  const port: InsightsPort = {
    async listMedia() {
      if (opts.failToken) throw new MetaApiError("Error validating access token", 400, 190);
      return media;
    },
    async mediaInsights(_t, id) {
      calls.insights++;
      const n = Number(id.replace(/\D/g, "")) || 1;
      return { reach: 100 * n, likes: 10 * n, comments: n, saved: n, shares: n, views: 150 * n, profile_visits: n };
    },
    async accountDay() {
      calls.day++;
      return { reach: 500, views: 800, profile_views: 20, follower_count: 1234 };
    },
    async followerDemographics() {
      calls.aud++;
      return { age: { "25-34": 40, "35-44": 60 }, gender: { F: 70, M: 30 }, cities: { "Curitiba, Paraná": 50 } };
    },
  };
  return { port, calls };
}

describe("coleta das métricas", () => {
  it("guarda mídias e métricas, casa o post do Metricool pela legenda, tira a foto do post e lê conta e público", async () => {
    ok(await service.from("ig_media").delete().eq("ig_account_id", acc));
    const publishedAt = new Date(Date.now() - 2 * D);
    const p = await post({ scheduled_at: publishedAt.toISOString(), status: "published", published_at: publishedAt.toISOString(), caption: "Mitos sobre clareamento dental que você precisa conhecer", theme: "Mitos" });
    const { port, calls } = fakePort([
      { id: "ig1", timestamp: new Date(publishedAt.getTime() + 3 * 60_000).toISOString(), caption: "Mitos sobre clareamento dental que você precisa conhecer\n#dica", media_type: "IMAGE", media_product_type: "FEED" },
      { id: "ig2", timestamp: new Date(Date.now() - 20 * D).toISOString(), caption: "Post antigo, feito fora do app", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED" },
    ]);
    const r = await collectAccount(service, port, tenant, acc);
    expect(r).toMatchObject({ ok: true, media: 2, matched: 1, read: 2 });
    const pr = must(await service.from("posts").select("ig_media_id").eq("id", p).single());
    expect(pr.ig_media_id).toBe("ig1");
    const m = must(await service.from("ig_media").select("ig_media_id, post_id, reach, likes").eq("ig_account_id", acc).in("ig_media_id", ["ig1", "ig2"]).order("ig_media_id"));
    expect(m).toEqual([
      { ig_media_id: "ig1", post_id: p, reach: 100, likes: 10 },
      { ig_media_id: "ig2", post_id: null, reach: 200, likes: 20 },
    ]);
    expect(must(await service.from("media_insights").select("snapshot, reach").eq("post_id", p))).toEqual([{ snapshot: "24h", reach: 100 }]);
    expect(must(await service.from("account_insights_daily").select("follower_count").eq("ig_account_id", acc))).toEqual([{ follower_count: 1234 }]);
    expect(must(await service.from("audience_snapshots").select("age").eq("ig_account_id", acc))).toHaveLength(1);
    const a = must(await service.from("ig_accounts").select("insights_checked_at, insights_error").eq("id", acc).single());
    expect(a.insights_error).toBeNull();
    expect(a.insights_checked_at).not.toBeNull();

    // Logo em seguida: nada a reler, dia e público já lidos
    const again = await collectAccount(service, port, tenant, acc);
    expect(again.read).toBe(0);
    expect(calls).toMatchObject({ day: 1, aud: 1 });
  });

  it("token recusado vira aviso na conta, sem mudar o status de publicação", async () => {
    const { port } = fakePort([], { failToken: true });
    const r = await collectAccount(service, port, tenant, acc);
    expect(r.ok).toBe(false);
    const a = must(await service.from("ig_accounts").select("status, insights_error").eq("id", acc).single());
    expect(a.status).toBe("connected");
    expect(a.insights_error).toMatch(/Conecte a conta de novo pela Meta/);
  });

  it("não coleta conta de outro cliente pelo id", async () => {
    const { port, calls } = fakePort([]);
    const r = await collectAccount(service, port, tenant, otherAcc);
    expect(r).toMatchObject({ ok: false, error: "Conta não encontrada." });
    expect(calls.insights).toBe(0);
  });
});

describe("análise com IA", () => {
  it("gera achados a partir dos agregados, debita créditos e troca os pendentes", async () => {
    ok(await service.from("ai_settings").upsert({ tenant_id: tenant, default_caption_provider: "openai" }, { onConflict: "tenant_id" }));
    ok(await service.rpc("store_platform_ai_key", { p_provider: "openai", p_key: "sk-teste-ins" }));
    ok(await service.rpc("grant_credits", { p_tenant: tenant, p_amount: 100, p_reason: "teste" }));
    for (let i = 0; i < 5; i++) {
      ok(await service.from("ig_media").insert({ tenant_id: tenant, ig_account_id: acc, ig_media_id: `an-${i}`, posted_at: new Date(Date.now() - (i + 3) * D).toISOString(), reach: 100, likes: 5 + i, insights_at: new Date().toISOString() }));
    }
    let prompt = "";
    const f = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      prompt = JSON.stringify(body.messages);
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ achados: [{ titulo: "Terça às 18h rende mais", texto: "Mais engajamento.", evidencia: {}, acao: { tipo: "mover_horario", de_hora: 12, para_hora: 18 } }] }) } }],
      });
    }) as unknown as typeof fetch;
    const providers: ProvidersConfig = { openai: { baseUrl: "http://fake/v1", fetch: f } };
    const before = Number(must(await service.rpc("credit_balance", { p_tenant: tenant })));
    const out = await runAnalysis(service, tenant, acc, { providers });
    expect(out[0].action).toEqual({ type: "reschedule", params: { from_hour: 12, to_hour: 18 } });
    expect(prompt).toContain("mapa_de_calor");
    expect(prompt).not.toContain("tok-ins");
    const pending = must(await service.from("analysis_findings").select("title").eq("ig_account_id", acc).is("applied_at", null));
    expect(pending.map((x) => x.title)).toEqual(["Terça às 18h rende mais"]);
    expect(Number(must(await service.rpc("credit_balance", { p_tenant: tenant })))).toBeLessThanOrEqual(before);
  });
});
