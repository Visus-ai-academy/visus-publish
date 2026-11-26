export type ImagePart = { mime: "image/jpeg" | "image/png"; base64: string };

export type CaptionRequest = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  images: ImagePart[];
  /** Áudio do vídeo (WAV). O Gemini ouve direto; para a OpenAI ele é transcrito antes. */
  audio?: { mime: "audio/wav"; base64: string } | null;
};

export interface CaptionProvider {
  /** Devolve o JSON (ainda não validado) que o modelo respondeu. */
  generateCaption(req: CaptionRequest): Promise<unknown>;
}

export type ProviderConfig = { baseUrl?: string; fetch?: typeof fetch };

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function parseJsonText(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    throw new AiProviderError("A IA não devolveu JSON válido.");
  }
}

export async function failure(provider: string, res: Response): Promise<AiProviderError> {
  // Não repassa o corpo para o usuário (pode conter dados da conta); só o status
  if (res.status === 401 || res.status === 403) return new AiProviderError(`A chave da ${provider} foi recusada. Confira a chave em Admin.`, res.status);
  if (res.status === 429) return new AiProviderError(`A ${provider} recusou por limite de uso ou saldo. Tente de novo em alguns minutos.`, res.status);
  return new AiProviderError(`A ${provider} respondeu com erro (${res.status}). Tente de novo.`, res.status);
}

export type ImageRequest = {
  apiKey: string;
  model: string;
  prompt: string;
  /** Proporção pedida ao provedor: feed 4:5 (ou 1:1), Stories 9:16. */
  aspect: "1:1" | "4:5" | "9:16";
};

export type GeneratedImage = { mime: "image/jpeg" | "image/png"; bytes: Uint8Array };

export interface ImageProvider {
  generateImage(req: ImageRequest): Promise<GeneratedImage>;
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}
