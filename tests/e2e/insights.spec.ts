import { expect, test, type Page } from "@playwright/test";
import { service } from "../rls/helpers";
import { FAKE_AI_KEY } from "./fake-ai";

const PASSWORD = "visus-dev-123";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Próxima quinta 12:00 em São Paulo (sempre no futuro). */
function nextThursdayNoon() {
  for (let i = 2; i < 10; i++) {
    const d = new Date(Date.now() + i * 86_400_000);
    if (new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(d) === "Thu") {
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
      return { date, iso: new Date(`${date}T12:00:00-03:00`).toISOString(), moved: new Date(`${date}T18:00:00-03:00`).toISOString() };
    }
  }
  throw new Error("sem quinta");
}

test("admin lê as métricas pela Meta, vê o mapa de calor, pede a análise e move o horário no plano", async ({ page }) => {
  test.setTimeout(90_000);
  const { data: tenant } = await service.from("tenants").select("id").eq("slug", "bela-pele").single();
  const { data: acc } = await service.from("ig_accounts").select("id").eq("tenant_id", tenant!.id).eq("username", "belapele").single();
  // Estado limpo para rodar de novo
  await service.from("ig_media").delete().eq("ig_account_id", acc!.id);
  await service.from("analysis_findings").delete().eq("ig_account_id", acc!.id);
  await service.from("audience_snapshots").delete().eq("ig_account_id", acc!.id);
  await service.from("posts").delete().eq("ig_account_id", acc!.id).eq("theme", "Post das 12h");
  await service.rpc("store_platform_ai_key", { p_provider: "openai", p_key: FAKE_AI_KEY });
  const when = nextThursdayNoon();
  const { data: planned } = await service
    .from("posts")
    .insert({ tenant_id: tenant!.id, ig_account_id: acc!.id, scheduled_at: when.iso, theme: "Post das 12h", format: "image", status: "planned" })
    .select("id")
    .single();

  await login(page, "bia@belapele.local");
  await page.goto("/bela-pele/insights");
  await expect(page.getByText("Ainda não há métricas de @belapele", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Atualizar métricas" }).click();
  await expect(page.getByText("Métricas de 8 publicação(ões) atualizadas.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Engajamento por dia e horário" })).toBeVisible();
  const resumo = page.getByRole("region", { name: "Resumo" });
  await expect(resumo.getByText("Curtidas")).toBeVisible();
  await expect(resumo.getByText("320", { exact: true })).toBeVisible(); // 4 × 60 + 4 × 20
  // Terça 18–21h: 4 posts com (60 + 8 + 5 + 3) / 1000 = 7,6%
  await expect(page.getByTitle("Ter, 18h–21h: 4 post(s), 7,6%")).toHaveText("7,6%");
  await expect(page.getByText("Principais cidades: Curitiba, São José dos Pinhais")).toBeVisible();
  await expect(page.getByRole("link", { name: "Caso real com números 0" })).toBeVisible();

  await page.getByRole("button", { name: "Analisar agora" }).click();
  await expect(page.getByText("2 achado(s) novo(s).")).toBeVisible();
  await expect(page.getByText("Terça às 18h rende o triplo de segunda às 12h")).toBeVisible();
  await expect(page.getByText("1 post(s) futuro(s) marcado(s) às 12h.")).toBeVisible();
  await expect(page.getByText("A IA passa a priorizar esse ângulo", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Mover das 12h para as 18h" }).click();
  await expect(page.getByText("1 post(s) atualizado(s) no plano.")).toBeVisible();
  await expect(page.getByText("Horários atualizados")).toBeVisible();

  const { data: after } = await service.from("posts").select("scheduled_at").eq("id", planned!.id).single();
  expect(new Date(after!.scheduled_at).toISOString()).toBe(when.moved);
  const { data: events } = await service.from("post_events").select("note").eq("post_id", planned!.id);
  expect(events?.some((e) => e.note?.includes("12:00 para 18:00"))).toBe(true);
});

test("aprovador vê os insights mas não pede análise nem muda o plano", async ({ page }) => {
  await login(page, "dra.lucia@aurora.local");
  await page.goto("/clinica-aurora/insights");
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Atualizar métricas" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analisar agora" })).toHaveCount(0);
});
