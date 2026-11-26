import { expect, test, type Page } from "@playwright/test";
import { shiftMonth, utcToZoned } from "../../lib/time";
import { FAKE_AI_KEY } from "./fake-ai";

const PASSWORD = "visus-dev-123";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("admin vê os modelos do provedor para texto e arte", async ({ page }) => {
  await login(page, "admin@visus.local");
  await page.goto("/admin/ia");
  await page.getByLabel("Chave da API").fill(FAKE_AI_KEY);
  await page.getByRole("button", { name: "Guardar chave" }).click();
  await expect(page.getByText("Chave conferida e guardada com criptografia.")).toBeVisible();
  await page.reload();
  const text = page.getByLabel("Texto (tema e legenda), OpenAI (ChatGPT)");
  await expect(text.locator("option")).toContainText(["gpt-4.1-mini", "gpt-5-mini"]);
  await expect(text.locator("option", { hasText: "whisper-1" })).toHaveCount(0);
  await expect(page.getByLabel("Arte (imagem), OpenAI (ChatGPT)").locator("option")).toContainText(["gpt-image-1"]);
  await text.selectOption("gpt-5-mini");
  await page.getByRole("row").filter({ hasText: "OpenAI" }).getByRole("button", { name: "Salvar" }).first().click();
  await expect(page.getByText("Modelo salvo.")).toBeVisible();
  await text.selectOption("gpt-4.1-mini");
  await page.getByRole("row").filter({ hasText: "OpenAI" }).getByRole("button", { name: "Salvar" }).first().click();
});

test("editor pede temas do mês, gera legendas e artes e envia o vídeo do Reels", async ({ page }) => {
  test.setTimeout(90_000);
  const month = shiftMonth(utcToZoned(new Date(), "America/Sao_Paulo").date.slice(0, 7), 1);
  await login(page, "edu@aurora.local");
  await page.goto(`/clinica-aurora/planejamento?mes=${month}`);
  await expect(page.getByRole("heading", { name: /Plano de .* · @aurora\.estetica/ })).toBeVisible();

  await page.getByRole("button", { name: /Sugerir temas para/ }).click();
  await expect(page.getByText("2 temas adicionados.", { exact: false })).toBeVisible();
  const foto = page.getByRole("row").filter({ hasText: "Mitos sobre clareamento" }).first();
  const reels = page.getByRole("row").filter({ hasText: "Um dia na recepção" }).first();
  await expect(foto.getByText("Planejado")).toBeVisible();

  await page.getByRole("button", { name: "Gerar legendas e criativos" }).click();
  await expect(foto.getByText("Agendado")).toBeVisible({ timeout: 30_000 });
  await expect(reels.getByText("Aguardando vídeo")).toBeVisible();
  await expect(foto.getByText("OpenAI (ChatGPT)")).toBeVisible();

  await reels.getByRole("link", { name: "Abrir" }).click();
  await expect(page.getByLabel("Legenda")).toHaveValue(/Agende sua avaliação/);
  await page.getByLabel("Vídeo do Reels").setInputFiles({ name: "reels.mp4", mimeType: "video/mp4", buffer: Buffer.from("fake-video") });
  await page.getByRole("button", { name: "Enviar e agendar" }).click();
  await expect(page.locator("video")).toBeVisible();
  await expect(page.getByRole("link", { name: "Voltar ao planejamento" }).locator("..").getByText("Agendado")).toBeVisible();
});
