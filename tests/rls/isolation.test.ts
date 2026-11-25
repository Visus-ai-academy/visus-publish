import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { PostStatus } from "@/lib/posts/transitions";
import { anon, createUser, must, service, slug, type Client } from "./helpers";

type User = Awaited<ReturnType<typeof createUser>>;

let adminA: User, editorA: User, approverA: User, viewerA: User, adminB: User, outsider: User;
let tenantA: { id: string }, tenantB: { id: string };
let accountA: { id: string }, accountB: { id: string };
let postA: { id: string }, postB: { id: string };

async function newPost(tenantId: string, igAccountId: string, status: PostStatus = "planned") {
  return must(
    await service
      .from("posts")
      .insert({
        tenant_id: tenantId,
        ig_account_id: igAccountId,
        scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
        theme: "Tema de teste",
        format: "image",
        status,
      })
      .select("id")
      .single(),
  );
}

beforeAll(async () => {
  [adminA, editorA, approverA, viewerA, adminB, outsider] = await Promise.all(
    ["admin-a", "editor-a", "approver-a", "viewer-a", "admin-b", "outsider"].map(createUser),
  );

  tenantA = must(await service.from("tenants").insert({ slug: slug("clinica-a"), name: "Clínica A" }).select("id").single());
  tenantB = must(await service.from("tenants").insert({ slug: slug("clinica-b"), name: "Clínica B" }).select("id").single());

  must(
    await service
      .from("memberships")
      .insert([
        { tenant_id: tenantA.id, user_id: adminA.id, role: "admin" },
        { tenant_id: tenantA.id, user_id: editorA.id, role: "editor" },
        { tenant_id: tenantA.id, user_id: approverA.id, role: "approver" },
        { tenant_id: tenantA.id, user_id: viewerA.id, role: "viewer" },
        { tenant_id: tenantB.id, user_id: adminB.id, role: "admin" },
      ])
      .select(),
  );

  accountA = must(
    await service
      .from("ig_accounts")
      .insert({ tenant_id: tenantA.id, ig_user_id: slug("ig-a"), username: "clinica_a", require_approval: true })
      .select("id")
      .single(),
  );
  accountB = must(
    await service
      .from("ig_accounts")
      .insert({ tenant_id: tenantB.id, ig_user_id: slug("ig-b"), username: "clinica_b" })
      .select("id")
      .single(),
  );

  postA = await newPost(tenantA.id, accountA.id);
  postB = await newPost(tenantB.id, accountB.id);
});

const tenantTables = [
  "tenants",
  "memberships",
  "ig_accounts",
  "posts",
  "ai_settings",
] as const;

describe("isolamento entre clientes", () => {
  it.each(tenantTables)("membro de A não lê nada de B em %s", async (table) => {
    for (const u of [adminA, editorA, approverA, viewerA]) {
      const col = table === "tenants" ? "id" : "tenant_id";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabela varia no loop
      const { data, error } = await (u.client.from(table) as any).select("*").eq(col, tenantB.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  it("membro de A só vê o próprio cliente", async () => {
    const data = must(await viewerA.client.from("tenants").select("id"));
    expect(data.map((t) => t.id)).toEqual([tenantA.id]);
  });

  it("usuário sem cliente e anônimo não veem nada", async () => {
    for (const client of [outsider.client, anon()]) {
      for (const table of tenantTables) {
        const { data } = await client.from(table).select("*");
        expect(data ?? []).toEqual([]);
      }
    }
  });

  it("editor de A não cria post no cliente B", async () => {
    const { error } = await editorA.client.from("posts").insert({
      tenant_id: tenantB.id,
      ig_account_id: accountB.id,
      scheduled_at: new Date().toISOString(),
      theme: "invasão",
      format: "image",
    });
    expect(error).not.toBeNull();
  });

  it("post de A não pode apontar para conta do Instagram de B", async () => {
    const { error } = await editorA.client.from("posts").insert({
      tenant_id: tenantA.id,
      ig_account_id: accountB.id,
      scheduled_at: new Date().toISOString(),
      theme: "conta de outro cliente",
      format: "image",
    });
    expect(error?.code).toBe("23503"); // foreign key violation
  });

  it("mídia de A não pode apontar para post de B (nem via service_role)", async () => {
    const { error } = await service
      .from("post_media")
      .insert({ tenant_id: tenantA.id, post_id: postB.id, kind: "image", storage_path: "x" });
    expect(error?.code).toBe("23503");
  });

  it("admin de A não altera nem apaga post de B", async () => {
    const upd = await adminA.client.from("posts").update({ theme: "alterado" }).eq("id", postB.id).select();
    expect(upd.data).toEqual([]);
    const del = await adminA.client.from("posts").delete().eq("id", postB.id).select();
    expect(del.data).toEqual([]);
    const still = must(await service.from("posts").select("theme").eq("id", postB.id).single());
    expect(still.theme).toBe("Tema de teste");
  });

  it("post não muda de cliente", async () => {
    const { error } = await service.from("posts").update({ tenant_id: tenantB.id }).eq("id", postA.id);
    expect(error).not.toBeNull();
  });

  it("admin de A não se coloca no cliente B", async () => {
    const { error } = await adminA.client
      .from("memberships")
      .insert({ tenant_id: tenantB.id, user_id: adminA.id, role: "admin" });
    expect(error).not.toBeNull();
  });

  it("aprovador de A não aprova post de B", async () => {
    const pending = await newPost(tenantB.id, accountB.id, "pending_approval");
    const { error } = await approverA.client.rpc("review_post", { p_post: pending.id, p_approve: true });
    expect(error?.message).toMatch(/sem permissão/);
  });

  it("Storage: membro de A não lê nem grava na pasta de B", async () => {
    const pathB = `${tenantB.id}/${postB.id}/foto.txt`;
    must(await service.storage.from("media").upload(pathB, new Blob(["b"]), { upsert: true }));

    const write = await editorA.client.storage.from("media").upload(`${tenantB.id}/${postB.id}/invasao.txt`, new Blob(["x"]));
    expect(write.error).not.toBeNull();

    const read = await editorA.client.storage.from("media").download(pathB);
    expect(read.error).not.toBeNull();

    const own = await editorA.client.storage.from("media").upload(`${tenantA.id}/${postA.id}/ok.txt`, new Blob(["a"]), { upsert: true });
    expect(own.error).toBeNull();

    const bad = await editorA.client.storage.from("media").upload(`nao-e-uuid/x.txt`, new Blob(["x"]));
    expect(bad.error).not.toBeNull();
  });

  it("cliente suspenso some para os membros", async () => {
    const t = must(await service.from("tenants").insert({ slug: slug("suspenso"), name: "Suspenso" }).select("id").single());
    must(await service.from("memberships").insert({ tenant_id: t.id, user_id: viewerA.id, role: "viewer" }).select());
    expect(must(await viewerA.client.from("tenants").select("id").eq("id", t.id))).toHaveLength(1);
    must(await service.from("tenants").update({ status: "suspended" }).eq("id", t.id).select());
    expect(must(await viewerA.client.from("tenants").select("id").eq("id", t.id))).toEqual([]);
  });
});

describe("papéis dentro do cliente", () => {
  it("viewer e approver não criam post", async () => {
    for (const u of [viewerA, approverA]) {
      const { error } = await u.client.from("posts").insert({
        tenant_id: tenantA.id,
        ig_account_id: accountA.id,
        scheduled_at: new Date().toISOString(),
        theme: "sem permissão",
        format: "image",
      });
      expect(error).not.toBeNull();
    }
  });

  it("approver não edita post diretamente", async () => {
    const res = await approverA.client.from("posts").update({ caption: "editado" }).eq("id", postA.id).select();
    expect(res.data ?? []).toEqual([]);
  });

  it("só admin vê credenciais de IA e extrato de créditos", async () => {
    must(await service.from("credit_ledger").insert({ tenant_id: tenantA.id, delta: 100, reason: "bônus" }).select());
    expect(must(await adminA.client.from("credit_ledger").select("id"))).toHaveLength(1);
    expect(must(await editorA.client.from("credit_ledger").select("id"))).toEqual([]);
  });

  it("cliente sempre mantém pelo menos um admin", async () => {
    const { error } = await adminA.client
      .from("memberships")
      .update({ role: "editor" })
      .eq("tenant_id", tenantA.id)
      .eq("user_id", adminA.id);
    expect(error?.message).toMatch(/pelo menos um admin/);
  });
});

describe("status do post só muda pelo domínio", () => {
  async function freshPlanned(client: Client) {
    const post = must(
      await client
        .from("posts")
        .insert({
          tenant_id: tenantA.id,
          ig_account_id: accountA.id,
          scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
          theme: "Dica da semana",
          format: "image",
        })
        .select("id, status, created_by")
        .single(),
    );
    must(
      await client
        .from("post_media")
        .insert({ tenant_id: tenantA.id, post_id: post.id, kind: "image", storage_path: `${tenantA.id}/${post.id}/a.jpg` })
        .select(),
    );
    return post;
  }

  it("editor cria post como planned e created_by é ele", async () => {
    const p = await freshPlanned(editorA.client);
    expect(p.status).toBe("planned");
    expect(p.created_by).toBe(editorA.id);
  });

  it("editor não cria post já agendado nem muda status por update", async () => {
    const ins = await editorA.client.from("posts").insert({
      tenant_id: tenantA.id,
      ig_account_id: accountA.id,
      scheduled_at: new Date().toISOString(),
      theme: "pular aprovação",
      format: "image",
      status: "scheduled",
    });
    expect(ins.error?.message).toMatch(/planned/);

    const p = await freshPlanned(editorA.client);
    const upd = await editorA.client.from("posts").update({ status: "scheduled" }).eq("id", p.id);
    expect(upd.error?.message).toMatch(/status só muda/);

    const pub = await editorA.client.from("posts").update({ ig_media_id: "123" }).eq("id", p.id);
    expect(pub.error?.message).toMatch(/do sistema/);
  });

  it("criativo pronto vai para aprovação quando a conta exige, mesmo pedindo scheduled", async () => {
    const p = await freshPlanned(editorA.client);
    const to = must(await editorA.client.rpc("transition_post", { p_post: p.id, p_to: "scheduled" }));
    expect(to).toBe("pending_approval");
  });

  it("aprovador aprova e o evento fica registrado", async () => {
    const p = await freshPlanned(editorA.client);
    must(await editorA.client.rpc("transition_post", { p_post: p.id, p_to: "pending_approval" }));
    const to = must(await approverA.client.rpc("review_post", { p_post: p.id, p_approve: true, p_note: "ok" }));
    expect(to).toBe("scheduled");

    const events = must(await viewerA.client.from("post_events").select("from_status, to_status, actor").eq("post_id", p.id).order("id"));
    expect(events).toEqual([
      { from_status: "planned", to_status: "pending_approval", actor: editorA.id },
      { from_status: "pending_approval", to_status: "scheduled", actor: approverA.id },
    ]);
  });

  it("editor não aprova; approver não usa transition_post", async () => {
    const p = await freshPlanned(editorA.client);
    must(await editorA.client.rpc("transition_post", { p_post: p.id, p_to: "pending_approval" }));
    const r1 = await editorA.client.rpc("review_post", { p_post: p.id, p_approve: true });
    expect(r1.error?.message).toMatch(/sem permissão/);
    const r2 = await approverA.client.rpc("transition_post", { p_post: p.id, p_to: "planned" });
    expect(r2.error?.message).toMatch(/sem permissão/);
  });

  it("transição fora da máquina é recusada", async () => {
    const p = await freshPlanned(editorA.client);
    const { error } = await editorA.client.rpc("transition_post", { p_post: p.id, p_to: "published" });
    expect(error?.message).toMatch(/não permitida/);
  });

  it("usuário comum não chama a fila de publicação", async () => {
    const { error } = await adminA.client.rpc("claim_due_posts", { p_limit: 10 });
    expect(error).not.toBeNull();
  });

  it("post_events não aceita escrita direta do usuário", async () => {
    const { error } = await adminA.client
      .from("post_events")
      .insert({ tenant_id: tenantA.id, post_id: postA.id, to_status: "published" });
    expect(error).not.toBeNull();
  });
});

describe("convites", () => {
  async function invite(email: string) {
    const token = randomBytes(24).toString("hex");
    must(
      await service
        .from("invitations")
        .insert({
          tenant_id: tenantA.id,
          email,
          role: "editor",
          token_hash: createHash("sha256").update(token).digest("hex"),
        })
        .select(),
    );
    return token;
  }

  it("só aceita com o mesmo e-mail e uma única vez", async () => {
    const invited = await createUser("convidado");
    const token = await invite(invited.email);

    const preview = must(await anon().rpc("invitation_preview", { p_token: token }));
    expect(preview).toEqual([{ tenant_name: "Clínica A", email: invited.email, role: "editor", valid: true }]);
    expect(must(await anon().rpc("invitation_preview", { p_token: "token-errado" }))).toEqual([]);

    const wrong = await outsider.client.rpc("accept_invitation", { p_token: token });
    expect(wrong.error?.message).toMatch(/outro e-mail/);

    const ok = must(await invited.client.rpc("accept_invitation", { p_token: token }));
    expect(ok).toBe(tenantA.id);
    expect(must(await invited.client.from("tenants").select("id")).map((t) => t.id)).toEqual([tenantA.id]);

    const again = await invited.client.rpc("accept_invitation", { p_token: token });
    expect(again.error?.message).toMatch(/inválido ou expirado/);
  });

  it("lista de pessoas só sai para membros do próprio cliente", async () => {
    const mine = must(await viewerA.client.rpc("tenant_members", { p_tenant: tenantA.id }));
    expect(mine.map((m: { email: string }) => m.email)).toContain(adminA.email);
    expect(must(await adminB.client.rpc("tenant_members", { p_tenant: tenantA.id }))).toEqual([]);
  });

  it("admin de B não vê convites de A", async () => {
    expect(must(await adminB.client.from("invitations").select("id").eq("tenant_id", tenantA.id))).toEqual([]);
  });
});
