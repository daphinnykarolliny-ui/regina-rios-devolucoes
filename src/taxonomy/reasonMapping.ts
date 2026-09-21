import type { PrismaClient, ReasonCategory } from "@prisma/client";

export function normalizeReasonText(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function mapReason(
  prisma: PrismaClient,
  rawReasonText: string,
): Promise<ReasonCategory | null> {
  const normalized = normalizeReasonText(rawReasonText);
  const mapping = await prisma.reasonMapping.findFirst({
    where: { sourceRawText: normalized, active: true },
  });
  return mapping?.mappedReason ?? null;
}
