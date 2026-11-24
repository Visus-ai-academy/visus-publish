import * as meta from "./client";

/** O que o publicador usa da Meta. Os testes trocam por uma Meta simulada. */
export type MetaPort = {
  publishingLimit(token: string, igUserId: string): Promise<{ used: number; total: number | null }>;
  createContainer(token: string, igUserId: string, input: meta.ContainerInput): Promise<string>;
  containerStatus(token: string, containerId: string): Promise<{ status_code: string; status?: string }>;
  publishContainer(token: string, igUserId: string, containerId: string): Promise<string>;
  getPermalink(token: string, mediaId: string): Promise<string | null>;
};

export function metaPort(cfg: meta.MetaConfig): MetaPort {
  return {
    publishingLimit: (t, ig) => meta.publishingLimit(cfg, t, ig),
    createContainer: (t, ig, input) => meta.createContainer(cfg, t, ig, input),
    containerStatus: (t, id) => meta.containerStatus(cfg, t, id),
    publishContainer: (t, ig, id) => meta.publishContainer(cfg, t, ig, id),
    getPermalink: (t, id) => meta.getPermalink(cfg, t, id),
  };
}
