import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["lib/**/*.test.ts"] } },
      {
        extends: true,
        test: { name: "rls", include: ["tests/rls/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
      },
    ],
  },
});
