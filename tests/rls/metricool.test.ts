import { beforeAll, describe, expect, it } from "vitest";
import { connectAccount, linkMetricoolAccount } from "@/lib/meta/accounts";
import { MetricoolApiError, type MetricoolPostStatus, type ScheduleInput } from "@/lib/metricool/client";
import type { MetricoolAuth, MetricoolPort } from "@/lib/metricool/port";
import type { MetaPort } from "@/lib/meta/port";
import { publishDue } from "@/lib/publishing/publisher";
import { createUser, must, ok, service, slug } from "./helpers";

type User = Awaited<ReturnType<typeof createUser>>;

const noMeta: MetaPort = new Proxy({} as MetaPort, {
  get: () => async () => {
    throw new Error("Meta não deveria ser chamada");
  },
});

function fakeMetricool(status: () => MetricoolPostStatus = () => ({ status: "PENDING", publicUrl: null, detail: null }), over: Partial<MetricoolPort> = {}) {
  const scheduled: Array<{ creds: MetricoolAuth; input: ScheduleInput }> = [];
  const deleted: string[] = [];
  let n = 0;
  const port: MetricoolPort = {
    normalizeMedia: async (_c, _b, url) => `https://cdn.metricool.test/copia-${encodeURIComponent(url).length}.jpg`,
    schedulePost: async (creds, input) => (scheduled.push({ creds, input }), `mc-${++n}-${Date.now()}`),
    getPostStatus: async () => status(),
    deletePost: async (_c, _b, id) => void deleted.push(id),
    ...over,
  };
  return { port, scheduled, deleted };
}

let admin: User, editor: User;
let tenantA: string, tenantB: string;
let accA: string, accB: string;

async function clearQueue() {
  await service.from("posts").update({ status: "planned" }).in("status", ["scheduled", "publishing"]);
}

async function duePost(opts: { tenant?: string; account?: string; format?: "image" | "carousel" | "reels" | "story"; files?: number; video?: boolean } = {}) {
  const tenant = opts.tenant ?? tenantA;
  const post = must(
    await service
      .from("posts")
      .insert({
        tenant_id: tenant,
        ig_account_id: opts.account ?? accA,
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
        theme: "Via Metricool",
        format: opts.format ?? "image",
        caption: "Legenda Metricool",
        status: "scheduled",
      })
      .select("*")
      .single(),
  );
  for (let i = 0; i < (opts.files ?? 1); i++) {
    const path = `${tenant}/${post.id}/${i}.${opts.video ? "mp4" : "jpg"}`;
    must(await service.storage.from("media").upload(path, new Blob(["x"]), { upsert: true }));
    must(await service.from("post_media").insert({ tenant_id: tenant, post_id: post.id, position: i, kind: opts.video ? "video" : "image", storage_path: path }).select());
  }
  return post;
}

async function row(id: string) {
  return must(await service.from("posts").select("status, external_post_id, publish_provider, permalink, last_error, attempts").eq("id", id).single());
}

async function makeCheckable(id: string) {
  await service.from("posts").update({ last_checked_at: new Date(Date.now() - 5 * 60_000).toISOString() }).eq("id", id);
}

beforeAll(async () => {
  [admin, editor] = await Promise.all([createUser("mc-admin"), createUser("mc-editor")]);
  tenantA = must(await service.from("tenants").insert({ slug: slug("mc-a"), name: "MC A" }).select("id").single()).id;
  tenantB = must(await service.from("tenants").insert({ slug: slug("mc-b"), name: "MC B" }).select("id").single()).id;
  must(
    await service
      .from("memberships")
      .insert([
        { tenant_id: tenantA, user_id: admin.id, role: "admin" },
        { tenant_id: tenantA, user_id: editor.id, role: "editor" },
      ])
      .select(),
  );
  ok(await service.rpc("store_metricool_token", { p_tenant: tenantA, p_user_id: "111", p_token: "mc-token-a" }));
  ok(await service.rpc("store_metricool_token", { p_tenant: tenantB, p_user_id: "222", p_token: "mc-token-b" }));
  const a = await linkMetricoolAccount(service, { tenantId: tenantA, userId: admin.id, blogId: slug("blog-a"), username: "@clinica_mc", requireApproval: false });
  const b = await linkMetricoolAccount(service, { tenantId: tenantB, userId: admin.id, blogId: slug("blog-b"), username: "outra_mc", requireApproval: false });
  if (!a.ok || !b.ok) throw new Error("vínculo falhou");
  accA = a.accountId;
  accB = b.accountId;
});

describe("conexão com o Metricool", () => {
  it("token só no Vault: servidor lê, admin só vê que existe, editor nem isso", async () => {
    const creds = must(await service.rpc("read_metricool_credentials", { p_tenant: tenantA }));
    expect(creds).toEqual([{ auth_mode: "api_token", user_id: "111", token: "mc-token-a", refresh_token: null, client_id: null, client_secret: null, expires_at: null }]);
    expect((await admin.client.rpc("read_metricool_credentials", { p_tenant: tenantA })).error).not.toBeNull();

    const seen = must(await admin.client.from("metricool_connections").select("*").eq("tenant_id", tenantA));
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain("mc-token-a");
    expect(must(await editor.client.from("metricool_connections").select("*"))).toEqual([]);
    expect(must(await admin.client.from("metricool_connections").select("*").eq("tenant_id", tenantB))).toEqual([]);
    expect((await admin.client.from("metricool_connections").insert({ tenant_id: tenantA, metricool_user_id: "x" })).error).not.toBeNull();
  });

  it("a mesma marca não entra em dois clientes; admin não troca o provedor pela API", async () => {
    const blog = must(await service.from("ig_accounts").select("metricool_blog_id").eq("id", accA).single()).metricool_blog_id!;
    expect(await linkMetricoolAccount(service, { tenantId: tenantB, userId: admin.id, blogId: blog, username: "x" })).toEqual({ ok: false, reason: "other_tenant" });
    const r = await admin.client.from("ig_accounts").update({ publish_via: "meta" }).eq("id", accA);
    expect(r.error?.message).toMatch(/require_approval/);
  });
});

describe("publicação pelo Metricool", () => {
  it("entrega ao Metricool no fuso do cliente e confirma quando publica", async () => {
    await clearQueue();
    const p = await duePost();
    let status: MetricoolPostStatus = { status: "PENDING", publicUrl: null, detail: null };
    const mc = fakeMetricool(() => status);

    const [r] = await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    expect(r).toMatchObject({ postId: p.id, outcome: "sent" });
    const s1 = await row(p.id);
    expect(s1).toMatchObject({ status: "publishing", publish_provider: "metricool" });
    expect(s1.external_post_id).toMatch(/^mc-/);

    const { creds, input } = mc.scheduled[0];
    expect(creds).toEqual({ userId: "111", token: "mc-token-a" });
    expect(input).toMatchObject({ type: "POST", text: "Legenda Metricool", timezone: "America/Sao_Paulo" });
    expect(input.media[0]).toMatch(/^https:\/\/cdn\.metricool\.test\//);
    const local = new Date(`${input.dateTime}-03:00`).getTime();
    expect(local).toBeGreaterThan(Date.now());
    expect(local).toBeLessThan(Date.now() + 4 * 60_000);

    // Ainda pendente: nada muda
    await makeCheckable(p.id);
    expect(await publishDue({ db: service, meta: noMeta, metricool: mc.port })).toEqual([]);
    expect((await row(p.id)).status).toBe("publishing");

    status = { status: "PUBLISHED", publicUrl: "https://www.instagram.com/p/abc/", detail: null };
    await makeCheckable(p.id);
    const done = await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    expect(done).toEqual([{ postId: p.id, tenantId: tenantA, outcome: "published" }]);
    expect(await row(p.id)).toMatchObject({ status: "published", permalink: "https://www.instagram.com/p/abc/" });
    expect(mc.scheduled).toHaveLength(1);
  });

  it("erro no Metricool vira falha com o motivo", async () => {
    await clearQueue();
    const p = await duePost();
    const mc = fakeMetricool(() => ({ status: "ERROR", publicUrl: null, detail: "Media aspect ratio not supported" }));
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    await makeCheckable(p.id);
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    const s = await row(p.id);
    expect(s.status).toBe("failed");
    expect(s.last_error).toMatch(/aspect ratio/);
  });

  it("tentar de novo não duplica: reaproveita se o anterior ainda vai sair, recria se deu erro", async () => {
    await clearQueue();
    const p = await duePost();
    let status: MetricoolPostStatus = { status: "PENDING", publicUrl: null, detail: null };
    const mc = fakeMetricool(() => status);
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    const first = (await row(p.id)).external_post_id!;

    // Simula a desistência por tempo e o "Tentar de novo" do usuário
    await service.from("posts").update({ status: "failed" }).eq("id", p.id);
    must(await admin.client.rpc("transition_post", { p_post: p.id, p_to: "scheduled" }));
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    expect(mc.scheduled).toHaveLength(1);
    expect((await row(p.id)).external_post_id).toBe(first);

    status = { status: "ERROR", publicUrl: null, detail: "x" };
    await service.from("posts").update({ status: "failed" }).eq("id", p.id);
    must(await admin.client.rpc("transition_post", { p_post: p.id, p_to: "scheduled" }));
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    expect(mc.deleted).toEqual([first]);
    expect(mc.scheduled).toHaveLength(2);
    expect((await row(p.id)).external_post_id).not.toBe(first);
  });

  it("Reels e Stories usam o tipo certo; Stories sem legenda", async () => {
    await clearQueue();
    await duePost({ format: "reels", video: true });
    await duePost({ format: "story" });
    const mc = fakeMetricool();
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    const types = mc.scheduled.map((s) => [s.input.type, s.input.text]).sort();
    expect(types).toEqual([
      ["REEL", "Legenda Metricool"],
      ["STORY", ""],
    ]);
  });

  it("se o normalize falhar, manda a URL assinada para o Metricool copiar", async () => {
    await clearQueue();
    await duePost({ format: "carousel", files: 2 });
    const mc = fakeMetricool(undefined, {
      normalizeMedia: async () => {
        throw new MetricoolApiError("formato", 400, false);
      },
    });
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    expect(mc.scheduled[0].input.media).toHaveLength(2);
    expect(mc.scheduled[0].input.media[0]).toMatch(/token=/);
  });

  it("token recusado falha com mensagem clara; erro temporário tenta de novo", async () => {
    await clearQueue();
    const p = await duePost();
    const denied = fakeMetricool(undefined, {
      schedulePost: async () => {
        throw new MetricoolApiError("O Metricool recusou o acesso. Confira o token e o userId, e se o plano inclui API.", 401, false);
      },
    });
    await publishDue({ db: service, meta: noMeta, metricool: denied.port });
    expect(await row(p.id)).toMatchObject({ status: "failed", last_error: expect.stringMatching(/plano inclui API/) });

    const q = await duePost();
    const flaky = fakeMetricool(undefined, {
      schedulePost: async () => {
        throw new MetricoolApiError("Erro 503 do Metricool.", 503, true);
      },
    });
    const [r] = await publishDue({ db: service, meta: noMeta, metricool: flaky.port });
    expect(r.outcome).toBe("retry");
    expect((await row(q.id)).status).toBe("scheduled");
  });

  it("cliente sem Metricool conectado: falha pedindo a conexão", async () => {
    await clearQueue();
    const t = must(await service.from("tenants").insert({ slug: slug("mc-sem"), name: "Sem MC" }).select("id").single());
    const acc = await linkMetricoolAccount(service, { tenantId: t.id, userId: admin.id, blogId: slug("blog-sem"), username: "sem" });
    if (!acc.ok) throw new Error("falhou");
    const p = await duePost({ tenant: t.id, account: acc.accountId });
    await publishDue({ db: service, meta: noMeta, metricool: fakeMetricool().port });
    expect((await row(p.id)).last_error).toMatch(/Conecte o Metricool/);
  });

  it("cada cliente publica com o próprio token", async () => {
    await clearQueue();
    await duePost();
    await duePost({ tenant: tenantB, account: accB });
    const mc = fakeMetricool();
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    expect(mc.scheduled.map((s) => ("token" in s.creds ? s.creds.token : s.creds.accessToken)).sort()).toEqual(["mc-token-a", "mc-token-b"]);
  });

  it("espera até 3 h pela confirmação antes de desistir", async () => {
    await clearQueue();
    const p = await duePost();
    const mc = fakeMetricool(undefined, {
      getPostStatus: async () => {
        throw new MetricoolApiError("fora do ar", 503, true);
      },
    });
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    await service.from("posts").update({ publishing_started_at: new Date(Date.now() - 60 * 60_000).toISOString() }).eq("id", p.id);
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    expect((await row(p.id)).status).toBe("publishing");

    await service.from("posts").update({ publishing_started_at: new Date(Date.now() - 4 * 60 * 60_000).toISOString() }).eq("id", p.id);
    await publishDue({ db: service, meta: noMeta, metricool: mc.port });
    expect(await row(p.id)).toMatchObject({ status: "failed", last_error: expect.stringMatching(/Confira no Metricool/) });
  });
});

describe("troca para a Meta", () => {
  it("conectar pela Meta a mesma conta liga a leitura das métricas e continua publicando pelo Metricool; o admin troca depois", async () => {
    const link = await linkMetricoolAccount(service, { tenantId: tenantA, userId: admin.id, blogId: slug("blog-troca"), username: "Troca.Clinica" });
    if (!link.ok) throw new Error("falhou");
    const igId = slug("ig-real");
    const r = await connectAccount(service, {
      tenantId: tenantA,
      userId: admin.id,
      profile: { user_id: igId, username: "troca.clinica" },
      token: "meta-token",
      expiresInSeconds: 5_184_000,
    });
    expect(r).toEqual({ ok: true, accountId: link.accountId });
    const acc = must(await service.from("ig_accounts").select("ig_user_id, publish_via, metricool_blog_id").eq("id", link.accountId).single());
    expect(acc).toMatchObject({ ig_user_id: igId, publish_via: "metricool" });
    expect(acc.metricool_blog_id).toBeTruthy();
    expect(must(await service.rpc("read_ig_token", { p_account: link.accountId }))).toBe("meta-token");

    // Só o admin do cliente troca o provedor, e pela função
    const outsider = await createUser("mc-out");
    ok(await service.from("memberships").insert({ tenant_id: tenantB, user_id: outsider.id, role: "admin" }));
    expect((await outsider.client.rpc("set_publish_via", { p_account: link.accountId, p_via: "meta" })).error?.code).toBe("42501");
    expect((await editor.client.rpc("set_publish_via", { p_account: link.accountId, p_via: "meta" })).error?.code).toBe("42501");
    ok(await admin.client.rpc("set_publish_via", { p_account: link.accountId, p_via: "meta" }));
    expect(must(await service.from("ig_accounts").select("publish_via").eq("id", link.accountId).single()).publish_via).toBe("meta");
    ok(await admin.client.rpc("set_publish_via", { p_account: link.accountId, p_via: "metricool" }));
  });

  it("não troca para a Meta sem o acesso da Meta", async () => {
    const link = await linkMetricoolAccount(service, { tenantId: tenantA, userId: admin.id, blogId: slug("blog-sem-meta"), username: "sem.meta" });
    if (!link.ok) throw new Error("falhou");
    expect((await admin.client.rpc("set_publish_via", { p_account: link.accountId, p_via: "meta" })).error?.code).toBe("VP409");
  });
});
