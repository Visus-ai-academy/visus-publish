import { createServer, type Server } from "node:http";

/** OpenAI simulada: /models confere a chave; /chat/completions devolve tema e legenda fixos. */
export const FAKE_AI_PORT = 54397;
export const FAKE_AI_KEY = "sk-e2e-chave-falsa-1234567890";
let last: unknown = null;

export function startFakeAi(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url === "/__last") return json(200, last);
      if (req.headers.authorization !== `Bearer ${FAKE_AI_KEY}`) return json(401, { error: { message: "invalid key" } });
      if (req.url === "/v1/models") return json(200, { data: [{ id: "m" }] });
      if (req.url === "/v1/chat/completions") {
        last = JSON.parse(raw);
        const content = JSON.stringify({ tema: "Bastidores do atendimento", legenda: "Um dia comum na clínica.\nAgende sua avaliação.", hashtags: ["#bastidores", "clinica"], riscos: [] });
        return json(200, { choices: [{ message: { content } }] });
      }
      json(404, {});
    });
  });
  return new Promise((r) => server.listen(FAKE_AI_PORT, "127.0.0.1", () => r(server)));
}
