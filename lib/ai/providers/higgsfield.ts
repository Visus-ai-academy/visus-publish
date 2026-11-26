import { AiProviderError, downloadVideo, failure, type ProviderConfig, type VideoProvider } from "./types";

/**
 * Higgsfield (api.higgsfield.ai). A chave é "KEY_ID:KEY_SECRET", do console.higgsfield.ai.
 * O modelo é o caminho do endpoint (ex.: wan/v2.6/image-to-video). Modelos "image-to-video"
 * animam um quadro inicial; o resultado sai em GET /requests/{id}/status (video.url).
 */
export function higgsfieldProvider(cfg: ProviderConfig = {}): VideoProvider {
  const base = (cfg.baseUrl ?? "https://api.higgsfield.ai").replace(/\/$/, "");
  const f = cfg.fetch ?? fetch;
  const auth = (key: string) => ({ authorization: `Key ${key}` });
  const needsImage = (model: string) => /image-to-video|\/dop\//.test(model);
  return {
    needsImage,
    async startVideo(req) {
      if (!/^[\w.-]+(\/[\w.-]+)*$/.test(req.model)) throw new AiProviderError("Modelo da Higgsfield inválido. Escolha outro em Admin → IA.");
      const body: Record<string, unknown> = { prompt: req.prompt.slice(0, 2000), duration: 5 };
      if (needsImage(req.model)) {
        if (!req.imageUrl) throw new AiProviderError("Este modelo da Higgsfield precisa de uma imagem inicial.");
        body.image_url = req.imageUrl;
      } else {
        body.aspect_ratio = req.aspect;
      }
      const res = await f(`${base}/${req.model}`, {
        method: "POST",
        headers: { ...auth(req.apiKey), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw await failure("Higgsfield", res, req.model);
      const json = (await res.json()) as { request_id?: string };
      if (!json.request_id || !/^[\w-]+$/.test(json.request_id)) throw new AiProviderError("A Higgsfield não devolveu o pedido do vídeo.");
      return { externalId: json.request_id };
    },
    async checkVideo(req) {
      if (!/^[\w-]+$/.test(req.externalId)) return { state: "failed", error: "Pedido de vídeo inválido." };
      const res = await f(`${base}/requests/${req.externalId}/status`, { headers: auth(req.apiKey), signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        const e = await failure("Higgsfield", res);
        if (res.status >= 500 || res.status === 429) return { state: "running" };
        return { state: "failed", error: e.message };
      }
      const body = (await res.json()) as { status?: string; error?: string | null; video?: { url?: string } };
      switch (body.status) {
        case "queued":
        case "in_progress":
          return { state: "running" };
        case "completed": {
          const url = body.video?.url;
          if (!url || !url.startsWith("https://")) return { state: "failed", error: "A Higgsfield não devolveu o vídeo." };
          return { state: "done", video: await downloadVideo(f, url, {}, "Higgsfield") };
        }
        case "nsfw":
          return { state: "failed", error: "A Higgsfield bloqueou o vídeo pelo filtro de conteúdo. Ajuste o tema ou a orientação." };
        case "canceled":
          return { state: "failed", error: "O vídeo foi cancelado na Higgsfield." };
        default:
          return { state: "failed", error: `A Higgsfield não conseguiu gerar o vídeo${body.error ? `: ${String(body.error).slice(0, 200)}` : "."}` };
      }
    },
  };
}
