import { beforeAll, describe, expect, it } from "vitest";
import { MetaApiError, type ContainerInput } from "@/lib/meta/client";
import type { MetaPort } from "@/lib/meta/port";
import { publishDue } from "@/lib/publishing/publisher";
import { createUser, must, ok, service, slug } from "./helpers";

type User = Awaited<ReturnType<typeof createUser>>;

/** Meta simulada que registra cada chamada. */
function fakeMeta(over: Partial<MetaPort> = {}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  let n = 0;
  const port: MetaPort = {
    publishingLimit: async (...a) => (calls.push({ fn: "limit", args: a }), { used: 0, total: 100 }),
    createContainer: async (...a: [string, string, ContainerInput]) => (calls.push({ fn: "container", args: a }), `c${++n}`),
    containerStatus: async (...a) => (calls.push({ fn: "status", args: a }), { status_code: "FINISHED" }),
    publishContainer: async (...a) => (calls.push({ fn: "publish", args: a }), `m${++n}`),
    getPermalink: async (_t, id) => `https://instagram.com/p/${id}`,
    ...over,
  };
  return { port, calls };
}

let admin: User, editor: User;
let tenantId: string, otherTenantId: string;
let accountId: string, approvalAccountId: string, otherAccountId: string;

async function duePost(opts: { tenant?: string; account?: string; format?: "image" | "carousel" | "reels" | "story"; files?: number; video?: boolean; ai?: boolean } = {}) {
  const tenant = opts.tenant ?? tenantId;
  const account = opts.account ?? accountId;
  const post = must(
    await service
      .from("posts")
      .insert({
        tenant_id: tenant,
        ig_account_id: account,
        scheduled_at: new Date(Date.now() - 60_000).toISOString(),
        theme: "Post vencido",
        format: opts.format ?? "image",
        caption: "Legenda de teste",
        status: "scheduled",
        is_ai_generated: opts.ai ?? false,
      })
      .select("*")
      .single(),
  );
  for (let i = 0; i < (opts.files ?? 1); i++) {
    const path = `${tenant}/${post.id}/${i}.${opts.video ? "mp4" : "jpg"}`;
    must(await service.storage.from("media").upload(path, new Blob(["x"]), { upsert: true }));
    must(
      await service
        .from("post_media")
        .insert({ tenant_id: tenant, post_id: post.id, position: i, kind: opts.video ? "video" : "image", storage_path: path })
        .select(),
    );
  }
  return post;
}

async function status(id: string) {
  return must(await service.from("posts").select("status, attempts, last_error, ig_container_id, ig_media_id, permalink, next_attempt_at").eq("id", id).single());
}

// Isola cada teste: tudo que estava vencido de testes anteriores sai da fila
async function clearQueue() {
  await service.from("posts").update({ status: "planned" }).in("status", ["scheduled", "publishing"]);
}

beforeAll(async () => {
  [admin, editor] = await Promise.all([createUser("pub-admin"), createUser("pub-editor")]);
  tenantId = must(await service.from("tenants").insert({ slug: slug("pub-a"), name: "Pub A" }).select("id").single()).id;
  otherTenantId = must(await service.from("tenants").insert({ slug: slug("pub-b"), name: "Pub B" }).select("id").single()).id;
  must(
    await service
      .from("memberships")
      .insert([
        { tenant_id: tenantId, user_id: admin.id, role: "admin" },
        { tenant_id: tenantId, user_id: editor.id, role: "editor" },
      ])
      .select(),
  );
  const mk = async (tenant: string, ig: string, require_approval: boolean) => {
    const a = must(await service.from("ig_accounts").insert({ tenant_id: tenant, ig_user_id: slug(ig), username: ig, require_approval }).select("id").single());
    ok(await service.rpc("store_ig_token", { p_account: a.id, p_token: `token-${ig}`, p_expires_at: new Date(Date.now() + 50 * 86_400_000).toISOString() }));
    return a.id;
  };
  accountId = await mk(tenantId, "direto", false);
  approvalAccountId = await mk(tenantId, "aprova", true);
  otherAccountId = await mk(otherTenantId, "outro", false);
});

describe("tokens no Vault", () => {
  it("service_role lê o token; usuário nem com admin", async () => {
    expect(must(await service.rpc("read_ig_token", { p_account: accountId }))).toBe("token-direto");
    const r = await admin.client.rpc("read_ig_token", { p_account: accountId });
    expect(r.error).not.toBeNull();
    const s = await admin.client.rpc("store_ig_token", { p_account: accountId, p_token: "x", p_expires_at: new Date().toISOString() });
    expect(s.error).not.toBeNull();
  });

  it("o segredo não aparece na tabela", async () => {
    const row = must(await admin.client.from("ig_accounts").select("*").eq("id", accountId).single());
    expect(JSON.stringify(row)).not.toContain("token-direto");
  });

  it("admin só muda modo de aprovação e cor, não status ou conta", async () => {
    must(await admin.client.from("ig_accounts").update({ require_approval: true }).eq("id", accountId).select());
    must(await admin.client.from("ig_accounts").update({ require_approval: false }).eq("id", accountId).select());
    const st = await admin.client.from("ig_accounts").update({ status: "connected", ig_user_id: "999" }).eq("id", accountId);
    expect(st.error?.message).toMatch(/require_approval/);
    const ins = await admin.client.from("ig_accounts").insert({ tenant_id: tenantId, ig_user_id: slug("fake"), username: "fake" });
    expect(ins.error).not.toBeNull();
  });

  it("editor não muda conta", async () => {
    const r = await editor.client.from("ig_accounts").update({ require_approval: true }).eq("id", accountId).select();
    expect(r.data).toEqual([]);
  });
});

describe("agendamento pelo editor", () => {
  async function draft(account: string) {
    const p = must(
      await editor.client
        .from("posts")
        .insert({ tenant_id: tenantId, ig_account_id: account, scheduled_at: new Date(Date.now() + 3_600_000).toISOString(), theme: "Upload", format: "image", origin: "upload", caption: "Oi" })
        .select("id")
        .single(),
    );
    return p.id;
  }

  it("post sem mídia não agenda", async () => {
    const id = await draft(accountId);
    const r = await editor.client.rpc("transition_post", { p_post: id, p_to: "scheduled" });
    expect(r.error?.message).toMatch(/sem mídia/);
  });

  it("conta que publica direto agenda; mídia trava depois de agendado", async () => {
    const id = await draft(accountId);
    must(await editor.client.from("post_media").insert({ tenant_id: tenantId, post_id: id, kind: "image", storage_path: `${tenantId}/${id}/a.jpg` }).select());
    expect(must(await editor.client.rpc("transition_post", { p_post: id, p_to: "scheduled" }))).toBe("scheduled");
    const m = await editor.client.from("post_media").insert({ tenant_id: tenantId, post_id: id, position: 1, kind: "image", storage_path: `${tenantId}/${id}/b.jpg` });
    expect(m.error?.message).toMatch(/não está agendado/);
  });

  it("editar legenda de agendado em conta com aprovação volta para aprovação", async () => {
    const id = await draft(approvalAccountId);
    must(await editor.client.from("post_media").insert({ tenant_id: tenantId, post_id: id, kind: "image", storage_path: `${tenantId}/${id}/a.jpg` }).select());
    must(await editor.client.rpc("transition_post", { p_post: id, p_to: "scheduled" }));
    must(await admin.client.rpc("review_post", { p_post: id, p_approve: true }));
    expect((await status(id)).status).toBe("scheduled");

    must(await editor.client.from("posts").update({ scheduled_at: new Date(Date.now() + 7_200_000).toISOString() }).eq("id", id).select());
    expect((await status(id)).status).toBe("scheduled"); // só horário: continua aprovado

    must(await editor.client.from("posts").update({ caption: "Legenda nova" }).eq("id", id).select());
    expect((await status(id)).status).toBe("pending_approval");
  });
});

describe("publicação", () => {
  it("publica foto, guarda container antes do publish e registra evento", async () => {
    await clearQueue();
    const p = await duePost({ ai: true });
    const { port, calls } = fakeMeta();
    const res = await publishDue({ db: service, meta: port });
    expect(res).toEqual([{ postId: p.id, tenantId, outcome: "published" }]);

    const s = await status(p.id);
    expect(s.status).toBe("published");
    expect(s.ig_container_id).toBe("c1");
    expect(s.ig_media_id).toBe("m2");
    expect(s.permalink).toBe("https://instagram.com/p/m2");

    expect(calls.map((c) => c.fn)).toEqual(["limit", "container", "status", "publish"]);
    const input = calls[1].args[2] as ContainerInput;
    expect(input).toMatchObject({ kind: "image", caption: "Legenda de teste", aiGenerated: true });
    expect((input as { imageUrl: string }).imageUrl).toMatch(/token=/); // URL assinada

    const ev = must(await service.from("post_events").select("from_status, to_status, actor").eq("post_id", p.id));
    expect(ev).toEqual([{ from_status: "publishing", to_status: "published", actor: null }]);
  });

  it("não publica duas vezes com dois workers ao mesmo tempo", async () => {
    await clearQueue();
    const posts = await Promise.all([duePost(), duePost(), duePost()]);
    const a = fakeMeta();
    const b = fakeMeta();
    const [r1, r2] = await Promise.all([publishDue({ db: service, meta: a.port }), publishDue({ db: service, meta: b.port })]);
    const ids = [...r1, ...r2].map((r) => r.postId).sort();
    expect(ids).toEqual(posts.map((p) => p.id).sort());
    const publishes = [...a.calls, ...b.calls].filter((c) => c.fn === "publish");
    expect(publishes).toHaveLength(3);
  });

  it("carrossel cria filhos e o container pai", async () => {
    await clearQueue();
    await duePost({ format: "carousel", files: 3 });
    const { port, calls } = fakeMeta();
    const [r] = await publishDue({ db: service, meta: port });
    expect(r.outcome).toBe("published");
    const inputs = calls.filter((c) => c.fn === "container").map((c) => c.args[2] as ContainerInput);
    expect(inputs.map((i) => i.kind)).toEqual(["image", "image", "image", "carousel"]);
    expect(inputs.slice(0, 3).every((i) => "carouselItem" in i && i.carouselItem)).toBe(true);
    expect(inputs[3]).toMatchObject({ children: ["c1", "c2", "c3"], caption: "Legenda de teste" });
  });

  it("Reels espera o vídeo processar", async () => {
    await clearQueue();
    await duePost({ format: "reels", video: true });
    const seq = ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"];
    const { port } = fakeMeta({ containerStatus: async () => ({ status_code: seq.shift() ?? "FINISHED" }) });
    const [r] = await publishDue({ db: service, meta: port, sleep: async () => {}, videoPollMs: [0, 1, 1, 1] });
    expect(r.outcome).toBe("published");
  });

  it("limite da Meta atingido adia sem gastar tentativa", async () => {
    await clearQueue();
    const p = await duePost();
    const { port, calls } = fakeMeta({ publishingLimit: async () => ({ used: 50, total: 50 }) });
    const [r] = await publishDue({ db: service, meta: port });
    expect(r.outcome).toBe("deferred");
    const s = await status(p.id);
    expect(s.status).toBe("scheduled");
    expect(s.attempts).toBe(0);
    expect(new Date(s.next_attempt_at!).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(calls.some((c) => c.fn === "container")).toBe(false);

    // Não volta para a fila antes da hora
    expect(await publishDue({ db: service, meta: fakeMeta().port })).toEqual([]);
  });

  it("erro temporário tenta de novo até 3 vezes e depois falha", async () => {
    await clearQueue();
    const p = await duePost();
    const { port } = fakeMeta({
      publishContainer: async () => {
        throw new MetaApiError("Service temporarily unavailable", 503, 2, undefined, true);
      },
    });
    for (let i = 1; i <= 3; i++) {
      const [r] = await publishDue({ db: service, meta: port });
      expect(r.outcome).toBe(i < 3 ? "retry" : "failed");
      await service.from("posts").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("id", p.id);
    }
    const s = await status(p.id);
    expect(s.status).toBe("failed");
    expect(s.last_error).toMatch(/Meta recusou/);
  });

  it("retentativa reaproveita o container salvo", async () => {
    await clearQueue();
    const p = await duePost();
    let fail = true;
    const { port, calls } = fakeMeta({
      publishContainer: async () => {
        if (fail) {
          fail = false;
          throw new MetaApiError("timeout", 500, 1, undefined, true);
        }
        return "m-final";
      },
    });
    await publishDue({ db: service, meta: port });
    await service.from("posts").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("id", p.id);
    const [r] = await publishDue({ db: service, meta: port });
    expect(r.outcome).toBe("published");
    expect(calls.filter((c) => c.fn === "container")).toHaveLength(1);
  });

  it("token expirado marca a conta para reconectar", async () => {
    await clearQueue();
    const acc = must(await service.from("ig_accounts").insert({ tenant_id: tenantId, ig_user_id: slug("expira"), username: "expira" }).select("id").single());
    ok(await service.rpc("store_ig_token", { p_account: acc.id, p_token: "t", p_expires_at: new Date().toISOString() }));
    const p = await duePost({ account: acc.id });
    const { port } = fakeMeta({
      publishingLimit: async () => {
        throw new MetaApiError("Error validating access token", 400, 190);
      },
    });
    const [r] = await publishDue({ db: service, meta: port });
    expect(r.outcome).toBe("failed");
    expect((await status(p.id)).last_error).toMatch(/Reconecte/);
    expect(must(await service.from("ig_accounts").select("status").eq("id", acc.id).single()).status).toBe("needs_reauth");
  });

  it("não pega post de conta desconectada nem de cliente suspenso", async () => {
    await clearQueue();
    const t = must(await service.from("tenants").insert({ slug: slug("pub-susp"), name: "Susp" }).select("id").single());
    const acc = must(await service.from("ig_accounts").insert({ tenant_id: t.id, ig_user_id: slug("susp"), username: "susp" }).select("id").single());
    ok(await service.rpc("store_ig_token", { p_account: acc.id, p_token: "t", p_expires_at: new Date().toISOString() }));
    await duePost({ tenant: t.id, account: acc.id });
    must(await service.from("tenants").update({ status: "suspended" }).eq("id", t.id).select());

    const disc = must(await service.from("ig_accounts").insert({ tenant_id: tenantId, ig_user_id: slug("disc"), username: "disc" }).select("id").single());
    await duePost({ account: disc.id });
    ok(await service.rpc("delete_ig_token", { p_account: disc.id }));

    expect(await publishDue({ db: service, meta: fakeMeta().port })).toEqual([]);
  });

  it("publicação travada vira falha com aviso, sem republicar", async () => {
    await clearQueue();
    const p = await duePost();
    await service.from("posts").update({ status: "publishing", publishing_started_at: new Date(Date.now() - 30 * 60_000).toISOString() }).eq("id", p.id);
    const { port, calls } = fakeMeta();
    await publishDue({ db: service, meta: port });
    const s = await status(p.id);
    expect(s.status).toBe("failed");
    expect(s.last_error).toMatch(/Confira no Instagram/);
    expect(calls).toEqual([]);
  });

  it("cada cliente só publica na própria conta", async () => {
    await clearQueue();
    const mine = await duePost();
    const theirs = await duePost({ tenant: otherTenantId, account: otherAccountId });
    const { port, calls } = fakeMeta();
    await publishDue({ db: service, meta: port });
    const tokensByIg = calls.filter((c) => c.fn === "publish").map((c) => c.args[0]);
    expect(tokensByIg.sort()).toEqual(["token-direto", "token-outro"]);
    expect((await status(mine.id)).status).toBe("published");
    expect((await status(theirs.id)).status).toBe("published");
  });
});
