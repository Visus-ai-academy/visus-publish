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
    // Insights: 8 publicações nos últimos dias (terças 18h rendem mais que segundas 12h, horário de São Paulo)
    if (path.endsWith("/media") && req.method === "GET") return json({ data: fakeMediaList() });
    if (/^ig-media-\d+\/insights$/.test(path)) {
      const k = Number(path.match(/\d+/)![0]);
      const reach = 1000;
      const good = k % 2 === 0;
      const v: Record<string, number> = { views: 1500, reach, likes: good ? 60 : 20, comments: good ? 8 : 2, saved: 5, shares: 3, total_interactions: 70, profile_visits: good ? 30 : 6, follows: 1 };
      const metrics = (url.searchParams.get("metric") ?? "").split(",");
      return json({ data: metrics.filter((m) => m in v).map((name) => ({ name, period: "lifetime", values: [{ value: v[name] }] })) });
    }
    if (/^\d+\/insights$/.test(path)) {
      if (url.searchParams.get("metric") === "follower_demographics") {
        const b = url.searchParams.get("breakdown");
        const results =
          b === "age"
            ? [{ dimension_values: ["25-34"], value: 310 }, { dimension_values: ["35-44"], value: 340 }, { dimension_values: ["18-24"], value: 90 }]
            : b === "gender"
              ? [{ dimension_values: ["F"], value: 620 }, { dimension_values: ["M"], value: 380 }]
              : [{ dimension_values: ["Curitiba, Paraná"], value: 500 }, { dimension_values: ["São José dos Pinhais, Paraná"], value: 120 }];
        return json({ data: [{ name: "follower_demographics", total_value: { breakdowns: [{ dimension_keys: [b], results }] } }] });
      }
      return json({ data: [{ name: url.searchParams.get("metric"), total_value: { value: 900 } }] });
    }
    if (/^\d+$/.test(path) && url.searchParams.get("fields") === "followers_count") return json({ followers_count: 1840 });
    if (path.endsWith("/content_publishing_limit")) return json({ data: [{ quota_usage: 1, config: { quota_total: 100 } }] });
    if (path.endsWith("/media") && req.method === "POST") return json({ id: `fake-container-${++n}` });
    if (path.endsWith("/media_publish") && req.method === "POST") return json({ id: `fake-media-${++n}` });
    if (path.startsWith("fake-container-")) return json({ status_code: "FINISHED" });
    if (path.startsWith("fake-media-")) return json({ id: path, permalink: `https://www.instagram.com/p/${path}/` });
    return json({ error: { message: "rota desconhecida", code: 100 } }, 400);
  });
  return new Promise((resolve) => server.listen(FAKE_META_PORT, "127.0.0.1", () => resolve(server)));
}

/** Instante "há N dias, HH:00 em São Paulo". */
function ago(days: number, hour: number) {
  const d = new Date(Date.now() - days * 86_400_000);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00-03:00`);
}

function fakeMediaList() {
  // Pares = terça 18h (bons), ímpares = segunda 12h (fracos), uma por semana
  const now = new Date();
  const out = [];
  for (let k = 0; k < 8; k++) {
    const weeks = Math.floor(k / 2);
    const target = k % 2 === 0 ? 2 : 1; // dia da semana: 2 = terça, 1 = segunda
    let d = ago(7 * weeks + 1, k % 2 === 0 ? 18 : 12);
    while (dow(d) !== target) d = new Date(d.getTime() - 86_400_000);
    if (d > now) d = new Date(d.getTime() - 7 * 86_400_000);
    out.push({ id: `ig-media-${k}`, caption: k % 2 === 0 ? `Caso real com números ${k}` : `Frase motivacional ${k}`, media_type: k % 4 === 0 ? "CAROUSEL_ALBUM" : "IMAGE", media_product_type: "FEED", timestamp: d.toISOString(), permalink: `https://www.instagram.com/p/ig-media-${k}/` });
  }
  return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function dow(d: Date) {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
}
