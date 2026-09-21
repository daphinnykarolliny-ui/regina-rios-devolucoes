import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../tests/setupDb";
import { mapReason, normalizeReasonText } from "./reasonMapping";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("normalizeReasonText", () => {
  it("trims and lowercases", () => {
    expect(normalizeReasonText("  Não Coube  ")).toBe("não coube");
  });
});

describe("mapReason", () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.reasonMapping.create({
      data: { sourceRawText: "não coube", mappedReason: "NUMERACAO", active: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("maps known raw text regardless of case/spacing", async () => {
    const result = await mapReason(prisma, "  NÃO COUBE  ");
    expect(result).toBe("NUMERACAO");
  });

  it("returns null for unknown raw text", async () => {
    const result = await mapReason(prisma, "motivo nunca visto antes");
    expect(result).toBeNull();
  });
});
