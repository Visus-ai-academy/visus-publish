import { expect, test, type Page } from "@playwright/test";
import { utcToZoned } from "../../lib/time";

const PASSWORD = "visus-dev-123";
const CRON = "e2e-cron-secret-com-pelo-menos-32-caracteres";
const TZ = "America/Sao_Paulo";

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function loginOk(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function tomorrow() {
  const { date } = utcToZoned(new Date(Date.now() + 86_400_000), TZ);
  return { date, month: date.slice(0, 7) };
}

async function upload(page: Page, account: RegExp, theme: string) {
  await page.goto("/clinica-aurora/criativos");
  await expect(page.getByRole("heading", { name: "Criativos prontos" })).toBeVisible();
  await page.getByLabel("Selecione fotos, vídeos ou artes prontas").setInputFiles({ name: "arte.png", mimeType: "image/png", buffer: PNG });
  await page.getByLabel("Conta").selectOption({ label: (await page.getByLabel("Conta").locator("option").filter({ hasText: account }).textContent())! });
  await page.getByLabel("Data").fill(tomorrow().date);
  await page.getByLabel("Horário").fill("18:00");
  await page.getByLabel("Tema").fill(theme);
  await page.getByLabel("Legenda").fill("Legenda do teste #saude");
  await page.getByRole("button", { name: "Agendar" }).click();
}

async function calendarRow(page: Page, theme: string) {
  await page.goto(`/clinica-aurora/calendario?mes=${tomorrow().month}`);
  return page.getByRole("row").filter({ hasText: theme });
}

test("editor sobe criativo para conta que publica direto e cancela", async ({ page }) => {
  const theme = `Direto ${Date.now()}`;
  await loginOk(page, "edu@aurora.local");
  await upload(page, /aurora\.estetica/, theme);
  await expect(page.getByText("Post agendado.")).toBeVisible();

  const row = await calendarRow(page, theme);
  await expect(row.getByText("Agendado")).toBeVisible();
  await row.getByRole("button", { name: "Cancelar" }).click();
  await expect(row.getByText("Planejado")).toBeVisible();
});

test("conta com aprovação: editor sobe, aprovadora aprova, sai do ar pela rotina", async ({ page, browser }) => {
  const theme = `Aprovação ${Date.now()}`;
  await loginOk(page, "edu@aurora.local");
  await upload(page, /clinicaaurora/, theme);
  await expect(page.getByText("Post enviado para aprovação.")).toBeVisible();

  const approver = await browser.newPage();
  await loginOk(approver, "dra.lucia@aurora.local");
  await approver.goto("/clinica-aurora/aprovacoes");
  const card = approver.locator("article").filter({ hasText: theme });
  await expect(card.getByRole("img", { name: `Criativo: ${theme}` })).toBeVisible();
  await card.getByRole("button", { name: "Aprovar" }).click();
  await expect(card).toHaveCount(0);

  // Editor publica agora; a rotina (como o agendador faria) publica na Meta simulada
  const row = await calendarRow(page, theme);
  await expect(row.getByText("Agendado")).toBeVisible();
  await row.getByRole("button", { name: "Publicar agora" }).click();
  await expect(row.getByRole("button", { name: "Publicar agora" })).toBeEnabled();

  const res = await page.request.post("/api/jobs/publish-due", { headers: { authorization: `Bearer ${CRON}` } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.results.some((r: { outcome: string }) => r.outcome === "published")).toBe(true);

  const after = await calendarRow(page, theme);
  await expect(after.getByText("Publicado")).toBeVisible();
  await expect(after.getByRole("link", { name: "Ver no Instagram" })).toHaveAttribute("href", /instagram\.com\/p\/fake-media-/);
});

test("rotina exige o segredo do agendador", async ({ request }) => {
  expect((await request.post("/api/jobs/publish-due")).status()).toBe(401);
  expect((await request.post("/api/jobs/publish-due", { headers: { authorization: "Bearer errado" } })).status()).toBe(401);
});

test("admin vê contas, muda o modo e o botão leva ao login do Instagram", async ({ page }) => {
  await loginOk(page, "ana@aurora.local");
  await page.goto("/clinica-aurora/contas");
  const row = page.getByRole("row").filter({ hasText: "@aurora.estetica" });
  await expect(row.getByText("Conectada")).toBeVisible();
  await row.getByRole("button", { name: "Pede aprovação" }).click();
  await expect(row.getByRole("button", { name: "Pede aprovação" })).toHaveAttribute("aria-pressed", "true");
  await row.getByRole("button", { name: "Publica direto" }).click();
  await expect(row.getByRole("button", { name: "Publica direto" })).toHaveAttribute("aria-pressed", "true");

  const res = await page.request.get("/api/meta/oauth/start?tenant=clinica-aurora", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const location = new URL(res.headers()["location"]);
  expect(location.host).toBe("www.instagram.com");
  expect(location.searchParams.get("client_id")).toBe("e2e-app");
  expect(location.searchParams.get("state")).toBeTruthy();
});

test("editor não vê botão de conectar e callback sem state válido é recusado", async ({ page }) => {
  await loginOk(page, "edu@aurora.local");
  await page.goto("/clinica-aurora/contas");
  await expect(page.getByRole("heading", { name: "Contas do Instagram" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Conectar conta do Instagram" })).toHaveCount(0);

  const start = await page.request.get("/api/meta/oauth/start?tenant=clinica-aurora", { maxRedirects: 0 });
  expect(start.headers()["location"]).toContain("erro=sem_permissao");

  const cb = await page.request.get("/api/meta/oauth/callback?code=x&state=forjado.abc", { maxRedirects: 0 });
  expect(cb.headers()["location"]).toContain("erro=conexao_expirada");
});

test("outro cliente não vê os posts da Clínica Aurora", async ({ page }) => {
  await loginOk(page, "bia@belapele.local");
  await page.goto(`/bela-pele/calendario?mes=${tomorrow().month}`);
  await expect(page.getByRole("heading", { name: "Calendário" })).toBeVisible();
  await expect(page.getByText(/Direto \d+|Aprovação \d+/)).toHaveCount(0);
  await page.goto("/bela-pele/criativos");
  const options = page.getByLabel("Conta").locator("option");
  await expect(options.first()).toHaveText(/@belapele/);
  await expect(options.filter({ hasText: /aurora|clinicaaurora/ })).toHaveCount(0);
});
