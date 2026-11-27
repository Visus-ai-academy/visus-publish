import "server-only";
import { z } from "zod";
import type { MetaConfig } from "./client";

const schema = z.object({
  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_REDIRECT_URI: z.string().url(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v24.0"),
  META_GRAPH_BASE_URL: z.string().url().optional(),
  // Apps novos da Meta: id da configuração do Login do Facebook para Empresas (login unificado)
  META_LOGIN_CONFIG_ID: z.string().regex(/^\d+$/).optional(),
});

/** Lê as credenciais do app da Meta das variáveis de ambiente do servidor. */
export function getMetaConfig(): MetaConfig | null {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) return null;
  return {
    appId: parsed.data.META_APP_ID,
    appSecret: parsed.data.META_APP_SECRET,
    redirectUri: parsed.data.META_REDIRECT_URI,
    graphVersion: parsed.data.META_GRAPH_VERSION,
    loginConfigId: parsed.data.META_LOGIN_CONFIG_ID,
    // Vazio em produção (graph.instagram.com). Só os testes e2e apontam para a Meta simulada.
    graphBase: parsed.data.META_GRAPH_BASE_URL,
  };
}
