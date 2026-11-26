export type ImagePart = { mime: "image/jpeg" | "image/png"; base64: string };

export type CaptionRequest = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  images: ImagePart[];
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
