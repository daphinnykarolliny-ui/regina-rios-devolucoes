-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ReasonCategory" AS ENUM ('NUMERACAO', 'COR', 'CONFORTO', 'QUALIDADE', 'ENTREGA', 'ESTOQUE', 'ARREPENDIMENTO', 'PROCESSO');

-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('TROCA', 'DEVOLUCAO');

-- CreateEnum
CREATE TYPE "CutType" AS ENUM ('SIZE', 'COLOR', 'MODEL', 'SKU_COLOR', 'SHOE_TYPE', 'REASON');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "nuvemshopVariantId" BIGINT NOT NULL,
    "sku" TEXT,
    "model" TEXT NOT NULL,
    "color" TEXT,
    "size" TEXT,
    "shoeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "nuvemshopOrderId" BIGINT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "nuvemshopLineItemId" BIGINT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "troqueRequestId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "matchedOrderId" TEXT,
    "matchedProductId" TEXT,
    "rawProductText" TEXT NOT NULL,
    "rawReasonText" TEXT NOT NULL,
    "mappedReason" "ReasonCategory",
    "type" "ReturnType" NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCancellation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "umblerMessageId" TEXT NOT NULL,
    "customerRef" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReasonMapping" (
    "id" TEXT NOT NULL,
    "sourceRawText" TEXT NOT NULL,
    "mappedReason" "ReasonCategory" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReasonMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncStatus" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "SyncStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "cutType" "CutType" NOT NULL,
    "cutValue" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "unitsSold" INTEGER NOT NULL,
    "unitsReturned" INTEGER NOT NULL,
    "taxa" DOUBLE PRECISION NOT NULL,
    "indice" DOUBLE PRECISION NOT NULL,
    "belowMinVolume" BOOLEAN NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_nuvemshopVariantId_key" ON "Product"("nuvemshopVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_source_rawText_key" ON "ProductAlias"("source", "rawText");

-- CreateIndex
CREATE UNIQUE INDEX "Order_nuvemshopOrderId_key" ON "Order"("nuvemshopOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_nuvemshopLineItemId_key" ON "OrderItem"("nuvemshopLineItemId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_troqueRequestId_key" ON "ReturnRequest"("troqueRequestId");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderNumber_idx" ON "ReturnRequest"("orderNumber");

-- CreateIndex
CREATE INDEX "ReturnRequest_matchedProductId_idx" ON "ReturnRequest"("matchedProductId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCancellation_orderId_key" ON "OrderCancellation"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_umblerMessageId_key" ON "WhatsAppMessage"("umblerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ReasonMapping_sourceRawText_key" ON "ReasonMapping"("sourceRawText");

-- CreateIndex
CREATE UNIQUE INDEX "SyncStatus_source_key" ON "SyncStatus"("source");

-- CreateIndex
CREATE INDEX "MetricSnapshot_cutType_windowStart_windowEnd_idx" ON "MetricSnapshot"("cutType", "windowStart", "windowEnd");

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCancellation" ADD CONSTRAINT "OrderCancellation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

