import type { KeyProviderId, ProvidersConfig } from "./providers";

export type ModelTask = "caption" | "image" | "transcription" | "video";

/** Lista de reserva quando a API do provedor não responde (ou não há chave). */
export const FALLBACK_MODELS: Record<KeyProviderId, Record<ModelTask, string[]>> = {
  openai: {
    caption: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
    image: ["gpt-image-1", "gpt-image-1-mini"],
    transcription: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
    video: [],
  },
  gemini: {
    caption: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
    image: ["gemini-2.5-flash-image"],
    transcription: [],
    video: ["veo-3.0-fast-generate-001", "veo-3.0-generate-001", "veo-3.1-fast-generate-preview", "veo-3.1-generate-preview"],
  },
  // A Higgsfield não lista modelos pela API: o caminho do endpoint é o nome (docs.higgsfield.ai, Models)
  higgsfield: { caption: [], image: [], transcription: [], video: ["wan/v2.6/image-to-video", "wan/v2.6/text-to-video"] },
};

const NOT_TEXT = /(audio|realtime|tts|transcribe|whisper|embedding|moderation|image|dall-e|search|computer-use|codex|aqa|veo|imagen|live|native-audio)/i;

/** Separa os modelos que servem para cada tarefa a partir dos ids que o provedor devolve. */
export function classifyModels(provider: KeyProviderId, ids: string[]): Record<ModelTask, string[]> {
  const uniq = [...new Set(ids)].sort();
  if (provider === "openai") {
    return {
      caption: uniq.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !NOT_TEXT.test(id)),
      image: uniq.filter((id) => /^(gpt-image|dall-e)/.test(id)),
      transcription: uniq.filter((id) => /transcribe|whisper/.test(id) && !/diarize/.test(id)),
      video: [],
    };
  }
  if (provider === "higgsfield") return { caption: [], image: [], transcription: [], video: uniq };
  return {
    caption: uniq.filter((id) => id.startsWith("gemini-") && !NOT_TEXT.test(id)),
    image: uniq.filter((id) => id.startsWith("gemini-") && /image/.test(id)),
    transcription: [],
    video: uniq.filter((id) => id.startsWith("veo-")),
  };
}

/** Busca os modelos disponíveis para a chave. Devolve null se não conseguir (usa a lista de reserva). */
export async function fetchModels(provider: KeyProviderId, key: string, cfg: ProvidersConfig = {}): Promise<Record<ModelTask, string[]> | null> {
  const c = cfg[provider] ?? {};
  const f = c.fetch ?? fetch;
  if (provider === "higgsfield") return null;
  try {
    if (provider === "openai") {
      const res = await f(`${(c.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: { id: string }[] };
      return classifyModels(provider, (body.data ?? []).map((m) => m.id));
    }
    const res = await f(`${(c.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "")}/models?pageSize=1000`, {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const ids = (body.models ?? []).filter((m) => m.supportedGenerationMethods?.some((g) => g === "generateContent" || g === "predictLongRunning")).map((m) => m.name.replace(/^models\//, ""));
    return classifyModels(provider, ids);
  } catch {
    return null;
  }
}

/** Opções do seletor: as da API (ou reserva), sempre com o modelo atual. */
export function modelOptions(provider: KeyProviderId, task: ModelTask, current: string | undefined, fetched: Record<ModelTask, string[]> | null): string[] {
  const list = fetched?.[task]?.length ? fetched[task] : FALLBACK_MODELS[provider][task];
  return current && !list.includes(current) ? [current, ...list] : list;
}
