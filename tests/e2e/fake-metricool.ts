import { createServer, type Server } from "node:http";

/**
 * Metricool simulado para os testes e2e. Uma marca (blogId 9001, @aurora.mc), agendamento
 * que vira PUBLISHED na primeira consulta, e /__last para o teste conferir o que foi enviado.
 */
export const FAKE_METRICOOL_PORT = 54398;
export const FAKE_MC_TOKEN = "e2e-metricool-token";
let n = 0;
let last: unknown = null;

export function startFakeMetricool(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${FAKE_METRICOOL_PORT}`);
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/__last") return json(last);
    if (req.headers["x-mc-auth"] !== FAKE_MC_TOKEN || !url.searchParams.get("userId")) return json({ error: "unauthorized" }, 401);

    if (url.pathname === "/admin/simpleProfiles") return json([{ id: 9001, label: "Aurora (Metricool)", instagram: "aurora.mc" }]);
    if (url.pathname === "/actions/normalize/image/url") return json({ url: `https://static.metricool.test/${++n}.png` });
    if (url.pathname === "/v2/scheduler/posts" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        last = { blogId: url.searchParams.get("blogId"), body: JSON.parse(raw) };
        json({ data: { id: 70000 + ++n } });
      });
      return;
    }
    const m = url.pathname.match(/^\/v2\/scheduler\/posts\/(\d+)$/);
    if (m && req.method === "GET") {
      return json({ data: { id: Number(m[1]), providers: [{ network: "instagram", status: "PUBLISHED", publicUrl: `https://www.instagram.com/p/mc-${m[1]}/` }] } });
    }
    if (m && req.method === "DELETE") return json({});
    return json({ error: "rota desconhecida" }, 404);
  });
  return new Promise((resolve) => server.listen(FAKE_METRICOOL_PORT, "127.0.0.1", () => resolve(server)));
}
