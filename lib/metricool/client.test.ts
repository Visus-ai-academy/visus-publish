import { describe, expect, it } from "vitest";
import { listBrands, normalizeMedia, readInstagramStatus, scheduleBody, schedulePost, type MetricoolConfig } from "./client";

const creds = { userId: "123", token: "tok" };

function cfgWith(handler: (url: URL, init?: RequestInit) => { status?: number; body: unknown; raw?: boolean }) {
  const seen: Array<{ url: URL; init?: RequestInit }> = [];
  const cfg: MetricoolConfig = {
    fetch: (async (u: string, init?: RequestInit) => {
      const url = new URL(u);
      seen.push({ url, init });
      const r = handler(url, init);
      return new Response(r.raw ? String(r.body) : JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as typeof fetch,
  };
  return { cfg, seen };
}

describe("cliente do Metricool", () => {
  it("autentica com X-Mc-Auth e userId; blogId vai na query", async () => {
    const { cfg, seen } = cfgWith(() => ({ body: { data: { id: 987 } } }));
    const id = await schedulePost(cfg, creds, { blogId: "55", dateTime: "2026-12-01T18:00:00", timezone: "America/Sao_Paulo", text: "Oi", media: ["https://m/1.jpg"], type: "POST" });
    expect(id).toBe("987");
    const { url, init } = seen[0];
    expect(url.origin + url.pathname).toBe("https://app.metricool.com/api/v2/scheduler/posts");
    expect(url.searchParams.get("userId")).toBe("123");
    expect(url.searchParams.get("blogId")).toBe("55");
    expect((init?.headers as Record<string, string>)["X-Mc-Auth"]).toBe("tok");
    expect(url.toString()).not.toContain("tok"); // token nunca na URL
  });

  it("corpo do agendamento publica sozinho no Instagram", () => {
    expect(scheduleBody({ blogId: "1", dateTime: "2026-12-01T18:00:00", timezone: "America/Sao_Paulo", text: "Oi", media: ["u"], type: "REEL" })).toEqual({
      publicationDate: { dateTime: "2026-12-01T18:00:00", timezone: "America/Sao_Paulo" },
      text: "Oi",
      providers: [{ network: "instagram" }],
      media: ["u"],
      saveExternalMediaFiles: true,
      autoPublish: true,
      draft: false,
      instagramData: { type: "REEL", autoPublish: true },
    });
  });

  it("aceita id na raiz ou em data, e falha claro sem id", async () => {
    const a = cfgWith(() => ({ body: { id: "abc" } }));
    expect(await schedulePost(a.cfg, creds, { blogId: "1", dateTime: "x", timezone: "y", text: "", media: [], type: "POST" })).toBe("abc");
    const b = cfgWith(() => ({ body: { ok: true } }));
    await expect(schedulePost(b.cfg, creds, { blogId: "1", dateTime: "x", timezone: "y", text: "", media: [], type: "POST" })).rejects.toThrow(/não devolveu o id/);
  });

  it("lê marcas em formatos diferentes", async () => {
    const { cfg } = cfgWith(() => ({ body: [{ id: 1, label: "Clínica", instagram: "@clinica" }, { blogId: "2", title: "Outra" }, { nada: true }] }));
    expect(await listBrands(cfg, creds)).toEqual([
      { blogId: "1", label: "Clínica", instagram: "clinica" },
      { blogId: "2", label: "Outra", instagram: null },
    ]);
  });

  it("normalize aceita URL em texto puro ou em objeto", async () => {
    const a = cfgWith(() => ({ body: "https://static.metricool.com/x.jpg", raw: true }));
    expect(await normalizeMedia(a.cfg, creds, "1", "https://orig")).toBe("https://static.metricool.com/x.jpg");
    const b = cfgWith(() => ({ body: { url: "https://static.metricool.com/y.jpg" } }));
    expect(await normalizeMedia(b.cfg, creds, "1", "https://orig")).toBe("https://static.metricool.com/y.jpg");
  });

  it("status do Instagram, publicUrl e motivo do erro", () => {
    expect(readInstagramStatus({ data: { providers: [{ network: "facebook", status: "ERROR" }, { network: "instagram", status: "PUBLISHED", publicUrl: "https://ig/p/1" }] } })).toEqual({
      status: "PUBLISHED",
      publicUrl: "https://ig/p/1",
      detail: null,
    });
    expect(readInstagramStatus({ providers: [{ network: "instagram", status: "ERROR", detailedStatus: "Formato inválido" }] })).toMatchObject({ status: "ERROR", detail: "Formato inválido" });
    expect(readInstagramStatus({ algo: 1 }).status).toBe("UNKNOWN");
  });

  it("401 explica token/plano; 503 é temporário", async () => {
    const a = cfgWith(() => ({ status: 401, body: {} }));
    await expect(listBrands(a.cfg, creds)).rejects.toMatchObject({ status: 401, transient: false, message: expect.stringMatching(/plano inclui API/) });
    const b = cfgWith(() => ({ status: 503, body: {} }));
    await expect(listBrands(b.cfg, creds)).rejects.toMatchObject({ transient: true });
  });
});
