import { expect, test, type Page } from "@playwright/test";
import { utcToZoned } from "../../lib/time";
import { must, service } from "../rls/helpers";
import { FAKE_MC_TOKEN, FAKE_METRICOOL_PORT } from "./fake-metricool";

const PASSWORD = "visus-dev-123";
const CRON = "e2e-cron-secret-com-pelo-menos-32-caracteres";
const TZ = "America/Sao_Paulo";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function loginOk(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const tomorrow = () => utcToZoned(new Date(Date.now() + 86_400_000), TZ).date;
const runJob = (page: Page) => page.request.post("/api/jobs/publish-due", { headers: { authorization: `Bearer ${CRON}` } });

test.describe.configure({ mode: "serial" });

test("equipe da Visus conecta o Metricool e vincula a marca", async ({ page }) => {
  await loginOk(page, "admin@visus.local");
  await page.goto("/clinica-aurora/contas");
  await expect(page.getByRole("heading", { name: "Publicação pelo Metricool" })).toBeVisible();

  // Token errado: o Metricool recusa e nada é guardado
  await page.getByText("Usar o token da API (planos Advanced ou Custom)").click();
  await page.getByLabel("userId do Metricool").fill("4242");
  await page.getByLabel(/Token da API/).fill("token-errado");
  await page.getByRole("button", { name: /Conectar Metricool|Trocar token/ }).click();
  await expect(page.getByText(/O Metricool recusou o acesso/)).toBeVisible();

  await page.getByLabel(/Token da API/).fill(FAKE_MC_TOKEN);
  await page.getByRole("button", { name: /Conectar Metricool|Trocar token/ }).click();
  await expect(page.getByText("Metricool conectado.")).toBeVisible();

  await page.goto("/clinica-aurora/contas");
  await expect(page.getByText(/Conectado pela API \(userId 4242\)/)).toBeVisible();
  await expect(page.getByLabel("@ do Instagram")).toHaveValue("aurora.mc");
  await page.getByLabel("Depois de subir").selectOption("false");
  await page.getByRole("button", { name: "Adicionar conta" }).click();
  await expect(page.getByText("@aurora.mc vai publicar pelo Metricool.")).toBeVisible();

  await page.goto("/clinica-aurora/contas");
  const row = page.getByRole("row").filter({ hasText: "@aurora.mc" });
  await expect(row.getByRole("cell", { name: "Metricool", exact: true })).toBeVisible();
});

test("admin do cliente não vê o formulário do Metricool", async ({ page }) => {
  await loginOk(page, "ana@aurora.local");
  await page.goto("/clinica-aurora/contas");
  await expect(page.getByRole("heading", { name: "Contas do Instagram" })).toBeVisible();
  await expect(page.getByLabel("userId do Metricool")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Adicionar conta" })).toHaveCount(0);
});

test("post da conta do Metricool é enviado e depois confirmado", async ({ page }) => {
  const theme = `Metricool ${Date.now()}`;
  await loginOk(page, "edu@aurora.local");
  await page.goto("/clinica-aurora/criativos");
  await expect(page.getByRole("heading", { name: "Criativos prontos" })).toBeVisible();
  await page.getByLabel("Selecione fotos, vídeos ou artes prontas").setInputFiles({ name: "arte.png", mimeType: "image/png", buffer: PNG });
  const option = page.getByLabel("Conta").locator("option").filter({ hasText: /aurora\.mc/ });
  await page.getByLabel("Conta").selectOption({ label: (await option.textContent())! });
  await page.getByLabel("Data").fill(tomorrow());
  await page.getByLabel("Horário").fill("18:00");
  await page.getByLabel("Tema").fill(theme);
  await page.getByLabel("Legenda").fill("Legenda pelo Metricool");
  await page.getByRole("button", { name: "Agendar" }).click();
  await expect(page.getByText("Post agendado.")).toBeVisible();

  const calendar = `/clinica-aurora/calendario?mes=${tomorrow().slice(0, 7)}`;
  await page.goto(calendar);
  let row = page.getByRole("row").filter({ hasText: theme });
  await row.getByRole("button", { name: "Publicar agora" }).click();
  await expect(row.getByRole("button", { name: "Publicar agora" })).toBeEnabled();

  // 1ª rodada: entrega ao Metricool
  const sent = await (await runJob(page)).json();
  expect(sent.results.some((r: { outcome: string }) => r.outcome === "sent")).toBe(true);
  const last = await (await page.request.get(`http://127.0.0.1:${FAKE_METRICOOL_PORT}/__last`)).json();
  expect(last.blogId).toBe("9001");
  expect(last.body).toMatchObject({
    text: "Legenda pelo Metricool",
    providers: [{ network: "instagram" }],
    autoPublish: true,
    instagramData: { type: "POST" },
    publicationDate: { timezone: TZ },
  });
  expect(last.body.media[0]).toMatch(/^https:\/\/static\.metricool\.test\//);

  await page.goto(calendar);
  row = page.getByRole("row").filter({ hasText: theme });
  await expect(row.getByText("Publicando")).toBeVisible();

  // 2ª rodada (a confirmação espera 1 min entre consultas; o teste adianta o relógio)
  const { error } = await service.from("posts").update({ last_checked_at: null }).eq("theme", theme);
  expect(error).toBeNull();
  const confirmed = await (await runJob(page)).json();
  expect(confirmed.results.some((r: { outcome: string }) => r.outcome === "published")).toBe(true);

  await page.goto(calendar);
  row = page.getByRole("row").filter({ hasText: theme });
  await expect(row.getByText("Publicado")).toBeVisible();
  await expect(row.getByRole("link", { name: "Ver no Instagram" })).toHaveAttribute("href", /instagram\.com\/p\/mc-/);
});

test("conector do Metricool (plano Free): login, marca e post confirmado", async ({ page, browser }) => {
  await loginOk(page, "admin@visus.local");
  await page.goto("/bela-pele/contas");
  await page.getByRole("link", { name: "Entrar com o Metricool" }).click();
  await expect(page.getByText("Metricool conectado. Agora vincule a marca de cada conta.")).toBeVisible();
  await expect(page.getByText(/Conectado pelo login do Metricool/)).toBeVisible();
  await expect(page.getByLabel("@ do Instagram")).toHaveValue("belapele.mc");
  await page.getByLabel("Depois de subir").selectOption("false");
  await page.getByRole("button", { name: "Adicionar conta" }).click();
  await expect(page.getByText("@belapele.mc vai publicar pelo Metricool.")).toBeVisible();

  const theme = `Conector ${Date.now()}`;
  const bia = await browser.newPage();
  await loginOk(bia, "bia@belapele.local");
  await bia.goto("/bela-pele/criativos");
  await expect(bia.getByRole("heading", { name: "Criativos prontos" })).toBeVisible();
  await bia.getByLabel("Selecione fotos, vídeos ou artes prontas").setInputFiles({ name: "arte.png", mimeType: "image/png", buffer: PNG });
  const option = bia.getByLabel("Conta").locator("option").filter({ hasText: /belapele\.mc/ });
  await bia.getByLabel("Conta").selectOption({ label: (await option.textContent())! });
  await bia.getByLabel("Data").fill(tomorrow());
  await bia.getByLabel("Horário").fill("18:00");
  await bia.getByLabel("Tema").fill(theme);
  await bia.getByLabel("Legenda").fill("Legenda pelo conector");
  await bia.getByRole("button", { name: "Agendar" }).click();
  await expect(bia.getByText("Post agendado.")).toBeVisible();

  const calendar = `/bela-pele/calendario?mes=${tomorrow().slice(0, 7)}`;
  await bia.goto(calendar);
  let row = bia.getByRole("row").filter({ hasText: theme });
  await row.getByRole("button", { name: "Publicar agora" }).click();
  await expect(row.getByRole("button", { name: "Publicar agora" })).toBeEnabled();

  const sent = await (await runJob(bia)).json();
  expect(sent.results.some((r: { outcome: string }) => r.outcome === "sent")).toBe(true);
  const last = await (await bia.request.get(`http://127.0.0.1:${FAKE_METRICOOL_PORT}/__last`)).json();
  expect(last).toMatchObject({ via: "mcp", blogId: "9002", body: { text: "Legenda pelo conector", instagramData: { type: "POST" }, autoPublish: true } });

  // 1ª consulta: ainda na lista (pendente). Depois some da lista e, passada a folga, conta como publicado.
  const post = must(await service.from("posts").select("id").eq("theme", theme).single());
  await service.from("posts").update({ last_checked_at: null }).eq("id", post.id);
  await runJob(bia);
  await service.from("posts").update({ last_checked_at: null, publishing_started_at: new Date(Date.now() - 10 * 60_000).toISOString() }).eq("id", post.id);
  const confirmed = await (await runJob(bia)).json();
  expect(confirmed.results.some((r: { outcome: string }) => r.outcome === "published")).toBe(true);

  await bia.goto(calendar);
  row = bia.getByRole("row").filter({ hasText: theme });
  await expect(row.getByText("Publicado")).toBeVisible();
});
