import { type CaptionProvider, type ProviderConfig, failure, parseJsonText, AiProviderError } from "./types";

export function geminiProvider(cfg: ProviderConfig = {}): CaptionProvider {
  const base = (cfg.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const f = cfg.fetch ?? fetch;
  return {
    async generateCaption(req) {
      const res = await f(`${base}/models/${encodeURIComponent(req.model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": req.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }, ...req.images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } })), ...(req.audio ? [{ inlineData: { mimeType: req.audio.mime, data: req.audio.base64 } }] : [])] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw await failure("Gemini", res);
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
      const c = body.candidates?.[0];
      const text = c?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text) throw new AiProviderError(c?.finishReason === "SAFETY" ? "O Gemini se recusou a descrever esta mídia." : "O Gemini não devolveu texto.");
      return parseJsonText(text);
    },
  };
}
