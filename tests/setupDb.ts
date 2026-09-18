import type { PrismaClient } from "@prisma/client";

const TABLES = [
  "MetricSnapshot",
  "SyncStatus",
  "ReasonMapping",
  "WhatsAppMessage",
  "OrderCancellation",
  "ReturnRequest",
  "OrderItem",
  "Order",
  "ProductAlias",
  "Product",
];

export async function resetDb(prisma: PrismaClient): Promise<void> {
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
  }
}
