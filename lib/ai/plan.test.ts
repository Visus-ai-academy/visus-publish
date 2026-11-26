import { describe, expect, it } from "vitest";
import { imagePrompt, themesOutputSchema, themesPrompt, toItems } from "./prompts/plan";
import { captionPrompt } from "./prompts/caption";
import { cadenceOutputSchema, toSlots } from "./prompts/cadence";
import { monthSlots } from "@/lib/plan/cadence";
import { imageProvider, providerOf } from "./providers";

describe("temas do mês", () => {
  const slots = monthSlots("2026-12", [{ weekday: 1, time: "18:00", format: "image" }, { weekday: 3, time: "12:00", format: "reels" }], 1, new Set());

  it("liga cada tema à sua vaga e ignora vaga inexistente, repetida ou tema repetido", () => {
    const out = themesOutputSchema.parse({
      temas: [
        { vaga: 2, tema: "Dica A" },
        { vaga: 1, tema: "Bastidores" },
        { vaga: 99, tema: "Sem vaga" },
        { vaga: 1, tema: "Vaga repetida" },
        { vaga: 3, tema: "dica a" },
      ],
    });
    expect(toItems(out, slots)).toEqual([
      { date: "2026-12-02", day: 2, time: "12:00", format: "reels", theme: "Bastidores" },
      { date: "2026-12-07", day: 7, time: "18:00", format: "image", theme: "Dica A" },
    ]);
  });

  it("prompt lista as vagas com dia, horário e formato, temas já planejados e regras de saúde", () => {
    const p = themesPrompt({ monthLabel: "dezembro de 2026", username: "c", existing: ["Tema velho"], slots: slots.slice(0, 2), niche: "Odontologia", brand: { is_healthcare: true } });
    expect(p.user).toContain("1. qua 2, 12:00, reels");
    expect(p.user).toContain("2. seg 7, 18:00, foto");
    expect(p.user).toContain("Nicho: Odontologia");
    expect(p.system).toContain("CFM");
    expect(p.user).toContain("Tema velho");
  });

  it("legenda a partir do tema pede slides só no carrossel", () => {
    const base = { mediaKind: "image" as const, frameCount: 0, username: "c", theme: "Como escovar" };
    expect(captionPrompt({ ...base, format: "carousel" }).system).toContain("slides");
    expect(captionPrompt({ ...base, format: "image" }).system).not.toContain("slides");
    expect(captionPrompt({ ...base, format: "image" }).user).toContain("Tema: Como escovar");
  });

  it("prompt da arte leva texto, proporção e cores", () => {
    const p = imagePrompt({ theme: "T", title: "Título", format: "story", brand: { colors: ["#4A5D23"] }, slide: { n: 1, total: 3 } });
    expect(p).toContain("9:16");
    expect(p).toContain('"Título"');
    expect(p).toContain("#4A5D23");
    expect(p).toContain("Slide 1 de 3");
  });

  it("nome do provedor de imagem vira o da chave", () => {
    expect(providerOf("gemini_image")).toBe("gemini");
    expect(providerOf("openai")).toBe("openai");
    expect(providerOf("canva")).toBeNull();
  });
});

describe("provedores de imagem", () => {
  const req = { apiKey: "k", model: "m", prompt: "p", aspect: "9:16" as const };
  it("OpenAI pede JPEG no tamanho vertical", async () => {
    let body: Record<string, unknown> = {};
    const f = (async (_: string, init: RequestInit) => ((body = JSON.parse(String(init.body))), Response.json({ data: [{ b64_json: "AQID" }] }))) as unknown as typeof fetch;
    const img = await imageProvider("openai", { openai: { fetch: f } }).generateImage(req);
    expect(body).toMatchObject({ model: "m", size: "1024x1536", output_format: "jpeg" });
    expect(img).toEqual({ mime: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) });
  });

  it("Gemini lê inlineData e manda a proporção", async () => {
    let body: { generationConfig?: { imageConfig?: { aspectRatio?: string } } } = {};
    const f = (async (_: string, init: RequestInit) => (
      (body = JSON.parse(String(init.body))), Response.json({ candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: "image/png", data: "AQID" } }] } }] })
    )) as unknown as typeof fetch;
    const img = await imageProvider("gemini", { gemini: { fetch: f } }).generateImage(req);
    expect(body.generationConfig?.imageConfig?.aspectRatio).toBe("9:16");
    expect(img.mime).toBe("image/png");
  });
});

import { classifyModels, modelOptions } from "./models";

describe("lista de modelos", () => {
  it("separa texto e imagem pelos ids do provedor", () => {
    expect(classifyModels("openai", ["gpt-4.1-mini", "gpt-image-1", "whisper-1", "gpt-4o-realtime-preview", "text-embedding-3-small", "o4-mini", "dall-e-3"])).toEqual({
      caption: ["gpt-4.1-mini", "o4-mini"],
      image: ["dall-e-3", "gpt-image-1"],
      transcription: ["whisper-1"],
    });
    expect(classifyModels("gemini", ["gemini-2.5-flash", "gemini-2.5-flash-image", "gemini-embedding-001", "imagen-4"])).toEqual({
      caption: ["gemini-2.5-flash"],
      image: ["gemini-2.5-flash-image"],
      transcription: [],
    });
  });

  it("usa a reserva sem resposta da API e mantém o modelo atual", () => {
    expect(modelOptions("openai", "image", "meu-modelo", null)).toEqual(["meu-modelo", "gpt-image-1", "gpt-image-1-mini"]);
    expect(modelOptions("gemini", "caption", "gemini-2.5-flash", { caption: ["gemini-2.5-flash", "gemini-3-pro"], image: [], transcription: [] })).toEqual(["gemini-2.5-flash", "gemini-3-pro"]);
  });
});

describe("cadência", () => {
  it("vagas do mês seguem os dias da semana e pulam as já ocupadas e as passadas", () => {
    const c = [
      { weekday: 1, time: "18:00", format: "image" as const },
      { weekday: 5, time: "12:00", format: "carousel" as const },
    ];
    const v = monthSlots("2026-12", c, 5, new Set(["2026-12-07 18:00"]));
    expect(v.map((x) => `${x.date} ${x.time} ${x.format}`)).toEqual([
      "2026-12-11 12:00 carousel",
      "2026-12-14 18:00 image",
      "2026-12-18 12:00 carousel",
      "2026-12-21 18:00 image",
      "2026-12-25 12:00 carousel",
      "2026-12-28 18:00 image",
    ]);
  });

  it("resposta da IA vira vagas válidas, sem repetição, de segunda a domingo", () => {
    const out = cadenceOutputSchema.parse({
      vagas: [
        { dia: "Sex", horario: "9:00", formato: "reels" },
        { dia: "seg", horario: "18:00", formato: "foto" },
        { dia: "seg", horario: "18:00", formato: "carrossel" },
        { dia: "dom", horario: "10:00", formato: "stories" },
        { dia: "xyz", horario: "10:00", formato: "foto" },
        { dia: "ter", horario: "26:00", formato: "foto" },
      ],
      motivo: "Equilíbrio entre alcance e autoridade.",
    });
    expect(toSlots(out)).toEqual([
      { weekday: 1, time: "18:00", format: "image" },
      { weekday: 5, time: "09:00", format: "reels" },
      { weekday: 0, time: "10:00", format: "story" },
    ]);
  });
});
