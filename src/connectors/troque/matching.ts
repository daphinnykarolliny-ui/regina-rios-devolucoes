import type { PrismaClient } from "@prisma/client";

export interface MatchableItem {
  productId: string;
  product: { model: string; color: string | null; size: string | null };
}

function similarityScore(a: string, b: string): number {
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  const intersection = [...aTokens].filter((t) => bTokens.has(t)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function pickBestMatch(productText: string, items: MatchableItem[]): { productId: string } | null {
  const normalized = productText.trim().toLowerCase();
  const scored = items
    .map((item) => {
      const haystack = `${item.product.model} ${item.product.color ?? ""} ${item.product.size ?? ""}`.toLowerCase();
      return { productId: item.productId, score: similarityScore(normalized, haystack) };
    })
    .sort((a, b) => b.score - a.score);

  const [top, second] = scored;
  if (!top || top.score < 0.5) return null;
  if (second && top.score - second.score < 0.15) return null;
  return { productId: top.productId };
}

export async function matchReturnRequestsToProducts(prisma: PrismaClient): Promise<void> {
  const pending = await prisma.returnRequest.findMany({ where: { matchedProductId: null } });

  for (const rr of pending) {
    const alias = await prisma.productAlias.findUnique({
      where: { source_rawText: { source: "TROQUE", rawText: rr.rawProductText.trim().toLowerCase() } },
    });
    if (alias) {
      await prisma.returnRequest.update({
        where: { id: rr.id },
        data: { matchedProductId: alias.productId, needsReview: false },
      });
      continue;
    }

    const order = await prisma.order.findUnique({
      where: { orderNumber: rr.orderNumber },
      include: { items: { include: { product: true } } },
    });
    if (!order) continue;

    if (order.items.length === 1) {
      const [item] = order.items;
      await prisma.$transaction([
        prisma.returnRequest.update({
          where: { id: rr.id },
          data: { matchedOrderId: order.id, matchedProductId: item.productId, needsReview: false },
        }),
        prisma.productAlias.upsert({
          where: { source_rawText: { source: "TROQUE", rawText: rr.rawProductText.trim().toLowerCase() } },
          update: {},
          create: {
            source: "TROQUE",
            rawText: rr.rawProductText.trim().toLowerCase(),
            productId: item.productId,
            confidence: 1.0,
          },
        }),
      ]);
      continue;
    }

    const best = pickBestMatch(rr.rawProductText, order.items);
    if (best) {
      await prisma.returnRequest.update({
        where: { id: rr.id },
        data: { matchedOrderId: order.id, matchedProductId: best.productId, needsReview: false },
      });
    } else {
      await prisma.returnRequest.update({
        where: { id: rr.id },
        data: { matchedOrderId: order.id, needsReview: true },
      });
    }
  }
}
