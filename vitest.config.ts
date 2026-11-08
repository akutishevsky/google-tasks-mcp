import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/support/invariants-setup.ts"],
    env: { TZ: "UTC" },
    testTimeout: 15000,
  },
});
