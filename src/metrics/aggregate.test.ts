import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../tests/setupDb";
import { computeMetricSnapshots, resolveWindow } from "./aggregate";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("resolveWindow", () => {
  it("ends maturityLagDays before now, and starts windowDays before that", () => {
    const now = new Date("2026-09-18T00:00:00Z");
    const { start, end } = resolveWindow(now, 90, 30);
    expect(end.toISOString()).toBe("2026-08-19T00:00:00.000Z");
    expect(start.toISOString()).toBe("2026-05-21T00:00:00.000Z");
  });
});

describe("computeMetricSnapshots", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("computes taxa and indice per size cut using only mature, paid orders", async () => {
    const now = new Date("2026-09-18T00:00:00Z");
    const withinWindow = new Date("2026-08-01T00:00:00Z"); // mature (before now - 30d)
    const tooRecent = new Date("2026-09-10T00:00:00Z"); // immature, excluded

    const productA = await prisma.product.create({
      data: { nuvemshopVariantId: 1n, model: "Sandália Ana", color: "Preto", size: "37" },
    });
    const productB = await prisma.product.create({
      data: { nuvemshopVariantId: 2n, model: "Sandália Ana", color: "Preto", size: "38" },
    });

    // 10 pairs sold of size 37, 2 returned -> taxa 0.2
    const orderA = await prisma.order.create({
      data: { nuvemshopOrderId: 10n, orderNumber: "A", status: "open", paymentStatus: "paid", createdAt: withinWindow },
    });
    await prisma.orderItem.create({
      data: { nuvemshopLineItemId: 100n, orderId: orderA.id, productId: productA.id, quantity: 10, unitPriceCents: 10000 },
    });
    await prisma.returnRequest.createMany({
      data: [
        { troqueRequestId: "r1", orderNumber: "A", matchedProductId: productA.id, rawProductText: "x", rawReasonText: "y", mappedReason: "NUMERACAO", type: "DEVOLUCAO", status: "done", requestedAt: withinWindow, rawPayload: {} },
        { troqueRequestId: "r2", orderNumber: "A", matchedProductId: productA.id, rawProductText: "x", rawReasonText: "y", mappedReason: "NUMERACAO", type: "DEVOLUCAO", status: "done", requestedAt: withinWindow, rawPayload: {} },
      ],
    });

    // 10 pairs sold of size 38, 0 returned -> taxa 0
    const orderB = await prisma.order.create({
      data: { nuvemshopOrderId: 11n, orderNumber: "B", status: "open", paymentStatus: "paid", createdAt: withinWindow },
    });
    await prisma.orderItem.create({
      data: { nuvemshopLineItemId: 101n, orderId: orderB.id, productId: productB.id, quantity: 10, unitPriceCents: 10000 },
    });

    // Sold too recently -> must not be counted
    const orderC = await prisma.order.create({
      data: { nuvemshopOrderId: 12n, orderNumber: "C", status: "open", paymentStatus: "paid", createdAt: tooRecent },
    });
    await prisma.orderItem.create({
      data: { nuvemshopLineItemId: 102n, orderId: orderC.id, productId: productB.id, quantity: 5, unitPriceCents: 10000 },
    });

    await computeMetricSnapshots(prisma, { now, windowDays: 90 });

    const size37 = await prisma.metricSnapshot.findFirst({ where: { cutType: "SIZE", cutValue: "37" } });
    const size38 = await prisma.metricSnapshot.findFirst({ where: { cutType: "SIZE", cutValue: "38" } });

    expect(size37?.unitsSold).toBe(10);
    expect(size37?.unitsReturned).toBe(2);
    expect(size37?.taxa).toBeCloseTo(0.2);

    expect(size38?.unitsSold).toBe(10); // the 5 from orderC must be excluded (too recent)
    expect(size38?.unitsReturned).toBe(0);
    expect(size38?.taxa).toBe(0);

    // overall taxa = 2 / 20 = 0.1, so size37's indice = 0.2 / 0.1 = 2.0
    expect(size37?.indice).toBeCloseTo(2.0);
  });
});
