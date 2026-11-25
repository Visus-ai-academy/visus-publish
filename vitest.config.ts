import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["lib/**/*.test.ts"] } },
      {
        extends: true,
        // Um arquivo por vez: os testes de fila mexem em posts vencidos do banco inteiro.
        test: { name: "rls", include: ["tests/rls/**/*.test.ts"], fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 },
      },
    ],
  },
});
