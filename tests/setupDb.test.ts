import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "./setupDb";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("resetDb", () => {
  beforeAll(async () => {
    await prisma.product.create({
      data: { nuvemshopVariantId: 1n, model: "Sandália Teste" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("removes all rows from every table", async () => {
    await resetDb(prisma);
    const count = await prisma.product.count();
    expect(count).toBe(0);
  });
});
