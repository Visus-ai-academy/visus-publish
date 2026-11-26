import { type CaptionProvider, type ProviderConfig, failure, parseJsonText, AiProviderError } from "./types";

export function openaiProvider(cfg: ProviderConfig = {}): CaptionProvider {
  const base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const f = cfg.fetch ?? fetch;
  return {
    async generateCaption(req) {
      const res = await f(`${base}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${req.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: req.system },
            {
              role: "user",
              content: [
                { type: "text", text: req.user },
                ...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.base64}`, detail: "low" } })),
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw await failure("OpenAI", res);
      const body = (await res.json()) as { choices?: { message?: { content?: string | null; refusal?: string | null } }[] };
      const msg = body.choices?.[0]?.message;
      if (msg?.refusal) throw new AiProviderError("A OpenAI se recusou a descrever esta mídia.");
      if (!msg?.content) throw new AiProviderError("A OpenAI não devolveu texto.");
      return parseJsonText(msg.content);
    },
  };
}

/** Transcreve o áudio (WAV) em português. Devolve "" se não houver fala. */
export async function openaiTranscribe(cfg: ProviderConfig, req: { apiKey: string; model: string; base64: string }): Promise<string> {
  const base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const f = cfg.fetch ?? fetch;
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(req.base64, "base64")], { type: "audio/wav" }), "audio.wav");
  form.append("model", req.model);
  form.append("language", "pt");
  form.append("response_format", "json");
  const res = await f(`${base}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${req.apiKey}` }, body: form, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw await failure("OpenAI", res);
  const body = (await res.json()) as { text?: string };
  return (body.text ?? "").trim();
}
