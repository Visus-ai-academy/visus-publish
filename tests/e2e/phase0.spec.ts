import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "visus-dev-123";

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function loginOk(page: Page, email: string) {
  await login(page, email);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("sem login vai para a tela de entrar", async ({ page }) => {
  await page.goto("/clinica-aurora/calendario");
  await expect(page).toHaveURL(/\/login\?next=%2Fclinica-aurora%2Fcalendario/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
});

test("senha errada mostra erro", async ({ page }) => {
  await login(page, "ana@aurora.local", "senha-errada-123");
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});

test("membro de A entra no próprio cliente e não acessa B", async ({ page }) => {
  await loginOk(page, "ana@aurora.local");
  await expect(page).toHaveURL(/\/clinica-aurora\/calendario$/);
  await expect(page.getByRole("heading", { name: "Calendário" })).toBeVisible();

  const options = page.getByLabel("Cliente").locator("option");
  await expect(options).toHaveText(["Clínica Aurora"]);

  await page.goto("/bela-pele/calendario");
  await expect(page.getByText("Cliente não encontrado")).toBeVisible();
  await expect(page.getByText("Bela Pele Dermatologia")).toHaveCount(0);

  await page.goto("/bela-pele/equipe");
  await expect(page.getByText("bia@belapele.local")).toHaveCount(0);
});

test("admin convida, convidado cria conta e entra só no cliente certo", async ({ page, browser }) => {
  const email = `novo-${Date.now()}@aurora.local`;
  await loginOk(page, "ana@aurora.local");
  await page.getByRole("link", { name: "Equipe" }).click();
  await expect(page.getByRole("heading", { name: "Equipe" })).toBeVisible();
  // O Next mantém a tela de login anterior escondida no DOM; mire o campo do convite.
  await page.getByPlaceholder("nome@clinica.com.br").fill(email);
  await page.getByLabel("Papel").selectOption("approver");
  await page.getByRole("button", { name: "Convidar" }).click();
  const link = await page.getByLabel("Link do convite").inputValue();
  expect(link).toMatch(/\/convite\//);

  const guest = await browser.newPage();
  await guest.goto(link);
  await expect(guest.getByLabel("Crie uma senha")).toBeEditable();
  await expect(guest.getByRole("heading", { name: "Convite para Clínica Aurora" })).toBeVisible();
  await guest.getByLabel("Crie uma senha").fill("senha-do-convidado-1");
  await guest.getByRole("button", { name: "Criar conta e entrar" }).click();
  await expect(guest).toHaveURL(/\/clinica-aurora\/calendario$/);

  await guest.goto("/clinica-aurora/equipe");
  await expect(guest.getByRole("cell", { name: email })).toBeVisible();
  // aprovador não vê o formulário de convite
  await expect(guest.getByRole("button", { name: "Convidar" })).toHaveCount(0);

  await guest.goto(link);
  await expect(guest.getByText("Convite inválido ou expirado")).toBeVisible();
});

test("editor não vê a área de clientes da plataforma", async ({ page }) => {
  await loginOk(page, "edu@aurora.local");
  await expect(page).toHaveURL(/\/clinica-aurora\/calendario$/);
  await expect(page.getByRole("link", { name: "Clientes" })).toHaveCount(0);
  await page.goto("/admin/clientes");
  await expect(page.getByRole("heading", { name: "Clientes" })).toHaveCount(0);
});

test("admin da plataforma cria cliente e recebe o link do administrador", async ({ page }) => {
  const name = `Clínica Teste ${Date.now()}`;
  await loginOk(page, "admin@visus.local");
  await page.goto("/admin/clientes");
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await page.getByLabel("Nome do cliente").fill(name);
  await page.getByLabel("E-mail do administrador").fill(`dono-${Date.now()}@teste.local`);
  await page.getByRole("button", { name: "Criar cliente" }).click();
  await expect(page.getByLabel("Link do convite")).toHaveValue(/\/convite\//);
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
});
