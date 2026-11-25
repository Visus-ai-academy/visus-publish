import { defineConfig, devices } from "@playwright/test";

// Pré-requisitos: `supabase start`, `supabase db reset`, `pnpm db:seed` e .env.local preenchido.
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    locale: "pt-BR",
    trace: "off",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3000",
    // Meta e Metricool simulados e segredos de teste (nunca use estes valores fora do ambiente local)
    env: {
      META_APP_ID: "e2e-app",
      META_APP_SECRET: "e2e-secret",
      META_REDIRECT_URI: "http://127.0.0.1:3000/api/meta/oauth/callback",
      META_GRAPH_BASE_URL: "http://127.0.0.1:54399",
      METRICOOL_BASE_URL: "http://127.0.0.1:54398",
      OAUTH_STATE_SECRET: "e2e-oauth-state-secret-com-32-caracteres",
      CRON_SECRET: "e2e-cron-secret-com-pelo-menos-32-caracteres",
    },
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
