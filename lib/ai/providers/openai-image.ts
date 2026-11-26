import { AiProviderError, failure, fromBase64, type ImageProvider, type ProviderConfig } from "./types";

// Tamanhos aceitos pela API de imagens; 4:5 não existe, usa o quadrado (o feed aceita 1:1)
const SIZE = { "1:1": "1024x1024", "4:5": "1024x1024", "9:16": "1024x1536" } as const;

export function openaiImageProvider(cfg: ProviderConfig = {}): ImageProvider {
  const base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const f = cfg.fetch ?? fetch;
  return {
    async generateImage(req) {
      const res = await f(`${base}/images/generations`, {
        method: "POST",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: req.model, prompt: req.prompt, size: SIZE[req.aspect], n: 1, output_format: "jpeg" }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw await failure("OpenAI", res);
      const body = (await res.json()) as { data?: { b64_json?: string }[] };
      const b64 = body.data?.[0]?.b64_json;
      if (!b64) throw new AiProviderError("A OpenAI não devolveu a imagem.");
      return { mime: "image/jpeg", bytes: fromBase64(b64) };
    },
  };
}
