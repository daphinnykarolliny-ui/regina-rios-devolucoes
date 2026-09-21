import type { PrismaClient, CutType } from "@prisma/client";
import { metricsConfig } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveWindow(
  now: Date,
  windowDays: number,
  maturityLagDays: number,
): { start: Date; end: Date } {
  const end = new Date(now.getTime() - maturityLagDays * DAY_MS);
  const start = new Date(end.getTime() - windowDays * DAY_MS);
  return { start, end };
}

interface ProductLike {
  model: string;
  color: string | null;
  size: string | null;
  sku: string | null;
  shoeType: string | null;
}

interface ItemWithProduct {
  quantity: number;
  product: ProductLike;
}

interface ReturnWithProduct {
  mappedReason: string | null;
  matchedProduct: ProductLike | null;
}

async function computeCut(
  prisma: PrismaClient,
  cutType: CutType,
  items: ItemWithProduct[],
  returns: ReturnWithProduct[],
  keyFn: (p: ProductLike) => string,
  start: Date,
  end: Date,
): Promise<void> {
  const sold = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item.product);
    sold.set(key, (sold.get(key) ?? 0) + item.quantity);
  }

  const returned = new Map<string, number>();
  for (const r of returns) {
    if (!r.matchedProduct) continue;
    const key = keyFn(r.matchedProduct);
    returned.set(key, (returned.get(key) ?? 0) + 1);
  }

  const totalSold = [...sold.values()].reduce((a, b) => a + b, 0);
  const totalReturned = [...returned.values()].reduce((a, b) => a + b, 0);
  const overallTaxa = totalSold === 0 ? 0 : totalReturned / totalSold;

  const rows = [...sold.entries()].map(([cutValue, unitsSold]) => {
    const unitsReturned = returned.get(cutValue) ?? 0;
    const taxa = unitsSold === 0 ? 0 : unitsReturned / unitsSold;
    return {
      cutType,
      cutValue,
      windowStart: start,
      windowEnd: end,
      unitsSold,
      unitsReturned,
      taxa,
      indice: overallTaxa === 0 ? 0 : taxa / overallTaxa,
      belowMinVolume: unitsSold < metricsConfig.minVolumeThreshold,
    };
  });

  await prisma.$transaction([
    prisma.metricSnapshot.deleteMany({ where: { cutType, windowStart: start, windowEnd: end } }),
    ...rows.map((row) => prisma.metricSnapshot.create({ data: row })),
  ]);
}

async function computeReasonCut(
  prisma: PrismaClient,
  returns: ReturnWithProduct[],
  start: Date,
  end: Date,
): Promise<void> {
  const counts = new Map<string, number>();
  for (const r of returns) {
    const key = r.mappedReason ?? "NAO_MAPEADO";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const rows = [...counts.entries()].map(([cutValue, unitsReturned]) => ({
    cutType: "REASON" as CutType,
    cutValue,
    windowStart: start,
    windowEnd: end,
    unitsSold: total,
    unitsReturned,
    taxa: total === 0 ? 0 : unitsReturned / total,
    indice: 1,
    belowMinVolume: false,
  }));

  await prisma.$transaction([
    prisma.metricSnapshot.deleteMany({ where: { cutType: "REASON", windowStart: start, windowEnd: end } }),
    ...rows.map((row) => prisma.metricSnapshot.create({ data: row })),
  ]);
}

export async function computeMetricSnapshots(
  prisma: PrismaClient,
  options: { now?: Date; windowDays?: number } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 90;
  const { start, end } = resolveWindow(now, windowDays, metricsConfig.maturityLagDays);

  const items = await prisma.orderItem.findMany({
    where: { order: { createdAt: { gte: start, lt: end }, paymentStatus: "paid" } },
    include: { product: true },
  });

  const returns = await prisma.returnRequest.findMany({
    where: { requestedAt: { gte: start, lt: end } },
    include: { matchedProduct: true },
  });

  await computeCut(prisma, "SIZE", items, returns, (p) => p.size ?? "desconhecido", start, end);
  await computeCut(prisma, "COLOR", items, returns, (p) => p.color ?? "desconhecido", start, end);
  await computeCut(prisma, "MODEL", items, returns, (p) => p.model, start, end);
  await computeCut(prisma, "SKU_COLOR", items, returns, (p) => `${p.sku ?? p.model}-${p.color ?? "s/cor"}`, start, end);
  await computeCut(prisma, "SHOE_TYPE", items, returns, (p) => p.shoeType ?? "desconhecido", start, end);
  await computeReasonCut(prisma, returns, start, end);
}
