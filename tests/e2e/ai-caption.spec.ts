import { expect, test, type Page } from "@playwright/test";
import { FAKE_AI_KEY, FAKE_AI_PORT } from "./fake-ai";

const PASSWORD = "visus-dev-123";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("admin guarda a chave de IA e o editor gera tema e legenda a partir da imagem", async ({ page, browser }) => {
  await login(page, "admin@visus.local");
  await page.goto("/admin/ia");
  await expect(page.getByRole("heading", { name: "IA da plataforma" })).toBeVisible();
  await page.getByLabel("Chave da API").fill("sk-chave-errada-000000000000");
  await page.getByRole("button", { name: "Guardar chave" }).click();
  await expect(page.getByText("A chave foi recusada pelo provedor")).toBeVisible();
  await page.getByLabel("Chave da API").fill(FAKE_AI_KEY);
  await page.getByRole("button", { name: "Guardar chave" }).click();
  await expect(page.getByText("Chave conferida e guardada com criptografia.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "OpenAI" }).getByText(/Guardada em/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(FAKE_AI_KEY);

  const editor = await (await browser.newContext()).newPage();
  await login(editor, "edu@aurora.local");
  await editor.goto("/clinica-aurora/criativos");
  await expect(editor.getByRole("heading", { name: "Criativos prontos" })).toBeVisible();
  const gen = editor.getByRole("button", { name: "Gerar tema e legenda com IA" });
  await expect(gen).toBeDisabled();
  await editor.getByLabel("Formato").selectOption("reels");
  await editor.getByLabel("Selecione fotos, vídeos ou artes prontas").setInputFiles({ name: "arte.png", mimeType: "image/png", buffer: PNG });
  await expect(editor.getByText("Formato ajustado para Foto pelo tipo de arquivo.")).toBeVisible();
  await editor.getByLabel("Tema").fill("mostrar a recepção");
  await gen.click();
  await expect(editor.getByLabel("Tema")).toHaveValue("Bastidores do atendimento");
  await expect(editor.getByLabel("Legenda")).toHaveValue(/Agende sua avaliação\.\n\n.*#bastidores #clinica/);
  await expect(editor.getByText("Texto gerado com IA. Revise antes de agendar.")).toBeVisible();

  const sent = await (await fetch(`http://127.0.0.1:${FAKE_AI_PORT}/__last`)).json();
  const parts = sent.messages[1].content;
  expect(parts[0].text).toContain("mostrar a recepção");
  expect(parts[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);

  await editor.getByRole("button", { name: "Agendar" }).click();
  await expect(editor.getByText(/Post (agendado|enviado para aprovação)\./)).toBeVisible();
  await expect(editor.getByRole("row").filter({ hasText: "Bastidores do atendimento" }).first()).toBeVisible();
});
