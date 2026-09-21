import type { PrismaClient } from "@prisma/client";
import type { NuvemshopOrder, NuvemshopOrdersSource, NuvemshopProduct } from "./client";
import { extractVariantAttributes } from "./client";

function toCents(price: string): number {
  return Math.round(parseFloat(price) * 100);
}

export async function ingestNuvemshopOrders(
  prisma: PrismaClient,
  source: NuvemshopOrdersSource,
  since: Date,
): Promise<{ nuvemshopProductId: number; variantId: bigint }[]> {
  const orders = await source.fetchOrdersSince(since);

  const seenVariants = new Map<bigint, { nuvemshopProductId: number; variantId: bigint }>();

  for (const raw of orders) {
    const order = await prisma.order.upsert({
      where: { nuvemshopOrderId: BigInt(raw.id) },
      update: { status: raw.status, paymentStatus: raw.payment_status },
      create: {
        nuvemshopOrderId: BigInt(raw.id),
        orderNumber: String(raw.number),
        status: raw.status,
        paymentStatus: raw.payment_status,
        createdAt: new Date(raw.created_at),
      },
    });

    for (const item of raw.products) {
      const attrs = extractVariantAttributes(item.properties ?? []);
      const product = await prisma.product.upsert({
        where: { nuvemshopVariantId: BigInt(item.variant_id) },
        update: { sku: item.sku, model: item.name, color: attrs.color, size: attrs.size },
        create: {
          nuvemshopVariantId: BigInt(item.variant_id),
          sku: item.sku,
          model: item.name,
          color: attrs.color,
          size: attrs.size,
        },
      });

      await prisma.orderItem.upsert({
        where: { nuvemshopLineItemId: BigInt(item.id) },
        update: { quantity: item.quantity, unitPriceCents: toCents(item.price) },
        create: {
          nuvemshopLineItemId: BigInt(item.id),
          orderId: order.id,
          productId: product.id,
          quantity: item.quantity,
          unitPriceCents: toCents(item.price),
        },
      });

      const variantId = BigInt(item.variant_id);
      if (!seenVariants.has(variantId)) {
        seenVariants.set(variantId, { nuvemshopProductId: item.product_id, variantId });
      }
    }
  }

  return Array.from(seenVariants.values());
}

function firstCategoryName(product: NuvemshopProduct): string | null {
  const category = product.categories[0];
  if (!category) return null;
  return category.name.pt ?? category.name.es ?? category.name.en ?? null;
}

export async function syncProductCategories(
  prisma: PrismaClient,
  client: { fetchProducts(): Promise<NuvemshopProduct[]> },
  variantsByProductId: { nuvemshopProductId: number; variantId: bigint }[],
): Promise<void> {
  const products = await client.fetchProducts();
  const shoeTypeByProductId = new Map(
    products.map((p) => [p.id, firstCategoryName(p)] as const),
  );

  for (const { nuvemshopProductId, variantId } of variantsByProductId) {
    const shoeType = shoeTypeByProductId.get(nuvemshopProductId);
    if (!shoeType) continue;
    await prisma.product.update({
      where: { nuvemshopVariantId: variantId },
      data: { shoeType },
    });
  }
}
