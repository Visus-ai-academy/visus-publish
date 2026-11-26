import { AiProviderError, failure, fromBase64, type ImageProvider, type ProviderConfig } from "./types";

// Tamanhos aceitos pela API de imagens; 4:5 não existe, usa o quadrado (o feed aceita 1:1)
const SIZE = { "1:1": "1024x1024", "4:5": "1024x1024", "9:16": "1024x1536" } as const;
// DALL·E 3 usa outro tamanho vertical e não aceita output_format
const DALLE_SIZE = { "1:1": "1024x1024", "4:5": "1024x1024", "9:16": "1024x1792" } as const;

export function openaiImageProvider(cfg: ProviderConfig = {}): ImageProvider {
  const base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const f = cfg.fetch ?? fetch;
  return {
    async generateImage(req) {
      const dalle = req.model.startsWith("dall-e");
      const body = dalle
        ? { model: req.model, prompt: req.prompt.slice(0, 3900), size: req.model === "dall-e-2" ? "1024x1024" : DALLE_SIZE[req.aspect], n: 1, response_format: "b64_json" }
        : { model: req.model, prompt: req.prompt, size: SIZE[req.aspect], n: 1, output_format: "jpeg" };
      const res = await f(`${base}/images/generations`, {
        method: "POST",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw await failure("OpenAI", res, req.model);
      const json = (await res.json()) as { data?: { b64_json?: string }[] };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new AiProviderError("A OpenAI não devolveu a imagem.");
      return { mime: dalle ? "image/png" : "image/jpeg", bytes: fromBase64(b64) };
    },
  };
}
