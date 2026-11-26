import { expect, test, type Page } from "@playwright/test";
import { FAKE_AI_KEY } from "./fake-ai";

const PASSWORD = "visus-dev-123";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("Visus lança créditos e o admin do cliente vê saldo, extrato e escolhe provedores", async ({ page }) => {
  await login(page, "admin@visus.local");
  await page.goto("/admin/clientes");
  await page.getByLabel("Para qual cliente").selectOption({ label: "Bela Pele Dermatologia" });
  await page.getByLabel("Créditos", { exact: true }).fill("50");
  await page.getByLabel("Motivo (opcional)").fill("Pacote de teste");
  await page.getByRole("button", { name: "Lançar créditos" }).click();
  await expect(page.getByText(/Créditos adicionados\. Novo saldo: 1\.050/)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Bela Pele Dermatologia" })).toContainText("1.050");

  await page.context().clearCookies();
  await login(page, "bia@belapele.local");
  await page.goto("/bela-pele/ia");
  await expect(page.getByRole("heading", { name: "Integrações de IA" })).toBeVisible();
  await expect(page.getByText("1.050", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Pacote de teste" })).toContainText("+50");

  // Vídeo do Reels: liga o Veo e desliga de novo
  await page.getByLabel("Vídeo do Reels").selectOption("veo");
  await page.getByRole("button", { name: "Salvar provedores" }).click();
  await expect(page.getByText("Provedores salvos.", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Vídeo do Reels")).toHaveValue("veo");
  await page.getByLabel("Vídeo do Reels").selectOption("none");
  await page.getByRole("button", { name: "Salvar provedores" }).click();
  await expect(page.getByText("Provedores salvos.", { exact: false })).toBeVisible();

  // Chave própria: conferida, guardada e removida; cobrança volta para créditos
  await page.getByLabel("Chave da API").fill(FAKE_AI_KEY);
  await page.getByRole("button", { name: "Guardar chave" }).click();
  await expect(page.getByText("Chave conferida e guardada com criptografia.")).toBeVisible();
  await page.getByText("Chave própria", { exact: true }).click();
  await page.getByRole("button", { name: "Salvar cobrança" }).click();
  await expect(page.getByText(/chaves próprias do cliente, sem gastar créditos/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("Estas chaves estão em uso.")).toBeVisible();
  await page.getByRole("row").filter({ hasText: "OpenAI (ChatGPT)" }).getByRole("button", { name: "Remover chave" }).click();
  await expect(page.getByRole("row").filter({ hasText: "OpenAI (ChatGPT)" })).toContainText("Sem chave");
  await page.getByText("Créditos da Visus", { exact: true }).click();
  await page.getByRole("button", { name: "Salvar cobrança" }).click();
  await expect(page.getByText("Agora as gerações usam os créditos da Visus.")).toBeVisible();
});

test("editor vê as integrações, mas não muda", async ({ page }) => {
  await login(page, "edu@aurora.local");
  await page.goto("/clinica-aurora/ia");
  await expect(page.getByText("Só o administrador do cliente muda estas configurações.")).toBeVisible();
  await expect(page.getByLabel("Texto (temas e legendas)")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Salvar provedores" })).toHaveCount(0);
  await expect(page.getByText("Chaves próprias")).toHaveCount(0);
});
