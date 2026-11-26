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

/** Lê o erro devolvido pelo provedor (OpenAI e Gemini usam { error: { message, code, status } }). */
async function readError(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown; code?: unknown; status?: unknown; type?: unknown } };
    const e = body?.error ?? {};
    const code = [e.code, e.status, e.type].find((v) => typeof v === "string") as string | undefined;
    // Nunca devolve algo que pareça chave (a OpenAI às vezes cita o começo da chave)
    const message = typeof e.message === "string" ? e.message.replace(/\b(sk|AIza)[\w-]{4,}/g, "***").slice(0, 300) : "";
    return { code: code ?? "", message };
  } catch {
    return { code: "", message: "" };
  }
}

export async function failure(provider: string, res: Response, model?: string): Promise<AiProviderError> {
  const { code, message } = await readError(res);
  // Detalhe técnico nos logs do servidor (sem a chave), para investigar depois
  console.error(`[ai] ${provider} ${res.status} ${model ?? ""} ${code} ${message}`.trim());
  const m = message.toLowerCase();
  const which = model ? ` (${model})` : "";
  if (m.includes("verif")) {
    return new AiProviderError(
      `A ${provider} exige verificar a sua organização para usar o modelo${which}. ${provider === "OpenAI" ? "Verifique em platform.openai.com, em Settings, Organization, General, ou escolha" : "Escolha"} outro modelo ou provedor em Admin → IA.`,
      res.status,
    );
  }
  if (code.includes("moderation") || code.includes("content_policy") || m.includes("safety system") || m.includes("safety")) {
    return new AiProviderError(`A ${provider} bloqueou o pedido pelo filtro de conteúdo. Ajuste o tema ou a orientação e gere de novo.`, res.status);
  }
  if (code === "model_not_found" || (m.includes("model") && (m.includes("does not exist") || m.includes("not found") || m.includes("not supported")))) {
    return new AiProviderError(`O modelo${which} não está disponível na conta da ${provider}. Escolha outro em Admin → IA.`, res.status);
  }
  if (res.status === 401 || res.status === 403) return new AiProviderError(`A chave da ${provider} foi recusada. Confira a chave em Admin → IA.`, res.status);
  if (res.status === 429 || code === "insufficient_quota" || code === "billing_hard_limit_reached") {
    return new AiProviderError(`A ${provider} recusou por limite de uso ou saldo. Confira os créditos da conta ou tente de novo em alguns minutos.`, res.status);
  }
  if (res.status >= 500) return new AiProviderError(`A ${provider} está instável agora (${res.status}). Tente de novo em alguns minutos.`, res.status);
  const detail = message ? `: ${message}` : "";
  return new AiProviderError(`A ${provider} recusou o pedido (${res.status})${detail}`, res.status);
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
