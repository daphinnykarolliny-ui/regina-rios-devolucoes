import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig.json's "@/*" -> "./*" path alias so modules that use it
    // (e.g. middleware.ts, app/api/login/route.ts) resolve under vitest too.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
    // Integration tests share one real Postgres test schema (see tests/setupDb.ts).
    // Running test files in parallel races resetDb()/creates across files and
    // produces flaky counts, so force sequential file execution.
    fileParallelism: false,
  },
});
