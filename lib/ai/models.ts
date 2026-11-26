import type { CaptionProviderId, ProvidersConfig } from "./providers";

export type ModelTask = "caption" | "image" | "transcription";

/** Lista de reserva quando a API do provedor não responde (ou não há chave). */
export const FALLBACK_MODELS: Record<CaptionProviderId, Record<ModelTask, string[]>> = {
  openai: {
    caption: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
    image: ["gpt-image-1", "gpt-image-1-mini"],
    transcription: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
  },
  gemini: { caption: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"], image: ["gemini-2.5-flash-image"], transcription: [] },
};

const NOT_TEXT = /(audio|realtime|tts|transcribe|whisper|embedding|moderation|image|dall-e|search|computer-use|codex|aqa|veo|imagen|live|native-audio)/i;

/** Separa os modelos que servem para cada tarefa a partir dos ids que o provedor devolve. */
export function classifyModels(provider: CaptionProviderId, ids: string[]): Record<ModelTask, string[]> {
  const uniq = [...new Set(ids)].sort();
  if (provider === "openai") {
    return {
      caption: uniq.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !NOT_TEXT.test(id)),
      image: uniq.filter((id) => /^(gpt-image|dall-e)/.test(id)),
      transcription: uniq.filter((id) => /transcribe|whisper/.test(id) && !/diarize/.test(id)),
    };
  }
  return {
    caption: uniq.filter((id) => id.startsWith("gemini-") && !NOT_TEXT.test(id)),
    image: uniq.filter((id) => id.startsWith("gemini-") && /image/.test(id)),
    transcription: [],
  };
}

/** Busca os modelos disponíveis para a chave. Devolve null se não conseguir (usa a lista de reserva). */
export async function fetchModels(provider: CaptionProviderId, key: string, cfg: ProvidersConfig = {}): Promise<Record<ModelTask, string[]> | null> {
  const c = cfg[provider] ?? {};
  const f = c.fetch ?? fetch;
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
    const ids = (body.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
    return classifyModels(provider, ids);
  } catch {
    return null;
  }
}

/** Opções do seletor: as da API (ou reserva), sempre com o modelo atual. */
export function modelOptions(provider: CaptionProviderId, task: ModelTask, current: string | undefined, fetched: Record<ModelTask, string[]> | null): string[] {
  const list = fetched?.[task]?.length ? fetched[task] : FALLBACK_MODELS[provider][task];
  return current && !list.includes(current) ? [current, ...list] : list;
}
