import type { PrismaClient } from "@prisma/client";
import type { NuvemshopOrdersSource, NuvemshopProduct } from "../connectors/nuvemshop/client";
import type { TroqueReturnSource } from "../connectors/troque/client";
import type { UmblerMessageSource } from "../connectors/umbler/client";
import { ingestNuvemshopOrders, syncProductCategories } from "../connectors/nuvemshop/ingest";
import { ingestTroqueReturnRequests } from "../connectors/troque/ingest";
import { matchReturnRequestsToProducts } from "../connectors/troque/matching";
import { syncOrderCancellations } from "../connectors/nuvemshop/cancellations";
import { ingestUmblerMessages } from "../connectors/umbler/ingest";
import { computeMetricSnapshots } from "../metrics/aggregate";
import { withRetry } from "./withRetry";
import { recordSyncResult, type SourceName } from "./syncStatus";

export interface RunSyncDeps {
  nuvemshop: NuvemshopOrdersSource;
  nuvemshopProducts: { fetchProducts(): Promise<NuvemshopProduct[]> };
  troque: TroqueReturnSource;
  umbler: UmblerMessageSource;
}

async function runSource(prisma: PrismaClient, source: SourceName, fn: () => Promise<void>): Promise<void> {
  try {
    await withRetry(fn);
    await recordSyncResult(prisma, source, { ok: true });
  } catch (err) {
    await recordSyncResult(prisma, source, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runSync(prisma: PrismaClient, deps: RunSyncDeps): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await runSource(prisma, "NUVEMSHOP", async () => {
    const touchedVariants = await ingestNuvemshopOrders(prisma, deps.nuvemshop, since);
    await syncProductCategories(prisma, deps.nuvemshopProducts, touchedVariants);
  });
  await runSource(prisma, "TROQUE", async () => {
    await ingestTroqueReturnRequests(prisma, deps.troque, since);
    await matchReturnRequestsToProducts(prisma);
  });
  await runSource(prisma, "UMBLER", () => ingestUmblerMessages(prisma, deps.umbler, since));

  await syncOrderCancellations(prisma);
  await computeMetricSnapshots(prisma);
}
