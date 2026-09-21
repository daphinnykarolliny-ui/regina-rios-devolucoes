import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../../tests/setupDb";
import { ingestTroqueReturnRequests } from "./ingest";
import type { TroqueRawReturnRequest, TroqueReturnSource } from "./client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("ingestTroqueReturnRequests", () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.reasonMapping.create({
      data: { sourceRawText: "não coube", mappedReason: "NUMERACAO", active: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores return requests with a mapped reason and needsReview=false", async () => {
    const raw: TroqueRawReturnRequest = {
      id: "req-1",
      order_reference: "5001",
      product_text: "Sandália Ana Preto 37",
      reason_text: "Não coube",
      type: "devolucao",
      status: "pending",
      requested_at: "2026-08-05T12:00:00Z",
    };
    const source: TroqueReturnSource = { fetchReturnRequestsSince: async () => [raw] };

    await ingestTroqueReturnRequests(prisma, source, new Date("2026-08-01"));

    const stored = await prisma.returnRequest.findUnique({ where: { troqueRequestId: "req-1" } });
    expect(stored?.mappedReason).toBe("NUMERACAO");
    expect(stored?.needsReview).toBe(false);
    expect(stored?.type).toBe("DEVOLUCAO");
  });

  it("flags needsReview when the reason has no mapping", async () => {
    const raw: TroqueRawReturnRequest = {
      id: "req-2",
      order_reference: "5002",
      product_text: "Bota X Marrom 38",
      reason_text: "motivo nunca visto",
      type: "troca",
      status: "pending",
      requested_at: "2026-08-06T12:00:00Z",
    };
    const source: TroqueReturnSource = { fetchReturnRequestsSince: async () => [raw] };

    await ingestTroqueReturnRequests(prisma, source, new Date("2026-08-01"));

    const stored = await prisma.returnRequest.findUnique({ where: { troqueRequestId: "req-2" } });
    expect(stored?.mappedReason).toBeNull();
    expect(stored?.needsReview).toBe(true);
  });
});
