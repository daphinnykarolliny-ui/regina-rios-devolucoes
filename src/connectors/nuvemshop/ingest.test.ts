import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../../tests/setupDb";
import { ingestNuvemshopOrders, syncProductCategories } from "./ingest";
import type { NuvemshopOrder, NuvemshopOrdersSource, NuvemshopProduct } from "./client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("ingestNuvemshopOrders", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates orders, products and order items from raw Nuvemshop orders", async () => {
    const order: NuvemshopOrder = {
      id: 1001,
      number: 5001,
      status: "open",
      payment_status: "paid",
      created_at: "2026-08-01T10:00:00Z",
      products: [
        {
          id: 9001,
          product_id: 501,
          variant_id: 6001,
          sku: "SAND-01-PRETO-37",
          name: "Sandália Ana",
          quantity: 1,
          price: "199.90",
          properties: [
            { name: "Cor", value: "Preto" },
            { name: "Tamanho", value: "37" },
          ],
        },
      ],
    };

    const source: NuvemshopOrdersSource = {
      fetchOrdersSince: async () => [order],
    };

    const result = await ingestNuvemshopOrders(prisma, source, new Date("2026-08-01"));

    expect(result).toEqual([{ nuvemshopProductId: 501, variantId: 6001n }]);

    const dbOrder = await prisma.order.findUnique({ where: { nuvemshopOrderId: 1001n } });
    expect(dbOrder?.orderNumber).toBe("5001");
    expect(dbOrder?.paymentStatus).toBe("paid");

    const product = await prisma.product.findUnique({ where: { nuvemshopVariantId: 6001n } });
    expect(product?.color).toBe("Preto");
    expect(product?.size).toBe("37");

    const item = await prisma.orderItem.findUnique({ where: { nuvemshopLineItemId: 9001n } });
    expect(item?.quantity).toBe(1);
    expect(item?.unitPriceCents).toBe(19990);
  });
});

describe("syncProductCategories", () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.product.create({
      data: { nuvemshopVariantId: 6001n, model: "Sandália Ana" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sets shoeType from the product's first category name", async () => {
    const products: NuvemshopProduct[] = [
      { id: 501, categories: [{ id: 1, name: { pt: "Sandálias" } }] },
    ];
    await syncProductCategories(prisma, { fetchProducts: async () => products }, [
      { nuvemshopProductId: 501, variantId: 6001n },
    ]);

    const product = await prisma.product.findUnique({ where: { nuvemshopVariantId: 6001n } });
    expect(product?.shoeType).toBe("Sandálias");
  });
});
