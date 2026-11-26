import { describe, expect, it } from "vitest";
import { hashtagCount, suggestFormat } from "@/lib/posts/upload";
import { healthFlags, mergeFlags } from "./health";
import { checkKey } from "./keys";
import { captionOutputSchema, captionPrompt, composeCaption } from "./prompts/caption";
import { captionProvider } from "./providers";

const out = (o: Partial<{ tema: string; legenda: string; hashtags: string[]; riscos: string[] }>) => captionOutputSchema.parse({ tema: "Tema", ...o });

describe("composeCaption", () => {
  it("junta texto e hashtags, fixas da marca primeiro, sem repetir", () => {
    const r = composeCaption(out({ legenda: "Olá #Visus", hashtags: ["#visus", "marketing", "#Marketing", "ia!"] }), "image", ["#Clinica"]);
    expect(r.caption).toBe("Olá #Visus\n\n#Clinica #marketing #ia");
  });

  it("respeita 30 hashtags e 2.200 caracteres", () => {
    const many = Array.from({ length: 50 }, (_, i) => `#tag${i}`);
    const r = composeCaption(out({ legenda: "a ".repeat(1500), hashtags: many }), "reels");
    expect(hashtagCount(r.caption)).toBeLessThanOrEqual(30);
    expect(r.caption.length).toBeLessThanOrEqual(2200);
    const long = composeCaption(out({ legenda: "palavra ".repeat(600) }), "image");
    expect(long.caption.length).toBeLessThanOrEqual(2200);
  });

  it("corta hashtags demais que a IA deixou no texto", () => {
    const text = Array.from({ length: 40 }, (_, i) => `#t${i}`).join(" ");
    expect(hashtagCount(composeCaption(out({ legenda: text }), "image").caption)).toBe(30);
  });

  it("Stories não têm legenda e o tema fica curto", () => {
    const r = composeCaption(out({ tema: "x".repeat(200), legenda: "texto" }), "story");
    expect(r).toEqual({ theme: "x".repeat(120), caption: "" });
  });
});

describe("publicidade médica", () => {
  it("marca promessa, antes e depois, preço e superlativo", () => {
    expect(healthFlags("Veja o antes e depois! Resultado garantido, o melhor dentista, 20% de desconto")).toEqual([
      "Fala em antes e depois",
      "Promete resultado",
      "Usa superlativo",
      "Fala de preço ou promoção",
    ]);
    expect(healthFlags("Dicas para cuidar da pele no verão.")).toEqual([]);
  });

  it("junta alertas sem repetir", () => {
    expect(mergeFlags(["A", " a "], [], null, ["B"])).toEqual(["A", "B"]);
  });

  it("o prompt leva as regras só para marca de saúde", () => {
    const base = { format: "reels" as const, mediaKind: "video" as const, frameCount: 4, username: "clinica" };
    expect(captionPrompt({ ...base, brand: { is_healthcare: true } }).system).toContain("CFM");
    expect(captionPrompt({ ...base, brand: { tone: "leve" } }).system).not.toContain("CFM");
    expect(captionPrompt({ ...base, hint: "lançamento" }).user).toContain("lançamento");
  });
});

describe("suggestFormat", () => {
  it("ajusta pelo tipo do arquivo e mantém Stories", () => {
    expect(suggestFormat("image", [{ type: "video/mp4" }])).toBe("reels");
    expect(suggestFormat("reels", [{ type: "image/png" }])).toBe("image");
    expect(suggestFormat("image", [{ type: "image/png" }, { type: "image/jpeg" }])).toBe("carousel");
    expect(suggestFormat("story", [{ type: "video/mp4" }])).toBe("story");
  });
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const req = { apiKey: "k-123", model: "m-1", system: "sys", user: "usr", images: [{ mime: "image/jpeg" as const, base64: "AAAA" }] };

describe("provedores", () => {
  it("OpenAI manda imagens e lê JSON", async () => {
    const { f, calls } = fakeFetch(() => Response.json({ choices: [{ message: { content: '{"tema":"T","legenda":"L","hashtags":[],"riscos":[]}' } }] }));
    const r = await captionProvider("openai", { openai: { baseUrl: "http://x/v1", fetch: f } }).generateCaption(req);
    expect(r).toMatchObject({ tema: "T" });
    expect(calls[0].url).toBe("http://x/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe("m-1");
    expect(body.messages[1].content[1].image_url.url).toBe("data:image/jpeg;base64,AAAA");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer k-123");
  });

  it("Gemini manda inlineData e aceita JSON entre crases", async () => {
    const { f, calls } = fakeFetch(() => Response.json({ candidates: [{ content: { parts: [{ text: '```json\n{"tema":"G"}\n```' }] } }] }));
    const r = await captionProvider("gemini", { gemini: { baseUrl: "http://g", fetch: f } }).generateCaption(req);
    expect(r).toEqual({ tema: "G" });
    expect(calls[0].url).toBe("http://g/models/m-1:generateContent");
    expect(JSON.parse(String(calls[0].init.body)).contents[0].parts[1].inlineData).toEqual({ mimeType: "image/jpeg", data: "AAAA" });
  });

  it("erro de chave não expõe o corpo da resposta", async () => {
    const { f } = fakeFetch(() => new Response("segredo da conta", { status: 401 }));
    await expect(captionProvider("openai", { openai: { fetch: f } }).generateCaption(req)).rejects.toThrow(/chave da OpenAI foi recusada/);
    await expect(checkKey("gemini", "x", { gemini: { fetch: f } })).resolves.toMatch(/recusada/);
  });
});
