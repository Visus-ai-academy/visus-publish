import * as mc from "./client";

/** O que o publicador usa do Metricool. Os testes trocam por um Metricool simulado. */
export type MetricoolPort = {
  normalizeMedia(creds: mc.MetricoolCredentials, blogId: string, url: string): Promise<string>;
  schedulePost(creds: mc.MetricoolCredentials, input: mc.ScheduleInput): Promise<string>;
  getPostStatus(creds: mc.MetricoolCredentials, blogId: string, postId: string): Promise<mc.MetricoolPostStatus>;
  deletePost(creds: mc.MetricoolCredentials, blogId: string, postId: string): Promise<void>;
};

export function metricoolPort(cfg: mc.MetricoolConfig = {}): MetricoolPort {
  return {
    normalizeMedia: (c, b, u) => mc.normalizeMedia(cfg, c, b, u),
    schedulePost: (c, i) => mc.schedulePost(cfg, c, i),
    getPostStatus: (c, b, id) => mc.getPostStatus(cfg, c, b, id),
    deletePost: (c, b, id) => mc.deletePost(cfg, c, b, id),
  };
}

export function metricoolConfigFromEnv(): mc.MetricoolConfig {
  // Só os testes e2e apontam para o Metricool simulado.
  return { baseUrl: process.env.METRICOOL_BASE_URL || undefined };
}
