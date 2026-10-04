import { defineConfig } from "vitest/config";
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./client/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    include: ["server/**/*.test.ts", "client/src/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});
