import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve("src/shared")
    }
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: "./tests/integration/globalSetup.ts",
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
