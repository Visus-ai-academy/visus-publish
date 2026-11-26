import type { KeyProviderId, ProvidersConfig } from "./providers";

/** Confere a chave num endpoint barato. Devolve a mensagem de erro em pt-BR, ou null. */
export async function checkKey(provider: KeyProviderId, key: string, cfg: ProvidersConfig = {}): Promise<string | null> {
  const c = cfg[provider] ?? {};
  const f = c.fetch ?? fetch;
  if (provider === "higgsfield" && !/^[^:\s]+:[^:\s]+$/.test(key)) return "Cole no formato KEY_ID:KEY_SECRET, como aparece no console da Higgsfield.";
  const res =
    provider === "openai"
      ? await f(`${(c.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) })
      : provider === "gemini"
        ? await f(`${(c.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "")}/models?pageSize=1`, {
            headers: { "x-goog-api-key": key },
            signal: AbortSignal.timeout(15_000),
          })
        : // A Higgsfield não tem rota de conta: um pedido inexistente dá 404 com chave boa e 401 com chave ruim
          await f(`${(c.baseUrl ?? "https://api.higgsfield.ai").replace(/\/$/, "")}/requests/00000000-0000-4000-8000-000000000000/status`, {
            headers: { authorization: `Key ${key}` },
            signal: AbortSignal.timeout(15_000),
          });
  if (res.ok || (provider === "higgsfield" && res.status === 404)) return null;
  if (res.status === 400 || res.status === 401 || res.status === 403) return "A chave foi recusada pelo provedor. Confira e cole de novo.";
  return `Não deu para conferir a chave agora (erro ${res.status}). Tente de novo.`;
}
