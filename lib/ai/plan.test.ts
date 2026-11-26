import { describe, expect, it } from "vitest";
import { imagePrompt, themesOutputSchema, themesPrompt, toItems } from "./prompts/plan";
import { captionPrompt } from "./prompts/caption";
import { imageProvider, providerOf } from "./providers";

describe("temas do mês", () => {
  it("filtra dias fora do mês ou no passado, horários inválidos e temas repetidos", () => {
    const out = themesOutputSchema.parse({
      itens: [
        { dia: 3, horario: "9:30", formato: "foto", tema: "Dica A" },
        { dia: 2, horario: "10:00", formato: "reels", tema: "Passado" },
        { dia: 31, horario: "10:00", formato: "foto", tema: "Fora do mês" },
        { dia: 5, horario: "25:00", formato: "foto", tema: "Hora ruim" },
        { dia: 6, horario: "18:00", formato: "carrossel", tema: "dica a" },
        { dia: 7, horario: "18:00", formato: "stories", tema: "Bastidores" },
      ],
    });
    expect(toItems(out, 30, 3)).toEqual([
      { day: 3, time: "09:30", format: "image", theme: "Dica A" },
      { day: 7, time: "18:00", format: "story", theme: "Bastidores" },
    ]);
  });

  it("prompt leva formatos, temas já planejados e regras de saúde", () => {
    const p = themesPrompt({ monthLabel: "dezembro de 2026", count: 8, firstDay: 2, daysInMonth: 31, username: "c", existing: ["Tema velho"], formats: ["image", "reels"], brand: { is_healthcare: true } });
    expect(p.system).toContain("foto, reels");
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
