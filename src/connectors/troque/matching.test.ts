import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../../tests/setupDb";
import { pickBestMatch, matchReturnRequestsToProducts } from "./matching";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("pickBestMatch", () => {
  const items = [
    { productId: "p1", product: { model: "Sandália Ana", color: "Preto", size: "37" } },
    { productId: "p2", product: { model: "Bota Clara", color: "Marrom", size: "38" } },
  ];

  it("picks the clearly closer item", () => {
    const result = pickBestMatch("Sandália Ana Preto 37", items);
    expect(result?.productId).toBe("p1");
  });

  it("returns null when no item is close enough", () => {
    const result = pickBestMatch("Tênis Runner Azul 40", items);
    expect(result).toBeNull();
  });
});

describe("matchReturnRequestsToProducts", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedOrderWithItems(
    orderNumber: string,
    items: { variantId: bigint; model: string; color: string; size: string }[],
  ) {
    const order = await prisma.order.create({
      data: {
        nuvemshopOrderId: BigInt(Math.floor(Math.random() * 1_000_000)),
        orderNumber,
        status: "open",
        paymentStatus: "paid",
        createdAt: new Date("2026-08-01"),
      },
    });
    for (const item of items) {
      const product = await prisma.product.create({
        data: { nuvemshopVariantId: item.variantId, model: item.model, color: item.color, size: item.size },
      });
      await prisma.orderItem.create({
        data: {
          nuvemshopLineItemId: item.variantId,
          orderId: order.id,
          productId: product.id,
          quantity: 1,
          unitPriceCents: 10000,
        },
      });
    }
    return order;
  }

  it("auto-matches when the order has a single item", async () => {
    await seedOrderWithItems("6001", [
      { variantId: 1n, model: "Sandália Ana", color: "Preto", size: "37" },
    ]);
    await prisma.returnRequest.create({
      data: {
        troqueRequestId: "r1",
        orderNumber: "6001",
        rawProductText: "qualquer coisa",
        rawReasonText: "não coube",
        type: "DEVOLUCAO",
        status: "pending",
        requestedAt: new Date("2026-08-05"),
        rawPayload: {},
      },
    });

    await matchReturnRequestsToProducts(prisma);

    const updated = await prisma.returnRequest.findUnique({ where: { troqueRequestId: "r1" } });
    expect(updated?.matchedProductId).not.toBeNull();
    expect(updated?.needsReview).toBe(false);
  });

  it("flags ambiguous multi-item matches for review instead of guessing", async () => {
    await seedOrderWithItems("6002", [
      { variantId: 2n, model: "Sandália Ana", color: "Preto", size: "37" },
      { variantId: 3n, model: "Sandália Ana", color: "Preto", size: "38" },
    ]);
    await prisma.returnRequest.create({
      data: {
        troqueRequestId: "r2",
        orderNumber: "6002",
        rawProductText: "Sandália Ana",
        rawReasonText: "não coube",
        type: "DEVOLUCAO",
        status: "pending",
        requestedAt: new Date("2026-08-05"),
        rawPayload: {},
      },
    });

    await matchReturnRequestsToProducts(prisma);

    const updated = await prisma.returnRequest.findUnique({ where: { troqueRequestId: "r2" } });
    expect(updated?.matchedProductId).toBeNull();
    expect(updated?.needsReview).toBe(true);
  });

  it("uses a ProductAlias cache hit and sets matchedOrderId when the aliased product belongs to the order", async () => {
    const order = await seedOrderWithItems("6003", [
      { variantId: 4n, model: "Sandália Ana", color: "Preto", size: "37" },
    ]);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.productAlias.create({
      data: {
        source: "TROQUE",
        rawText: "sandalia cache hit",
        productId: item.productId,
        confidence: 1.0,
      },
    });
    await prisma.returnRequest.create({
      data: {
        troqueRequestId: "r3",
        orderNumber: "6003",
        rawProductText: "Sandalia Cache Hit",
        rawReasonText: "não coube",
        type: "DEVOLUCAO",
        status: "pending",
        requestedAt: new Date("2026-08-05"),
        rawPayload: {},
      },
    });

    await matchReturnRequestsToProducts(prisma);

    const updated = await prisma.returnRequest.findUnique({ where: { troqueRequestId: "r3" } });
    expect(updated?.matchedOrderId).toBe(order.id);
    expect(updated?.matchedProductId).toBe(item.productId);
    expect(updated?.needsReview).toBe(false);
  });

  it("ignores a ProductAlias cache hit when the aliased product does not belong to this order, falling back to normal matching", async () => {
    const otherOrder = await seedOrderWithItems("6004", [
      { variantId: 5n, model: "Bota Clara", color: "Marrom", size: "38" },
    ]);
    const otherItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId: otherOrder.id } });
    await prisma.productAlias.create({
      data: {
        source: "TROQUE",
        rawText: "produto de outro pedido",
        productId: otherItem.productId,
        confidence: 1.0,
      },
    });

    const order = await seedOrderWithItems("6005", [
      { variantId: 6n, model: "Sandália Ana", color: "Preto", size: "37" },
    ]);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.returnRequest.create({
      data: {
        troqueRequestId: "r4",
        orderNumber: "6005",
        rawProductText: "Produto De Outro Pedido",
        rawReasonText: "não coube",
        type: "DEVOLUCAO",
        status: "pending",
        requestedAt: new Date("2026-08-05"),
        rawPayload: {},
      },
    });

    await matchReturnRequestsToProducts(prisma);

    const updated = await prisma.returnRequest.findUnique({ where: { troqueRequestId: "r4" } });
    expect(updated?.matchedOrderId).toBe(order.id);
    expect(updated?.matchedProductId).toBe(item.productId);
    expect(updated?.needsReview).toBe(false);
  });
});
