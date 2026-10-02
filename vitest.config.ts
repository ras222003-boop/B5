import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "client/src/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});
