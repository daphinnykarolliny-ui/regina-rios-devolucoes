import type { PrismaClient, Prisma } from "@prisma/client";
import type { UmblerMessageSource } from "./client";

export async function ingestUmblerMessages(
  prisma: PrismaClient,
  source: UmblerMessageSource,
  since: Date,
): Promise<void> {
  const raw = await source.fetchMessagesSince(since);

  for (const msg of raw) {
    if (msg.direction !== "inbound") continue;
    await prisma.whatsAppMessage.upsert({
      where: { umblerMessageId: msg.id },
      update: { text: msg.content },
      create: {
        umblerMessageId: msg.id,
        customerRef: msg.contact_id,
        text: msg.content,
        createdAt: new Date(msg.created_at),
        rawPayload: msg as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
