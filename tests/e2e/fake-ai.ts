import { createServer, type Server } from "node:http";

/** OpenAI simulada: /models confere a chave; /chat/completions devolve tema e legenda fixos. */
export const FAKE_AI_PORT = 54397;
export const FAKE_AI_KEY = "sk-e2e-chave-falsa-1234567890";
let last: unknown = null;
// JPEG 1x1 válido
const JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

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
      if (req.url === "/v1/models") return json(200, { data: ["gpt-4.1-mini", "gpt-5-mini", "gpt-image-1", "whisper-1"].map((id) => ({ id })) });
      if (req.url === "/v1/images/generations") return json(200, { data: [{ b64_json: JPEG }] });
      if (req.url === "/v1/chat/completions") {
        last = JSON.parse(raw);
        const sys = String((last as { messages: { content: string }[] }).messages[0].content);
        const reply = sys.includes("analista de desempenho")
          ? {
              achados: [
                { titulo: "Terça às 18h rende o triplo de segunda às 12h", texto: "As terças às 18h ficaram bem acima das segundas às 12h.", evidencia: {}, acao: { tipo: "mover_horario", de_hora: 12, para_hora: 18 } },
                { titulo: "Casos com números trazem mais visitas ao perfil", texto: "Os posts com casos reais lideram as visitas.", evidencia: {}, acao: { tipo: "sugerir_temas", angulo: "casos reais com números" } },
              ],
            }
          : sys.includes("cadência semanal")
          ? { vagas: [{ dia: "seg", horario: "12:00", formato: "reels" }, { dia: "seg", horario: "18:00", formato: "foto" }], motivo: "Segunda concentra o público da clínica." }
          : sys.includes("calendário editorial")
          ? { temas: [{ vaga: 1, tema: "Um dia na recepção" }, { vaga: 2, tema: "Mitos sobre clareamento" }] }
          : { tema: "Bastidores do atendimento", legenda: "Um dia comum na clínica.\nAgende sua avaliação.", hashtags: ["#bastidores", "clinica"], riscos: [] };
        return json(200, { choices: [{ message: { content: JSON.stringify(reply) } }] });
      }
      json(404, {});
    });
  });
  return new Promise((r) => server.listen(FAKE_AI_PORT, "127.0.0.1", () => r(server)));
}
