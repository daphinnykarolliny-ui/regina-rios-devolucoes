import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // Integration tests share one real Postgres test schema (see tests/setupDb.ts).
    // Running test files in parallel races resetDb()/creates across files and
    // produces flaky counts, so force sequential file execution.
    fileParallelism: false,
  },
});
