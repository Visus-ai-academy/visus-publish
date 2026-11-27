import { describe, expect, it } from "vitest";
import { toFindings } from "@/lib/ai/prompts/analysis";
import { listMedia, mediaInsights, metricsFor, type MetaConfig } from "@/lib/meta/client";
import { bandOf, byFormat, cityShares, engagementRate, heatmap, localSlot, summarize, ageShares, type MediaRow } from "./aggregate";
import { affected } from "./analysis";
import { formatOf, matchPosts, needsRefresh, snapshotFor } from "./match";

const TZ = "America/Sao_Paulo";
const H = 3_600_000;
const D = 24 * H;

function row(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: Math.random().toString(36),
    postId: null,
    title: "Post",
    format: "image",
    postedAt: new Date("2026-11-03T21:00:00Z"), // terça 18h em São Paulo
    permalink: null,
    views: 100,
    reach: 100,
    likes: 5,
    comments: 1,
    saved: 1,
    shares: 1,
    profileVisits: 2,
    follows: 0,
    ...over,
  };
}

describe("casamento de posts do Metricool com mídias do Instagram", () => {
  const at = new Date("2026-11-20T15:02:00Z");
  it("prefere legenda igual a horário mais próximo", () => {
    const m = matchPosts(
      [{ id: "p1", format: "image", caption: "Bastidores do atendimento na clínica #bastidores", at }],
      [
        { igMediaId: "perto", mediaType: "IMAGE", productType: "FEED", caption: "Outra coisa", at: new Date(at.getTime() + 60_000) },
        { igMediaId: "legenda", mediaType: "IMAGE", productType: "FEED", caption: "Bastidores do atendimento na clínica #bastidores", at: new Date(at.getTime() + 40 * 60_000) },
      ],
    );
    expect(m.get("p1")).toBe("legenda");
  });
  it("não casa formato diferente nem mídia longe no tempo sem legenda igual", () => {
    const m = matchPosts(
      [{ id: "p1", format: "reels", caption: null, at }],
      [
        { igMediaId: "foto", mediaType: "IMAGE", productType: "FEED", at },
        { igMediaId: "reels-longe", mediaType: "VIDEO", productType: "REELS", at: new Date(at.getTime() + 2 * H) },
      ],
    );
    expect(m.size).toBe(0);
  });
  it("cada mídia vai para um post só", () => {
    const m = matchPosts(
      [
        { id: "a", format: "image", caption: null, at },
        { id: "b", format: "image", caption: null, at: new Date(at.getTime() + 5 * 60_000) },
      ],
      [{ igMediaId: "x", mediaType: "IMAGE", productType: "FEED", at: new Date(at.getTime() + 4 * 60_000) }],
    );
    expect([...m.entries()]).toEqual([["b", "x"]]);
  });
  it("formato pelo tipo de mídia", () => {
    expect(formatOf("CAROUSEL_ALBUM", "FEED")).toBe("carousel");
    expect(formatOf("VIDEO", "REELS")).toBe("reels");
    expect(formatOf("IMAGE", "STORY")).toBe("story");
    expect(formatOf("IMAGE", "FEED")).toBe("image");
  });
});

describe("quando ler as métricas de novo", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  it("mídia nova a cada hora, de 2 a 7 dias a cada 6 h, depois 1× por dia", () => {
    expect(needsRefresh(new Date(now.getTime() - 5 * H), null, now)).toBe(true);
    expect(needsRefresh(new Date(now.getTime() - 5 * H), new Date(now.getTime() - 30 * 60_000), now)).toBe(false);
    expect(needsRefresh(new Date(now.getTime() - 5 * H), new Date(now.getTime() - H), now)).toBe(true);
    expect(needsRefresh(new Date(now.getTime() - 3 * D), new Date(now.getTime() - 2 * H), now)).toBe(false);
    expect(needsRefresh(new Date(now.getTime() - 3 * D), new Date(now.getTime() - 7 * H), now)).toBe(true);
    expect(needsRefresh(new Date(now.getTime() - 10 * D), new Date(now.getTime() - 12 * H), now)).toBe(false);
  });
  it("depois de 28 dias lê uma última vez e para", () => {
    const posted = new Date(now.getTime() - 40 * D);
    expect(needsRefresh(posted, new Date(posted.getTime() + 20 * D), now)).toBe(true);
    expect(needsRefresh(posted, new Date(posted.getTime() + 29 * D), now)).toBe(false);
  });
  it("foto da SPEC: a maior marca já alcançada", () => {
    const p = new Date(now.getTime() - 30 * 60_000);
    expect(snapshotFor(p, now)).toBeNull();
    expect(snapshotFor(new Date(now.getTime() - 2 * H), now)).toBe("1h");
    expect(snapshotFor(new Date(now.getTime() - 4 * D), now)).toBe("72h");
    expect(snapshotFor(new Date(now.getTime() - 60 * D), now)).toBe("28d");
  });
});

describe("agregados", () => {
  it("engajamento = (curtidas + comentários + salvos + compartilhamentos) / alcance", () => {
    expect(engagementRate(row())).toBeCloseTo(0.08);
    expect(engagementRate(row({ reach: 0 }))).toBeNull();
    expect(summarize([row(), row({ reach: 300, likes: 30, comments: 0, saved: 0, shares: 0 })]).rate).toBeCloseTo((8 + 30) / 400);
  });
  it("mapa de calor no fuso do cliente", () => {
    expect(localSlot(new Date("2026-11-03T21:00:00Z"), TZ)).toEqual({ day: 1, hour: 18 });
    expect(bandOf(18)).toBe(4);
    const h = heatmap([row(), row(), row({ postedAt: new Date("2026-11-02T15:00:00Z") })], TZ);
    expect(h[1][4]).toMatchObject({ count: 2 });
    expect(h[0][2]).toMatchObject({ count: 1 }); // segunda 12h
  });
  it("formato ordenado pelo engajamento", () => {
    const f = byFormat([row({ format: "reels", likes: 20 }), row({ format: "image" })]);
    expect(f.map((x) => x.format)).toEqual(["reels", "image"]);
  });
  it("público em porcentagem", () => {
    expect(ageShares({ "25-34": 30, "18-24": 10 }).map((a) => a.label)).toEqual(["18–24", "25–34"]);
    expect(cityShares({ "Curitiba, Paraná": 5, "São Paulo, São Paulo": 10 })[0]).toMatchObject({ label: "São Paulo", pct: 10 / 15 });
  });
});

describe("achados da IA", () => {
  it("converte ações e descarta as malformadas", () => {
    const f = toFindings({
      achados: [
        { titulo: "Terça às 18h rende mais", texto: "5,4% contra 2,9%.", evidencia: {}, acao: { tipo: "mover_horario", de_hora: 12, para_hora: 18, dias: ["ter", "qui"] } },
        { titulo: "Reels alcançam mais", texto: "2,2 vezes.", evidencia: {}, acao: { tipo: "trocar_formato", de_formato: "foto", para_formato: "reels" } },
        { titulo: "Mesma hora não vale", texto: "x x x x", evidencia: {}, acao: { tipo: "mover_horario", de_hora: 12, para_hora: 12 } },
        { titulo: "Casos com números", texto: "3 vezes mais visitas.", evidencia: {}, acao: { tipo: "sugerir_temas", angulo: "casos com números" } },
      ],
    });
    expect(f.map((x) => x.action)).toEqual([
      { type: "reschedule", params: { from_hour: 12, to_hour: 18, weekdays: [2, 4] } },
      { type: "change_format", params: { from: "image", to: "reels" } },
      { type: "none", params: {} },
      { type: "suggest_themes", params: { angle: "casos com números" } },
    ]);
  });
  it("conta os posts que a ação muda (mesma regra do banco)", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    const up = [
      { id: "1", status: "scheduled", format: "image" as const, scheduledAt: new Date("2026-12-01T15:00:00Z"), hasMedia: true }, // ter 12h
      { id: "2", status: "planned", format: "image" as const, scheduledAt: new Date("2026-12-02T15:00:00Z"), hasMedia: false }, // qua 12h
      { id: "3", status: "planned", format: "reels" as const, scheduledAt: new Date("2026-12-02T21:00:00Z"), hasMedia: false }, // qua 18h
    ];
    expect(affected({ type: "reschedule", params: { from_hour: 12, to_hour: 18 } }, up, TZ, now)).toBe(2);
    expect(affected({ type: "reschedule", params: { from_hour: 12, to_hour: 18, weekdays: [2] } }, up, TZ, now)).toBe(1);
    expect(affected({ type: "change_format", params: { from: "image", to: "reels" } }, up, TZ, now)).toBe(1);
    expect(affected({ type: "none", params: {} }, up, TZ, now)).toBe(0);
  });
});

describe("cliente de insights da Meta", () => {
  const cfg = (f: typeof fetch): MetaConfig => ({ appId: "a", appSecret: "s", redirectUri: "http://x", graphVersion: "v24.0", graphBase: "http://fake", fetch: f });
  it("tenta de novo só com as métricas básicas quando a Meta recusa uma métrica", async () => {
    const asked: string[] = [];
    const f = (async (url: string) => {
      const metric = new URL(url).searchParams.get("metric")!;
      asked.push(metric);
      if (metric.includes("profile_visits")) return Response.json({ error: { message: "metric not supported", code: 100 } }, { status: 400 });
      return Response.json({ data: metric.split(",").map((name) => ({ name, values: [{ value: 7 }] })) });
    }) as unknown as typeof fetch;
    const m = await mediaInsights(cfg(f), "t", "123", "FEED");
    expect(asked).toHaveLength(2);
    expect(m).toEqual({ reach: 7, likes: 7, comments: 7, saved: 7, shares: 7 });
    expect(metricsFor("REELS")).not.toContain("profile_visits");
  });
  it("lista mídias pelas páginas até a data de corte", async () => {
    const f = (async (url: string) => {
      const after = new URL(url).searchParams.get("after");
      if (!after) return Response.json({ data: [{ id: "1", timestamp: "2026-11-20T10:00:00+0000" }], paging: { next: "https://graph.instagram.com/v24.0/9/media?after=p2" } });
      return Response.json({ data: [{ id: "2", timestamp: "2026-11-10T10:00:00+0000" }, { id: "3", timestamp: "2026-10-01T10:00:00+0000" }] });
    }) as unknown as typeof fetch;
    const items = await listMedia(cfg(f), "t", "9", { since: new Date("2026-11-01T00:00:00Z") });
    expect(items.map((i) => i.id)).toEqual(["1", "2"]);
  });
});
