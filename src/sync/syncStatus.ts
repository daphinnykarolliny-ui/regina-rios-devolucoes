import type { PrismaClient } from "@prisma/client";

export type SourceName = "NUVEMSHOP" | "TROQUE" | "UMBLER";
export type SyncResult = { ok: true } | { ok: false; error: string };

export async function recordSyncResult(
  prisma: PrismaClient,
  source: SourceName,
  result: SyncResult,
): Promise<void> {
  await prisma.syncStatus.upsert({
    where: { source },
    update: {
      lastRunAt: new Date(),
      ...(result.ok ? { lastSuccessAt: new Date(), lastError: null } : { lastError: result.error }),
    },
    create: {
      source,
      lastRunAt: new Date(),
      lastSuccessAt: result.ok ? new Date() : null,
      lastError: result.ok ? null : result.error,
    },
  });
}
