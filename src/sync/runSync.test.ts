import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../tests/setupDb";
import { runSync } from "./runSync";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("runSync", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    "isolates a failing source from the others and records status for each",
    async () => {
      await runSync(prisma, {
        nuvemshop: { fetchOrdersSince: async () => [] },
        nuvemshopProducts: { fetchProducts: async () => [] },
        troque: {
          fetchReturnRequestsSince: async () => {
            throw new Error("Troque Commerce is down");
          },
        },
        umbler: { fetchMessagesSince: async () => [] },
      });

      const statuses = await prisma.syncStatus.findMany();
      const bySource = Object.fromEntries(statuses.map((s) => [s.source, s]));

      expect(bySource.NUVEMSHOP.lastError).toBeNull();
      expect(bySource.TROQUE.lastError).toContain("Troque Commerce is down");
      expect(bySource.UMBLER.lastError).toBeNull();
    },
    // withRetry's default options retry the failing TROQUE source 3 times with
    // exponential backoff (1s + 2s + 4s = 7s of delay) before giving up, which
    // exceeds Vitest's 5s default test timeout.
    15000,
  );
});
