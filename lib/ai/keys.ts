import type { CaptionProviderId, ProvidersConfig } from "./providers";

/** Confere a chave num endpoint barato (lista de modelos). Devolve a mensagem de erro em pt-BR, ou null. */
export async function checkKey(provider: CaptionProviderId, key: string, cfg: ProvidersConfig = {}): Promise<string | null> {
  const c = cfg[provider] ?? {};
  const f = c.fetch ?? fetch;
  const res =
    provider === "openai"
      ? await f(`${(c.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) })
      : await f(`${(c.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "")}/models?pageSize=1`, {
          headers: { "x-goog-api-key": key },
          signal: AbortSignal.timeout(15_000),
        });
  if (res.ok) return null;
  if (res.status === 400 || res.status === 401 || res.status === 403) return "A chave foi recusada pelo provedor. Confira e cole de novo.";
  return `Não deu para conferir a chave agora (erro ${res.status}). Tente de novo.`;
}
