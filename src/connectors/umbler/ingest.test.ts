import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../../tests/setupDb";
import { ingestUmblerMessages } from "./ingest";
import type { UmblerRawMessage, UmblerMessageSource } from "./client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("ingestUmblerMessages", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores only inbound (customer) messages", async () => {
    const messages: UmblerRawMessage[] = [
      { id: "m1", contact_id: "c1", content: "furou o solado em uma semana", direction: "inbound", created_at: "2026-08-01T10:00:00Z" },
      { id: "m2", contact_id: "c1", content: "vamos verificar", direction: "outbound", created_at: "2026-08-01T10:05:00Z" },
    ];
    const source: UmblerMessageSource = { fetchMessagesSince: async () => messages };

    await ingestUmblerMessages(prisma, source, new Date("2026-08-01"));

    const stored = await prisma.whatsAppMessage.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].umblerMessageId).toBe("m1");
  });
});
