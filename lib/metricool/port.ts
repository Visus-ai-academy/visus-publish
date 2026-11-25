import * as mc from "./client";
import * as conn from "./connector";
import type { McpConfig } from "./mcp";

/**
 * Credencial do Metricool de um cliente: token da API (Advanced/Custom) ou
 * access token do login pelo conector (qualquer plano, inclusive Free).
 */
export type MetricoolAuth = mc.MetricoolCredentials | { accessToken: string };

export const isConnector = (a: MetricoolAuth): a is { accessToken: string } => "accessToken" in a;

/** O que o publicador usa do Metricool. Os testes trocam por um Metricool simulado. */
export type MetricoolPort = {
  normalizeMedia(auth: MetricoolAuth, blogId: string, url: string): Promise<string>;
  schedulePost(auth: MetricoolAuth, input: mc.ScheduleInput): Promise<string>;
  getPostStatus(auth: MetricoolAuth, blogId: string, postId: string, timezone?: string): Promise<mc.MetricoolPostStatus>;
  deletePost(auth: MetricoolAuth, blogId: string, postId: string): Promise<void>;
};

export type MetricoolEnv = { api: mc.MetricoolConfig; mcp: McpConfig };

export function metricoolPort(env: MetricoolEnv = { api: {}, mcp: {} }): MetricoolPort {
  return {
    // O conector não tem ferramenta de mídia: a URL assinada vai com saveExternalMediaFiles.
    normalizeMedia: async (a, b, u) => (isConnector(a) ? u : mc.normalizeMedia(env.api, a, b, u)),
    schedulePost: (a, i) => (isConnector(a) ? conn.connectorSchedule(env.mcp, a.accessToken, i) : mc.schedulePost(env.api, a, i)),
    getPostStatus: (a, b, id, tz = "America/Sao_Paulo") =>
      isConnector(a) ? conn.connectorStatus(env.mcp, a.accessToken, b, id, tz) : mc.getPostStatus(env.api, a, b, id),
    deletePost: (a, b, id) => (isConnector(a) ? conn.connectorDelete(env.mcp, a.accessToken, b, id) : mc.deletePost(env.api, a, b, id)),
  };
}

export function listBrandsWith(env: MetricoolEnv, auth: MetricoolAuth) {
  return isConnector(auth) ? conn.connectorBrands(env.mcp, auth.accessToken) : mc.listBrands(env.api, auth);
}

export function metricoolEnv(): MetricoolEnv {
  // Só os testes e2e apontam para o Metricool simulado.
  return {
    api: { baseUrl: process.env.METRICOOL_BASE_URL || undefined },
    mcp: { url: process.env.METRICOOL_MCP_URL || undefined },
  };
}
