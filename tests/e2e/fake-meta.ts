import { createServer, type Server } from "node:http";

/** Meta simulada para os testes e2e: aceita container, status, publish, limite e permalink. */
export const FAKE_META_PORT = 54399;
let n = 0;

export function startFakeMeta(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${FAKE_META_PORT}`);
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    if (path.endsWith("/content_publishing_limit")) return json({ data: [{ quota_usage: 1, config: { quota_total: 100 } }] });
    if (path.endsWith("/media") && req.method === "POST") return json({ id: `fake-container-${++n}` });
    if (path.endsWith("/media_publish") && req.method === "POST") return json({ id: `fake-media-${++n}` });
    if (path.startsWith("fake-container-")) return json({ status_code: "FINISHED" });
    if (path.startsWith("fake-media-")) return json({ id: path, permalink: `https://www.instagram.com/p/${path}/` });
    return json({ error: { message: "rota desconhecida", code: 100 } }, 400);
  });
  return new Promise((resolve) => server.listen(FAKE_META_PORT, "127.0.0.1", () => resolve(server)));
}
