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
    // All files share the one emulator started by globalSetup, and Service Bus peek
    // cursors are global per entity — parallel workers stepping on each other is a real
    // flakiness source, not a hypothetical.
    fileParallelism: false,
  },
});
