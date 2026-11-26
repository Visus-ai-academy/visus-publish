import { AiProviderError, downloadVideo, failure, type ProviderConfig, type VideoProvider } from "./types";

/** Google Veo pela API do Gemini (mesma chave). Texto → vídeo, operação longa. */
export function veoProvider(cfg: ProviderConfig = {}): VideoProvider {
  const base = (cfg.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const f = cfg.fetch ?? fetch;
  return {
    needsImage: () => false,
    async startVideo(req) {
      const res = await f(`${base}/models/${encodeURIComponent(req.model)}:predictLongRunning`, {
        method: "POST",
        headers: { "x-goog-api-key": req.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ instances: [{ prompt: req.prompt }], parameters: { aspectRatio: req.aspect } }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw await failure("Gemini", res, req.model);
      const body = (await res.json()) as { name?: string };
      if (!body.name || !/^[\w./-]+$/.test(body.name)) throw new AiProviderError("O Veo não devolveu o pedido do vídeo.");
      return { externalId: body.name };
    },
    async checkVideo(req) {
      if (!/^[\w./-]+$/.test(req.externalId)) return { state: "failed", error: "Pedido de vídeo inválido." };
      const res = await f(`${base}/${req.externalId}`, { headers: { "x-goog-api-key": req.apiKey }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        const e = await failure("Gemini", res);
        // Instabilidade passageira: tenta de novo no próximo minuto
        if (res.status >= 500 || res.status === 429) return { state: "running" };
        return { state: "failed", error: e.message };
      }
      const body = (await res.json()) as {
        done?: boolean;
        error?: { message?: string };
        response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } };
      };
      if (!body.done) return { state: "running" };
      if (body.error) return { state: "failed", error: `O Veo não conseguiu gerar o vídeo: ${String(body.error.message ?? "").slice(0, 200)}` };
      const r = body.response?.generateVideoResponse;
      const uri = r?.generatedSamples?.[0]?.video?.uri;
      if (!uri) {
        return { state: "failed", error: r?.raiMediaFilteredReasons?.length ? "O Veo bloqueou o vídeo pelo filtro de conteúdo. Ajuste o tema ou a orientação." : "O Veo não devolveu o vídeo." };
      }
      if (!uri.startsWith(base.replace(/\/v1beta$/, "")) && !uri.startsWith("https://generativelanguage.googleapis.com/")) {
        return { state: "failed", error: "O Veo devolveu um endereço de vídeo inesperado." };
      }
      return { state: "done", video: await downloadVideo(f, uri, { "x-goog-api-key": req.apiKey }, "Gemini") };
    },
  };
}
