import { AiProviderError, failure, fromBase64, type ImageProvider, type ProviderConfig } from "./types";

export function geminiImageProvider(cfg: ProviderConfig = {}): ImageProvider {
  const base = (cfg.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const f = cfg.fetch ?? fetch;
  return {
    async generateImage(req) {
      const res = await f(`${base}/models/${encodeURIComponent(req.model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": req.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: req.aspect } },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw await failure("Gemini", res);
      const body = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] }; finishReason?: string }[] };
      const c = body.candidates?.[0];
      const img = c?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!img?.data) throw new AiProviderError(c?.finishReason === "SAFETY" ? "O Gemini se recusou a criar esta arte." : "O Gemini não devolveu a imagem.");
      return { mime: img.mimeType === "image/jpeg" ? "image/jpeg" : "image/png", bytes: fromBase64(img.data) };
    },
  };
}
