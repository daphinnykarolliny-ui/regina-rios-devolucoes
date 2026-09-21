import type { PrismaClient, Prisma } from "@prisma/client";
import type { TroqueRawReturnRequest, TroqueReturnSource } from "./client";
import { mapReason } from "../../taxonomy/reasonMapping";

export async function ingestTroqueReturnRequests(
  prisma: PrismaClient,
  source: TroqueReturnSource,
  since: Date,
): Promise<void> {
  const raw = await source.fetchReturnRequestsSince(since);

  for (const item of raw) {
    const mappedReason = await mapReason(prisma, item.reason_text);
    const type = item.type === "troca" ? "TROCA" : "DEVOLUCAO";
    const payload = item as unknown as Prisma.InputJsonValue;

    await prisma.returnRequest.upsert({
      where: { troqueRequestId: item.id },
      update: {
        orderNumber: item.order_reference,
        rawProductText: item.product_text,
        rawReasonText: item.reason_text,
        mappedReason,
        type,
        status: item.status,
        rawPayload: payload,
      },
      create: {
        troqueRequestId: item.id,
        orderNumber: item.order_reference,
        rawProductText: item.product_text,
        rawReasonText: item.reason_text,
        mappedReason,
        type,
        status: item.status,
        requestedAt: new Date(item.requested_at),
        needsReview: mappedReason === null,
        rawPayload: payload,
      },
    });
  }
}
