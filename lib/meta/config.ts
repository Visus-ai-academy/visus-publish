import "server-only";
import { z } from "zod";
import type { MetaConfig } from "./client";

// Valores colados no painel da Vercel às vezes vêm com espaço ou quebra de linha; vazio = não definido.
const env = (inner: z.ZodTypeAny) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t === "" ? undefined : t;
  }, inner);

const schema = z.object({
  META_APP_ID: env(z.string().regex(/^\d+$/)),
  META_APP_SECRET: env(z.string().min(1)),
  META_REDIRECT_URI: env(z.string().url()),
  META_GRAPH_VERSION: env(z.string().regex(/^v\d+\.\d+$/).default("v24.0")),
  META_GRAPH_BASE_URL: env(z.string().url().optional()),
  // Apps novos da Meta: id da configuração do Login do Facebook para Empresas (login unificado)
  META_LOGIN_CONFIG_ID: env(z.string().regex(/^\d+$/).optional()),
});

/** Lê as credenciais do app da Meta das variáveis de ambiente do servidor. */
export function getMetaConfig(): MetaConfig | null {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) return null;
  return {
    appId: parsed.data.META_APP_ID as string,
    appSecret: parsed.data.META_APP_SECRET as string,
    redirectUri: parsed.data.META_REDIRECT_URI as string,
    graphVersion: parsed.data.META_GRAPH_VERSION as string,
    loginConfigId: parsed.data.META_LOGIN_CONFIG_ID as string | undefined,
    // Vazio em produção. Só os testes e2e apontam para a Meta simulada.
    graphBase: parsed.data.META_GRAPH_BASE_URL as string | undefined,
  };
}

/** Nomes (nunca valores) das variáveis da Meta que faltam ou estão inválidas. Vazio = tudo certo. */
export function metaConfigProblems(): string[] {
  const parsed = schema.safeParse(process.env);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
}
