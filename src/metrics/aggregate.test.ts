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

  it("excludes order items from cancelled orders even when paymentStatus is paid", async () => {
    const now = new Date("2026-09-18T00:00:00Z");
    const withinWindow = new Date("2026-08-01T00:00:00Z");

    // Store cancelled this order after payment was already captured: status "cancelled"
    // but paymentStatus still "paid", with an OrderCancellation row (as syncOrderCancellations
    // would produce). Its items must never count as "vendido".
    const product = await prisma.product.create({
      data: { nuvemshopVariantId: 3n, model: "Sandália Bia", color: "Preto", size: "39" },
    });
    const order = await prisma.order.create({
      data: { nuvemshopOrderId: 20n, orderNumber: "D", status: "cancelled", paymentStatus: "paid", createdAt: withinWindow },
    });
    await prisma.orderItem.create({
      data: { nuvemshopLineItemId: 200n, orderId: order.id, productId: product.id, quantity: 7, unitPriceCents: 10000 },
    });
    await prisma.orderCancellation.create({
      data: { orderId: order.id, reason: "cancelled", cancelledAt: withinWindow },
    });

    await computeMetricSnapshots(prisma, { now, windowDays: 90 });

    // size "39" is unique to this cancelled order's product: if its items were (wrongly)
    // counted, a SIZE/39 snapshot would exist. It must not.
    const size39 = await prisma.metricSnapshot.findFirst({ where: { cutType: "SIZE", cutValue: "39" } });
    expect(size39).toBeNull();
  });

  it("buckets returns with no mapped reason under NAO_MAPEADO in the REASON cut", async () => {
    const now = new Date("2026-09-18T00:00:00Z");
    const withinWindow = new Date("2026-08-01T00:00:00Z");

    await prisma.returnRequest.create({
      data: {
        troqueRequestId: "r-unmapped",
        orderNumber: "Z",
        rawProductText: "x",
        rawReasonText: "motivo estranho",
        mappedReason: null,
        type: "TROCA",
        status: "done",
        requestedAt: withinWindow,
        rawPayload: {},
      },
    });

    await computeMetricSnapshots(prisma, { now, windowDays: 90 });

    const naoMapeado = await prisma.metricSnapshot.findFirst({ where: { cutType: "REASON", cutValue: "NAO_MAPEADO" } });
    expect(naoMapeado?.unitsReturned).toBe(1);
  });

  it("flags belowMinVolume under the threshold and clears it at/above the threshold", async () => {
    const now = new Date("2026-09-18T00:00:00Z");
    const withinWindow = new Date("2026-08-01T00:00:00Z");

    const lowProduct = await prisma.product.create({
      data: { nuvemshopVariantId: 4n, model: "Sandália Cia", color: "Preto", size: "40" },
    });
    const highProduct = await prisma.product.create({
      data: { nuvemshopVariantId: 5n, model: "Sandália Cia", color: "Preto", size: "41" },
    });

    const lowOrder = await prisma.order.create({
      data: { nuvemshopOrderId: 30n, orderNumber: "E", status: "open", paymentStatus: "paid", createdAt: withinWindow },
    });
    await prisma.orderItem.create({
      data: { nuvemshopLineItemId: 300n, orderId: lowOrder.id, productId: lowProduct.id, quantity: 10, unitPriceCents: 10000 },
    });

    const highOrder = await prisma.order.create({
      data: { nuvemshopOrderId: 31n, orderNumber: "F", status: "open", paymentStatus: "paid", createdAt: withinWindow },
    });
    await prisma.orderItem.create({
      data: { nuvemshopLineItemId: 301n, orderId: highOrder.id, productId: highProduct.id, quantity: 20, unitPriceCents: 10000 },
    });

    await computeMetricSnapshots(prisma, { now, windowDays: 90 });

    const size40 = await prisma.metricSnapshot.findFirst({ where: { cutType: "SIZE", cutValue: "40" } });
    const size41 = await prisma.metricSnapshot.findFirst({ where: { cutType: "SIZE", cutValue: "41" } });

    // metricsConfig.minVolumeThreshold defaults to 15 (from METRICS_MIN_VOLUME_THRESHOLD=15 in .env)
    expect(size40?.unitsSold).toBe(10);
    expect(size40?.belowMinVolume).toBe(true);

    expect(size41?.unitsSold).toBe(20);
    expect(size41?.belowMinVolume).toBe(false);
  });
});
