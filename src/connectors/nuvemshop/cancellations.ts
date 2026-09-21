import type { PrismaClient } from "@prisma/client";

const FAILED_PAYMENT_STATUSES = new Set(["voided", "abandoned"]);

export function isPaymentFailureCancellation(order: { status: string; paymentStatus: string }): boolean {
  return order.status === "cancelled" || FAILED_PAYMENT_STATUSES.has(order.paymentStatus);
}

export async function syncOrderCancellations(prisma: PrismaClient): Promise<void> {
  const orders = await prisma.order.findMany({
    where: {
      OR: [{ status: "cancelled" }, { paymentStatus: { in: [...FAILED_PAYMENT_STATUSES] } }],
    },
  });

  for (const order of orders) {
    await prisma.orderCancellation.upsert({
      where: { orderId: order.id },
      update: {},
      create: {
        orderId: order.id,
        reason: order.status === "cancelled" ? "cancelled" : order.paymentStatus,
        cancelledAt: order.createdAt,
      },
    });
  }
}
