import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../../tests/setupDb";
import { syncOrderCancellations, isPaymentFailureCancellation } from "./cancellations";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("isPaymentFailureCancellation", () => {
  it("is true for cancelled status or voided/abandoned payment", () => {
    expect(isPaymentFailureCancellation({ status: "cancelled", paymentStatus: "pending" })).toBe(true);
    expect(isPaymentFailureCancellation({ status: "open", paymentStatus: "voided" })).toBe(true);
    expect(isPaymentFailureCancellation({ status: "open", paymentStatus: "paid" })).toBe(false);
  });
});

describe("syncOrderCancellations", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a cancellation only for cancelled/failed-payment orders", async () => {
    await prisma.order.create({
      data: {
        nuvemshopOrderId: 1n,
        orderNumber: "7001",
        status: "cancelled",
        paymentStatus: "pending",
        createdAt: new Date("2026-08-01"),
      },
    });
    await prisma.order.create({
      data: {
        nuvemshopOrderId: 2n,
        orderNumber: "7002",
        status: "open",
        paymentStatus: "paid",
        createdAt: new Date("2026-08-01"),
      },
    });

    await syncOrderCancellations(prisma);

    const cancellations = await prisma.orderCancellation.findMany();
    expect(cancellations).toHaveLength(1);
  });
});
