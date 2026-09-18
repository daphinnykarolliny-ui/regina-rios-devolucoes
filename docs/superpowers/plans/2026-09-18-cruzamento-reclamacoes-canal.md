# Cruzamento de Reclamações por Canal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js/TypeScript/Postgres system that ingests orders from Nuvemshop, return reasons from Troque Commerce, and WhatsApp messages from Umbler, matches returns to specific products via order number, computes return-rate/index metrics per cut, and shows them on an internal dashboard, packaged to deploy in Docker on the existing Regina Rios VPS.

**Architecture:** A single Next.js (App Router, TypeScript) app. A daily cron entrypoint (`scripts/sync.ts`) ingests each source independently (failures isolated per source), matches Troque Commerce return requests to Nuvemshop order items by order number, then recomputes pre-aggregated `MetricSnapshot` rows. The dashboard only reads `MetricSnapshot` — no heavy computation at request time.

**Tech Stack:** Next.js (App Router) + TypeScript (strict), Prisma + PostgreSQL, Vitest, Docker multi-stage build, `tsx` for running the cron script, no external session/queue library (hand-rolled HMAC session, in-process cron via system `crond`).

**Spec:** `docs/superpowers/specs/2026-09-18-cruzamento-reclamacoes-canal-design.md`

## Global Constraints

- Node 22+, TypeScript strict mode everywhere.
- All monetary values stored as integer cents (`unitPriceCents`); all pair counts are integers.
- Taxonomia de motivo fixa (8 categorias): `NUMERACAO, COR, CONFORTO, QUALIDADE, ENTREGA, ESTOQUE, ARREPENDIMENTO, PROCESSO` (spec §4). Motivo sem mapeamento nunca é descartado — fica com `mappedReason = null` e `needsReview = true`, e aparece no corte de motivo como `NAO_MAPEADO`.
- Denominador de "vendido" = itens de pedidos com `paymentStatus = "paid"` apenas. `OrderCancellation` nunca entra no denominador (spec §7).
- Janela de métricas: `windowDays = 90` (padrão), `METRICS_MATURITY_LAG_DAYS = 30` (padrão) — a janela usada no cálculo sempre termina `maturityLagDays` dias atrás de "agora", nunca inclui dados recentes demais para terem devolução materializada (spec §7, risco do lag).
- `METRICS_MIN_VOLUME_THRESHOLD` (padrão 15) é configurável via env, não um número fixo no código (spec §3).
- Credenciais (Nuvemshop, Troque Commerce, Umbler, sessão) só via variáveis de ambiente — nunca hardcoded, nunca commitadas. `.env.example` documenta cada uma.
- Casamento de devolução↔produto é sempre por número do pedido primeiro (spec §6) — nunca por comparação de texto livre no catálogo inteiro.
- Instagram/Facebook e o relatório de oportunidades de venda (spec §14) estão fora deste plano.

---

## File Structure

```
prisma/schema.prisma
prisma/seedReasonMapping.ts
src/lib/prisma.ts
src/lib/health.ts
src/connectors/nuvemshop/client.ts
src/connectors/nuvemshop/ingest.ts
src/connectors/nuvemshop/cancellations.ts
src/connectors/nuvemshop/*.test.ts
src/connectors/troque/client.ts
src/connectors/troque/ingest.ts
src/connectors/troque/matching.ts
src/connectors/troque/*.test.ts
src/connectors/umbler/client.ts
src/connectors/umbler/ingest.ts
src/connectors/umbler/*.test.ts
src/taxonomy/reasonMapping.ts
src/taxonomy/reasonMapping.test.ts
src/metrics/config.ts
src/metrics/aggregate.ts
src/metrics/aggregate.test.ts
src/sync/syncStatus.ts
src/sync/withRetry.ts
src/sync/runSync.ts
src/sync/*.test.ts
src/auth/config.ts
src/auth/verify.ts
src/auth/session.ts
src/auth/*.test.ts
src/dashboard/queries.ts
src/dashboard/queries.test.ts
middleware.ts
app/layout.tsx
app/page.tsx (redirects to /dashboard)
app/login/page.tsx
app/api/login/route.ts
app/api/health/route.ts
app/dashboard/page.tsx
scripts/sync.ts
tests/setupDb.ts
Dockerfile
docker-compose.yml
docker-compose.dev.yml
.env.example
```

Each connector directory (`nuvemshop/`, `troque/`, `umbler/`) is self-contained: a `client.ts` (HTTP + raw types), an `ingest.ts` (raw → domain, DB writes), and its tests. `matching.ts` lives under `troque/` because order-based matching is specific to reconciling Troque Commerce returns against Nuvemshop orders — it is not a generic cross-source concept.

---

### Task 1: Project scaffold, dev database, health check

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.env.example`, `docker-compose.dev.yml`, `vitest.config.ts`
- Create: `src/lib/health.ts`
- Create: `app/api/health/route.ts`, `app/layout.tsx`, `app/page.tsx`
- Test: `src/lib/health.test.ts`

**Interfaces:**
- Produces: `getHealthStatus(): { status: "ok"; timestamp: string }` — used by Task 13's Docker healthcheck and manually via `curl`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "regina-rios-devolucoes",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "sync": "tsx scripts/sync.ts",
    "db:seed-reasons": "tsx prisma/seedReasonMapping.ts"
  },
  "dependencies": {
    "next": "latest",
    "react": "latest",
    "react-dom": "latest",
    "@prisma/client": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "prisma": "latest",
    "vitest": "latest",
    "tsx": "latest"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "preserve",
    "incremental": true,
    "noEmit": true,
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 5: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
  },
});
```

- [ ] **Step 6: Create `docker-compose.dev.yml`** (local Postgres for development and tests)

```yaml
services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: regina_devolucoes
      POSTGRES_USER: regina
      POSTGRES_PASSWORD: dev_only_password
    ports:
      - "5432:5432"
    volumes:
      - dev_db_data:/var/lib/postgresql/data
volumes:
  dev_db_data:
```

- [ ] **Step 7: Create `.env.example`**

```
DATABASE_URL=postgresql://regina:dev_only_password@localhost:5432/regina_devolucoes?schema=public
DATABASE_URL_TEST=postgresql://regina:dev_only_password@localhost:5432/regina_devolucoes?schema=test

NUVEMSHOP_STORE_ID=
NUVEMSHOP_ACCESS_TOKEN=
NUVEMSHOP_USER_AGENT=regina-rios-devolucoes (contato@reginarios.com.br)

TROQUE_BASE_URL=
TROQUE_API_KEY=

UMBLER_BASE_URL=
UMBLER_API_KEY=

SESSION_SECRET=
APP_PASSWORD_SALT=
APP_USERS=

METRICS_MATURITY_LAG_DAYS=30
METRICS_MIN_VOLUME_THRESHOLD=15

POSTGRES_PASSWORD=
```

- [ ] **Step 8: Start the dev database**

Run: `docker compose -f docker-compose.dev.yml up -d`

- [ ] **Step 9: Write the failing test for the health check**

```typescript
// src/lib/health.test.ts
import { describe, it, expect } from "vitest";
import { getHealthStatus } from "./health";

describe("getHealthStatus", () => {
  it("reports ok with an ISO timestamp", () => {
    const result = getHealthStatus();
    expect(result.status).toBe("ok");
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run src/lib/health.test.ts`
Expected: FAIL — `Cannot find module './health'`

- [ ] **Step 11: Implement `src/lib/health.ts`**

```typescript
export function getHealthStatus(): { status: "ok"; timestamp: string } {
  return { status: "ok", timestamp: new Date().toISOString() };
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run src/lib/health.test.ts`
Expected: PASS

- [ ] **Step 13: Wire the health check into a route, and minimal app shell**

```typescript
// app/api/health/route.ts
import { NextResponse } from "next/server";
import { getHealthStatus } from "@/src/lib/health";

export function GET() {
  return NextResponse.json(getHealthStatus());
}
```

```tsx
// app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// app/page.tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

- [ ] **Step 14: Verify the app builds and the health route works**

Run: `npm run build`
Expected: build succeeds (dashboard/login routes don't exist yet, but nothing references them at build time in this task).

Run: `npm run dev` in one terminal, then `curl http://localhost:3000/api/health` in another.
Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 15: Commit**

```bash
git add package.json tsconfig.json next.config.ts vitest.config.ts .env.example docker-compose.dev.yml src/lib/health.ts src/lib/health.test.ts app/api/health/route.ts app/layout.tsx app/page.tsx package-lock.json
git commit -m "feat: scaffold Next.js project with dev Postgres and health check"
```

---

### Task 2: Prisma schema and migration

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`
- Create: `tests/setupDb.ts`
- Test: `tests/setupDb.test.ts`

**Interfaces:**
- Produces: `prisma` (singleton `PrismaClient` from `src/lib/prisma.ts`), `resetDb(prisma): Promise<void>` from `tests/setupDb.ts` — used by every subsequent test file.
- Produces (Prisma models, used by name in every later task): `Product`, `ProductAlias`, `Order`, `OrderItem`, `ReturnRequest`, `OrderCancellation`, `WhatsAppMessage`, `ReasonMapping`, `SyncStatus`, `MetricSnapshot`.

- [ ] **Step 1: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ReasonCategory {
  NUMERACAO
  COR
  CONFORTO
  QUALIDADE
  ENTREGA
  ESTOQUE
  ARREPENDIMENTO
  PROCESSO
}

enum ReturnType {
  TROCA
  DEVOLUCAO
}

enum CutType {
  SIZE
  COLOR
  MODEL
  SKU_COLOR
  SHOE_TYPE
  REASON
}

model Product {
  id                 String   @id @default(cuid())
  nuvemshopVariantId BigInt   @unique
  sku                String?
  model              String
  color              String?
  size               String?
  shoeType           String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  orderItems     OrderItem[]
  aliases        ProductAlias[]
  returnRequests ReturnRequest[]
}

model ProductAlias {
  id         String   @id @default(cuid())
  source     String
  rawText    String
  productId  String
  confidence Float
  reviewedBy String?
  createdAt  DateTime @default(now())

  product Product @relation(fields: [productId], references: [id])

  @@unique([source, rawText])
}

model Order {
  id            String   @id @default(cuid())
  nuvemshopOrderId BigInt   @unique
  orderNumber   String   @unique
  status        String
  paymentStatus String
  createdAt     DateTime
  updatedAt     DateTime @updatedAt

  items         OrderItem[]
  cancellation  OrderCancellation?
}

model OrderItem {
  id                  String @id @default(cuid())
  nuvemshopLineItemId BigInt @unique
  orderId             String
  productId           String
  quantity            Int
  unitPriceCents      Int

  order   Order   @relation(fields: [orderId], references: [id])
  product Product @relation(fields: [productId], references: [id])

  @@index([orderId])
  @@index([productId])
}

model ReturnRequest {
  id               String         @id @default(cuid())
  troqueRequestId  String         @unique
  orderNumber      String
  matchedOrderId   String?
  matchedProductId String?
  rawProductText   String
  rawReasonText    String
  mappedReason     ReasonCategory?
  type             ReturnType
  status           String
  requestedAt      DateTime
  needsReview      Boolean        @default(false)
  rawPayload       Json
  createdAt        DateTime       @default(now())

  matchedProduct Product? @relation(fields: [matchedProductId], references: [id])

  @@index([orderNumber])
  @@index([matchedProductId])
}

model OrderCancellation {
  id          String   @id @default(cuid())
  orderId     String   @unique
  reason      String
  cancelledAt DateTime

  order Order @relation(fields: [orderId], references: [id])
}

model WhatsAppMessage {
  id              String   @id @default(cuid())
  umblerMessageId String   @unique
  customerRef     String
  text            String
  createdAt       DateTime
  rawPayload      Json
}

model ReasonMapping {
  id             String         @id @default(cuid())
  sourceRawText  String         @unique
  mappedReason   ReasonCategory
  active         Boolean        @default(true)
}

model SyncStatus {
  id            String    @id @default(cuid())
  source        String    @unique
  lastRunAt     DateTime
  lastSuccessAt DateTime?
  lastError     String?
}

model MetricSnapshot {
  id             String   @id @default(cuid())
  cutType        CutType
  cutValue       String
  windowStart    DateTime
  windowEnd      DateTime
  unitsSold      Int
  unitsReturned  Int
  taxa           Float
  indice         Float
  belowMinVolume Boolean
  computedAt     DateTime @default(now())

  @@index([cutType, windowStart, windowEnd])
}
```

- [ ] **Step 2: Point Prisma at the dev database and create the first migration**

Run: `cp .env.example .env` (fill `DATABASE_URL`/`DATABASE_URL_TEST` — both can point at the same dev Postgres for now, see step 5)

Run: `npx prisma migrate dev --name init`
Expected: migration created and applied, `@prisma/client` generated.

- [ ] **Step 3: Create the Prisma singleton**

```typescript
// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
```

- [ ] **Step 4: Create the test database schema**

Run: `npx prisma migrate deploy --schema prisma/schema.prisma` against `DATABASE_URL_TEST` (which uses `?schema=test` on the same Postgres instance):

```bash
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy
```

- [ ] **Step 5: Write the failing test for `resetDb`**

```typescript
// tests/setupDb.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "./setupDb";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("resetDb", () => {
  beforeAll(async () => {
    await prisma.product.create({
      data: { nuvemshopVariantId: 1n, model: "Sandália Teste" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("removes all rows from every table", async () => {
    await resetDb(prisma);
    const count = await prisma.product.count();
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run tests/setupDb.test.ts`
Expected: FAIL — `Cannot find module './setupDb'`

- [ ] **Step 7: Implement `tests/setupDb.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";

const TABLES = [
  "MetricSnapshot",
  "SyncStatus",
  "ReasonMapping",
  "WhatsAppMessage",
  "OrderCancellation",
  "ReturnRequest",
  "OrderItem",
  "Order",
  "ProductAlias",
  "Product",
];

export async function resetDb(prisma: PrismaClient): Promise<void> {
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run tests/setupDb.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma src/lib/prisma.ts tests/setupDb.ts tests/setupDb.test.ts prisma/migrations .env.example
git commit -m "feat: add Prisma schema, migration, and test database reset helper"
```

---

### Task 3: Nuvemshop connector (orders, items, products, categories)

**Files:**
- Create: `src/connectors/nuvemshop/client.ts`
- Create: `src/connectors/nuvemshop/ingest.ts`
- Test: `src/connectors/nuvemshop/client.test.ts`
- Test: `src/connectors/nuvemshop/ingest.test.ts`

**Interfaces:**
- Consumes: `prisma` (`src/lib/prisma.ts`), `resetDb` (`tests/setupDb.ts`).
- Produces: `NuvemshopOrder`, `NuvemshopLineItem` types; `NuvemshopOrdersSource` interface with `fetchOrdersSince(since: Date): Promise<NuvemshopOrder[]>`; `NuvemshopClient` (implements it, also has `fetchProducts(): Promise<NuvemshopProduct[]>`); `extractVariantAttributes(properties): { color: string | null; size: string | null }`; `ingestNuvemshopOrders(prisma, source: NuvemshopOrdersSource, since: Date): Promise<void>`; `syncProductCategories(prisma, client: { fetchProducts(): Promise<NuvemshopProduct[]> }): Promise<void>`.

- [ ] **Step 1: Write the failing test for `extractVariantAttributes`**

```typescript
// src/connectors/nuvemshop/client.test.ts
import { describe, it, expect } from "vitest";
import { extractVariantAttributes } from "./client";

describe("extractVariantAttributes", () => {
  it("reads Cor and Tamanho regardless of case", () => {
    const result = extractVariantAttributes([
      { name: "Cor", value: "Preto" },
      { name: "TAMANHO", value: "37" },
    ]);
    expect(result).toEqual({ color: "Preto", size: "37" });
  });

  it("returns nulls when properties are missing", () => {
    expect(extractVariantAttributes([])).toEqual({ color: null, size: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/connectors/nuvemshop/client.test.ts`
Expected: FAIL — `Cannot find module './client'`

- [ ] **Step 3: Implement `src/connectors/nuvemshop/client.ts`**

```typescript
export interface NuvemshopVariantProperty {
  name: string;
  value: string;
}

export interface NuvemshopLineItem {
  id: number;
  product_id: number;
  variant_id: number;
  sku: string | null;
  name: string;
  quantity: number;
  price: string;
  properties?: NuvemshopVariantProperty[];
}

export interface NuvemshopOrder {
  id: number;
  number: number;
  status: string;
  payment_status: string;
  created_at: string;
  products: NuvemshopLineItem[];
}

export interface NuvemshopProduct {
  id: number;
  categories: { id: number; name: { pt?: string; es?: string; en?: string } }[];
}

export interface NuvemshopOrdersSource {
  fetchOrdersSince(since: Date): Promise<NuvemshopOrder[]>;
}

export interface NuvemshopClientConfig {
  storeId: string;
  accessToken: string;
  userAgent: string;
  baseUrl?: string;
}

const COLOR_KEYS = ["cor", "color"];
const SIZE_KEYS = ["tamanho", "numeracao", "numeração", "size"];

export function extractVariantAttributes(
  properties: NuvemshopVariantProperty[],
): { color: string | null; size: string | null } {
  let color: string | null = null;
  let size: string | null = null;
  for (const prop of properties) {
    const key = prop.name.trim().toLowerCase();
    if (COLOR_KEYS.includes(key)) color = prop.value.trim();
    if (SIZE_KEYS.includes(key)) size = prop.value.trim();
  }
  return { color, size };
}

export class NuvemshopClient implements NuvemshopOrdersSource {
  constructor(private config: NuvemshopClientConfig) {}

  private baseUrl(): string {
    return this.config.baseUrl ?? `https://api.nuvemshop.com.br/v1/${this.config.storeId}`;
  }

  private headers(): Record<string, string> {
    return {
      Authentication: `bearer ${this.config.accessToken}`,
      "User-Agent": this.config.userAgent,
      "Content-Type": "application/json",
    };
  }

  async fetchOrdersSince(since: Date): Promise<NuvemshopOrder[]> {
    const orders: NuvemshopOrder[] = [];
    let page = 1;
    const perPage = 200;
    while (true) {
      const url = `${this.baseUrl()}/orders?updated_at_min=${since.toISOString()}&page=${page}&per_page=${perPage}`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) {
        throw new Error(`Nuvemshop orders request failed: ${res.status} ${await res.text()}`);
      }
      const batch = (await res.json()) as NuvemshopOrder[];
      orders.push(...batch);
      if (batch.length < perPage) break;
      page += 1;
    }
    return orders;
  }

  async fetchProducts(): Promise<NuvemshopProduct[]> {
    const products: NuvemshopProduct[] = [];
    let page = 1;
    const perPage = 200;
    while (true) {
      const url = `${this.baseUrl()}/products?page=${page}&per_page=${perPage}`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) {
        throw new Error(`Nuvemshop products request failed: ${res.status} ${await res.text()}`);
      }
      const batch = (await res.json()) as NuvemshopProduct[];
      products.push(...batch);
      if (batch.length < perPage) break;
      page += 1;
    }
    return products;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/connectors/nuvemshop/client.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for ingestion**

```typescript
// src/connectors/nuvemshop/ingest.test.ts
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

    await ingestNuvemshopOrders(prisma, source, new Date("2026-08-01"));

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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/connectors/nuvemshop/ingest.test.ts`
Expected: FAIL — `Cannot find module './ingest'`

- [ ] **Step 7: Implement `src/connectors/nuvemshop/ingest.ts`**

```typescript
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
): Promise<void> {
  const orders = await source.fetchOrdersSince(since);

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
    }
  }
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
```

- [ ] **Step 8: Run test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/connectors/nuvemshop/ingest.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/connectors/nuvemshop
git commit -m "feat: add Nuvemshop connector for orders, items, products and categories"
```

---

### Task 4: Reason taxonomy and mapping

**Files:**
- Create: `src/taxonomy/reasonMapping.ts`
- Create: `prisma/seedReasonMapping.ts`
- Test: `src/taxonomy/reasonMapping.test.ts`

**Interfaces:**
- Consumes: `prisma.reasonMapping` (Task 2).
- Produces: `normalizeReasonText(raw: string): string`; `mapReason(prisma, rawReasonText: string): Promise<ReasonCategory | null>` — consumed by Task 5's `ingestTroqueReturnRequests`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/taxonomy/reasonMapping.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../tests/setupDb";
import { mapReason, normalizeReasonText } from "./reasonMapping";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("normalizeReasonText", () => {
  it("trims and lowercases", () => {
    expect(normalizeReasonText("  Não Coube  ")).toBe("não coube");
  });
});

describe("mapReason", () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.reasonMapping.create({
      data: { sourceRawText: "não coube", mappedReason: "NUMERACAO", active: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("maps known raw text regardless of case/spacing", async () => {
    const result = await mapReason(prisma, "  NÃO COUBE  ");
    expect(result).toBe("NUMERACAO");
  });

  it("returns null for unknown raw text", async () => {
    const result = await mapReason(prisma, "motivo nunca visto antes");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/taxonomy/reasonMapping.test.ts`
Expected: FAIL — `Cannot find module './reasonMapping'`

- [ ] **Step 3: Implement `src/taxonomy/reasonMapping.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/taxonomy/reasonMapping.test.ts`
Expected: PASS

- [ ] **Step 5: Create the starter seed** (adjust freely once real Troque Commerce reason text is seen — this is a starting point, not final)

```typescript
// prisma/seedReasonMapping.ts
import { PrismaClient } from "@prisma/client";
import { normalizeReasonText } from "../src/taxonomy/reasonMapping";

const prisma = new PrismaClient();

const SEED: { text: string; reason: string }[] = [
  { text: "não coube, veio pequeno", reason: "NUMERACAO" },
  { text: "não coube, veio grande", reason: "NUMERACAO" },
  { text: "cor diferente da foto", reason: "COR" },
  { text: "machucou o pé", reason: "CONFORTO" },
  { text: "salto instável", reason: "CONFORTO" },
  { text: "solado descolou", reason: "QUALIDADE" },
  { text: "produto quebrou", reason: "QUALIDADE" },
  { text: "atraso na entrega", reason: "ENTREGA" },
  { text: "produto extraviado", reason: "ENTREGA" },
  { text: "não tinha o tamanho no estoque", reason: "ESTOQUE" },
  { text: "não gostei, sem defeito", reason: "ARREPENDIMENTO" },
  { text: "dificuldade para fazer a troca", reason: "PROCESSO" },
];

async function main() {
  for (const entry of SEED) {
    await prisma.reasonMapping.upsert({
      where: { sourceRawText: normalizeReasonText(entry.text) },
      update: {},
      create: {
        sourceRawText: normalizeReasonText(entry.text),
        mappedReason: entry.reason as never,
        active: true,
      },
    });
  }
  console.log(`Seeded ${SEED.length} reason mappings.`);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Run the seed against the dev database**

Run: `npm run db:seed-reasons`
Expected: `Seeded 12 reason mappings.`

- [ ] **Step 7: Commit**

```bash
git add src/taxonomy prisma/seedReasonMapping.ts
git commit -m "feat: add reason taxonomy mapping and starter seed"
```

---

### Task 5: Troque Commerce connector

**Files:**
- Create: `src/connectors/troque/client.ts`
- Create: `src/connectors/troque/ingest.ts`
- Test: `src/connectors/troque/ingest.test.ts`

**Note:** the exact endpoint path and field names below follow the shape described in the spec (order reference, product text, reason text, type, status, requested-at) and must be checked against the real Troque Commerce API docs once provided. The risk is fully isolated to `client.ts` — `ingest.ts`, the schema, and everything downstream depend only on the `TroqueRawReturnRequest`/`TroqueReturnSource` shapes, and `rawPayload` is preserved on every row so re-mapping never requires re-fetching.

**Interfaces:**
- Consumes: `prisma`, `mapReason` (Task 4).
- Produces: `TroqueRawReturnRequest`, `TroqueReturnSource` interface (`fetchReturnRequestsSince(since: Date): Promise<TroqueRawReturnRequest[]>`), `TroqueClient` (implements it), `ingestTroqueReturnRequests(prisma, source: TroqueReturnSource, since: Date): Promise<void>` — consumed by Task 6 and Task 10.

- [ ] **Step 1: Implement `src/connectors/troque/client.ts`**

```typescript
export interface TroqueRawReturnRequest {
  id: string;
  order_reference: string;
  product_text: string;
  reason_text: string;
  type: "troca" | "devolucao";
  status: string;
  requested_at: string;
}

export interface TroqueReturnSource {
  fetchReturnRequestsSince(since: Date): Promise<TroqueRawReturnRequest[]>;
}

export interface TroqueClientConfig {
  baseUrl: string;
  apiKey: string;
}

export class TroqueClient implements TroqueReturnSource {
  constructor(private config: TroqueClientConfig) {}

  async fetchReturnRequestsSince(since: Date): Promise<TroqueRawReturnRequest[]> {
    const results: TroqueRawReturnRequest[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const url = `${this.config.baseUrl}/return-requests?updated_since=${since.toISOString()}&page=${page}&per_page=${perPage}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      if (!res.ok) {
        throw new Error(`Troque Commerce request failed: ${res.status} ${await res.text()}`);
      }
      const batch = (await res.json()) as TroqueRawReturnRequest[];
      results.push(...batch);
      if (batch.length < perPage) break;
      page += 1;
    }
    return results;
  }
}
```

- [ ] **Step 2: Write the failing test for ingestion**

```typescript
// src/connectors/troque/ingest.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../../tests/setupDb";
import { ingestTroqueReturnRequests } from "./ingest";
import type { TroqueRawReturnRequest, TroqueReturnSource } from "./client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("ingestTroqueReturnRequests", () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.reasonMapping.create({
      data: { sourceRawText: "não coube", mappedReason: "NUMERACAO", active: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores return requests with a mapped reason and needsReview=false", async () => {
    const raw: TroqueRawReturnRequest = {
      id: "req-1",
      order_reference: "5001",
      product_text: "Sandália Ana Preto 37",
      reason_text: "Não coube",
      type: "devolucao",
      status: "pending",
      requested_at: "2026-08-05T12:00:00Z",
    };
    const source: TroqueReturnSource = { fetchReturnRequestsSince: async () => [raw] };

    await ingestTroqueReturnRequests(prisma, source, new Date("2026-08-01"));

    const stored = await prisma.returnRequest.findUnique({ where: { troqueRequestId: "req-1" } });
    expect(stored?.mappedReason).toBe("NUMERACAO");
    expect(stored?.needsReview).toBe(false);
    expect(stored?.type).toBe("DEVOLUCAO");
  });

  it("flags needsReview when the reason has no mapping", async () => {
    const raw: TroqueRawReturnRequest = {
      id: "req-2",
      order_reference: "5002",
      product_text: "Bota X Marrom 38",
      reason_text: "motivo nunca visto",
      type: "troca",
      status: "pending",
      requested_at: "2026-08-06T12:00:00Z",
    };
    const source: TroqueReturnSource = { fetchReturnRequestsSince: async () => [raw] };

    await ingestTroqueReturnRequests(prisma, source, new Date("2026-08-01"));

    const stored = await prisma.returnRequest.findUnique({ where: { troqueRequestId: "req-2" } });
    expect(stored?.mappedReason).toBeNull();
    expect(stored?.needsReview).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/connectors/troque/ingest.test.ts`
Expected: FAIL — `Cannot find module './ingest'`

- [ ] **Step 4: Implement `src/connectors/troque/ingest.ts`**

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/connectors/troque/ingest.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/connectors/troque/client.ts src/connectors/troque/ingest.ts src/connectors/troque/ingest.test.ts
git commit -m "feat: add Troque Commerce connector with reason mapping"
```

---

### Task 6: Order-based product matching

**Files:**
- Create: `src/connectors/troque/matching.ts`
- Test: `src/connectors/troque/matching.test.ts`

**Note:** this task does not include a manual-review admin UI — `ReturnRequest.needsReview = true` rows are queryable directly (e.g. via Prisma Studio) until that UI becomes a fast-follow. That's an explicit scope cut, not a gap being papered over.

**Interfaces:**
- Consumes: `prisma.order`, `prisma.returnRequest`, `prisma.productAlias` (Task 2), `Order`/`OrderItem` rows from Task 3, `ReturnRequest` rows from Task 5.
- Produces: `pickBestMatch(productText: string, items: MatchableItem[]): { productId: string } | null`; `matchReturnRequestsToProducts(prisma): Promise<void>` — consumed by Task 10's `runSync`.

- [ ] **Step 1: Write the failing test for `pickBestMatch`**

```typescript
// src/connectors/troque/matching.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../../tests/setupDb";
import { pickBestMatch, matchReturnRequestsToProducts } from "./matching";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("pickBestMatch", () => {
  const items = [
    { productId: "p1", product: { model: "Sandália Ana", color: "Preto", size: "37" } },
    { productId: "p2", product: { model: "Bota Clara", color: "Marrom", size: "38" } },
  ];

  it("picks the clearly closer item", () => {
    const result = pickBestMatch("Sandália Ana Preto 37", items);
    expect(result?.productId).toBe("p1");
  });

  it("returns null when no item is close enough", () => {
    const result = pickBestMatch("Tênis Runner Azul 40", items);
    expect(result).toBeNull();
  });
});

describe("matchReturnRequestsToProducts", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedOrderWithItems(
    orderNumber: string,
    items: { variantId: bigint; model: string; color: string; size: string }[],
  ) {
    const order = await prisma.order.create({
      data: {
        nuvemshopOrderId: BigInt(Math.floor(Math.random() * 1_000_000)),
        orderNumber,
        status: "open",
        paymentStatus: "paid",
        createdAt: new Date("2026-08-01"),
      },
    });
    for (const item of items) {
      const product = await prisma.product.create({
        data: { nuvemshopVariantId: item.variantId, model: item.model, color: item.color, size: item.size },
      });
      await prisma.orderItem.create({
        data: {
          nuvemshopLineItemId: item.variantId,
          orderId: order.id,
          productId: product.id,
          quantity: 1,
          unitPriceCents: 10000,
        },
      });
    }
    return order;
  }

  it("auto-matches when the order has a single item", async () => {
    await seedOrderWithItems("6001", [
      { variantId: 1n, model: "Sandália Ana", color: "Preto", size: "37" },
    ]);
    await prisma.returnRequest.create({
      data: {
        troqueRequestId: "r1",
        orderNumber: "6001",
        rawProductText: "qualquer coisa",
        rawReasonText: "não coube",
        type: "DEVOLUCAO",
        status: "pending",
        requestedAt: new Date("2026-08-05"),
        rawPayload: {},
      },
    });

    await matchReturnRequestsToProducts(prisma);

    const updated = await prisma.returnRequest.findUnique({ where: { troqueRequestId: "r1" } });
    expect(updated?.matchedProductId).not.toBeNull();
    expect(updated?.needsReview).toBe(false);
  });

  it("flags ambiguous multi-item matches for review instead of guessing", async () => {
    await seedOrderWithItems("6002", [
      { variantId: 2n, model: "Sandália Ana", color: "Preto", size: "37" },
      { variantId: 3n, model: "Sandália Ana", color: "Preto", size: "38" },
    ]);
    await prisma.returnRequest.create({
      data: {
        troqueRequestId: "r2",
        orderNumber: "6002",
        rawProductText: "Sandália Ana",
        rawReasonText: "não coube",
        type: "DEVOLUCAO",
        status: "pending",
        requestedAt: new Date("2026-08-05"),
        rawPayload: {},
      },
    });

    await matchReturnRequestsToProducts(prisma);

    const updated = await prisma.returnRequest.findUnique({ where: { troqueRequestId: "r2" } });
    expect(updated?.matchedProductId).toBeNull();
    expect(updated?.needsReview).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/connectors/troque/matching.test.ts`
Expected: FAIL — `Cannot find module './matching'`

- [ ] **Step 3: Implement `src/connectors/troque/matching.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";

export interface MatchableItem {
  productId: string;
  product: { model: string; color: string | null; size: string | null };
}

function similarityScore(a: string, b: string): number {
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  const intersection = [...aTokens].filter((t) => bTokens.has(t)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function pickBestMatch(productText: string, items: MatchableItem[]): { productId: string } | null {
  const normalized = productText.trim().toLowerCase();
  const scored = items
    .map((item) => {
      const haystack = `${item.product.model} ${item.product.color ?? ""} ${item.product.size ?? ""}`.toLowerCase();
      return { productId: item.productId, score: similarityScore(normalized, haystack) };
    })
    .sort((a, b) => b.score - a.score);

  const [top, second] = scored;
  if (!top || top.score < 0.5) return null;
  if (second && top.score - second.score < 0.15) return null;
  return { productId: top.productId };
}

export async function matchReturnRequestsToProducts(prisma: PrismaClient): Promise<void> {
  const pending = await prisma.returnRequest.findMany({ where: { matchedProductId: null } });

  for (const rr of pending) {
    const alias = await prisma.productAlias.findUnique({
      where: { source_rawText: { source: "TROQUE", rawText: rr.rawProductText.trim().toLowerCase() } },
    });
    if (alias) {
      await prisma.returnRequest.update({
        where: { id: rr.id },
        data: { matchedProductId: alias.productId, needsReview: false },
      });
      continue;
    }

    const order = await prisma.order.findUnique({
      where: { orderNumber: rr.orderNumber },
      include: { items: { include: { product: true } } },
    });
    if (!order) continue;

    if (order.items.length === 1) {
      const [item] = order.items;
      await prisma.$transaction([
        prisma.returnRequest.update({
          where: { id: rr.id },
          data: { matchedOrderId: order.id, matchedProductId: item.productId, needsReview: false },
        }),
        prisma.productAlias.upsert({
          where: { source_rawText: { source: "TROQUE", rawText: rr.rawProductText.trim().toLowerCase() } },
          update: {},
          create: {
            source: "TROQUE",
            rawText: rr.rawProductText.trim().toLowerCase(),
            productId: item.productId,
            confidence: 1.0,
          },
        }),
      ]);
      continue;
    }

    const best = pickBestMatch(rr.rawProductText, order.items);
    if (best) {
      await prisma.returnRequest.update({
        where: { id: rr.id },
        data: { matchedOrderId: order.id, matchedProductId: best.productId, needsReview: false },
      });
    } else {
      await prisma.returnRequest.update({
        where: { id: rr.id },
        data: { matchedOrderId: order.id, needsReview: true },
      });
    }
  }
}
```

This requires `@@unique([source, rawText])` on `ProductAlias` (already in Task 2's schema), which Prisma exposes as the compound key `source_rawText`.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/connectors/troque/matching.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/connectors/troque/matching.ts src/connectors/troque/matching.test.ts
git commit -m "feat: match Troque Commerce returns to products via order number"
```

---

### Task 7: Order cancellations (payment failure)

**Files:**
- Create: `src/connectors/nuvemshop/cancellations.ts`
- Test: `src/connectors/nuvemshop/cancellations.test.ts`

**Interfaces:**
- Consumes: `prisma.order`, `prisma.orderCancellation` (Task 2), `Order` rows from Task 3.
- Produces: `isPaymentFailureCancellation(order): boolean`; `syncOrderCancellations(prisma): Promise<void>` — consumed by Task 10's `runSync`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/connectors/nuvemshop/cancellations.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/connectors/nuvemshop/cancellations.test.ts`
Expected: FAIL — `Cannot find module './cancellations'`

- [ ] **Step 3: Implement `src/connectors/nuvemshop/cancellations.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/connectors/nuvemshop/cancellations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/connectors/nuvemshop/cancellations.ts src/connectors/nuvemshop/cancellations.test.ts
git commit -m "feat: derive payment-failure cancellations separately from returns"
```

---

### Task 8: Umbler connector (WhatsApp, qualitative)

**Files:**
- Create: `src/connectors/umbler/client.ts`
- Create: `src/connectors/umbler/ingest.ts`
- Test: `src/connectors/umbler/ingest.test.ts`

**Note:** same caveat as Task 5 — endpoint/field names are a best guess pending Umbler's real docs, isolated to `client.ts`, with `rawPayload` preserved.

**Interfaces:**
- Consumes: `prisma.whatsAppMessage` (Task 2).
- Produces: `UmblerRawMessage`, `UmblerMessageSource` interface (`fetchMessagesSince(since: Date): Promise<UmblerRawMessage[]>`), `UmblerClient` (implements it), `ingestUmblerMessages(prisma, source: UmblerMessageSource, since: Date): Promise<void>` — consumed by Task 10's `runSync`.

- [ ] **Step 1: Implement `src/connectors/umbler/client.ts`**

```typescript
export interface UmblerRawMessage {
  id: string;
  contact_id: string;
  content: string;
  direction: "inbound" | "outbound";
  created_at: string;
}

export interface UmblerMessageSource {
  fetchMessagesSince(since: Date): Promise<UmblerRawMessage[]>;
}

export interface UmblerClientConfig {
  baseUrl: string;
  apiKey: string;
}

export class UmblerClient implements UmblerMessageSource {
  constructor(private config: UmblerClientConfig) {}

  async fetchMessagesSince(since: Date): Promise<UmblerRawMessage[]> {
    const results: UmblerRawMessage[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const url = `${this.config.baseUrl}/messages?since=${since.toISOString()}&page=${page}&per_page=${perPage}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      if (!res.ok) {
        throw new Error(`Umbler request failed: ${res.status} ${await res.text()}`);
      }
      const batch = (await res.json()) as UmblerRawMessage[];
      results.push(...batch);
      if (batch.length < perPage) break;
      page += 1;
    }
    return results;
  }
}
```

- [ ] **Step 2: Write the failing test for ingestion**

```typescript
// src/connectors/umbler/ingest.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../../tests/setupDb";
import { ingestUmblerMessages } from "./ingest";
import type { UmblerRawMessage, UmblerMessageSource } from "./client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("ingestUmblerMessages", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores only inbound (customer) messages", async () => {
    const messages: UmblerRawMessage[] = [
      { id: "m1", contact_id: "c1", content: "furou o solado em uma semana", direction: "inbound", created_at: "2026-08-01T10:00:00Z" },
      { id: "m2", contact_id: "c1", content: "vamos verificar", direction: "outbound", created_at: "2026-08-01T10:05:00Z" },
    ];
    const source: UmblerMessageSource = { fetchMessagesSince: async () => messages };

    await ingestUmblerMessages(prisma, source, new Date("2026-08-01"));

    const stored = await prisma.whatsAppMessage.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].umblerMessageId).toBe("m1");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/connectors/umbler/ingest.test.ts`
Expected: FAIL — `Cannot find module './ingest'`

- [ ] **Step 4: Implement `src/connectors/umbler/ingest.ts`**

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/connectors/umbler/ingest.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/connectors/umbler
git commit -m "feat: add Umbler connector for inbound WhatsApp messages"
```

---

### Task 9: Metric aggregation (taxa/índice per cut)

**Files:**
- Create: `src/metrics/config.ts`
- Create: `src/metrics/aggregate.ts`
- Test: `src/metrics/aggregate.test.ts`

**Interfaces:**
- Consumes: `prisma.orderItem`, `prisma.returnRequest`, `prisma.metricSnapshot` (Task 2); `Order`/`OrderItem`/`Product` rows (Task 3); `ReturnRequest.matchedProductId`/`mappedReason` (Tasks 5–6).
- Produces: `metricsConfig` (`maturityLagDays`, `minVolumeThreshold`); `resolveWindow(now, windowDays, maturityLagDays): { start: Date; end: Date }`; `computeMetricSnapshots(prisma, options?: { now?: Date; windowDays?: number }): Promise<void>` — consumed by Task 10's `runSync` and Task 12's dashboard queries (indirectly, via the `MetricSnapshot` rows it writes).

- [ ] **Step 1: Implement `src/metrics/config.ts`**

```typescript
export const metricsConfig = {
  maturityLagDays: Number(process.env.METRICS_MATURITY_LAG_DAYS ?? 30),
  minVolumeThreshold: Number(process.env.METRICS_MIN_VOLUME_THRESHOLD ?? 15),
};
```

- [ ] **Step 2: Write the failing test for the aggregation**

```typescript
// src/metrics/aggregate.test.ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/metrics/aggregate.test.ts`
Expected: FAIL — `Cannot find module './aggregate'`

- [ ] **Step 4: Implement `src/metrics/aggregate.ts`**

```typescript
import type { PrismaClient, CutType } from "@prisma/client";
import { metricsConfig } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveWindow(
  now: Date,
  windowDays: number,
  maturityLagDays: number,
): { start: Date; end: Date } {
  const end = new Date(now.getTime() - maturityLagDays * DAY_MS);
  const start = new Date(end.getTime() - windowDays * DAY_MS);
  return { start, end };
}

interface ProductLike {
  model: string;
  color: string | null;
  size: string | null;
  sku: string | null;
  shoeType: string | null;
}

interface ItemWithProduct {
  quantity: number;
  product: ProductLike;
}

interface ReturnWithProduct {
  mappedReason: string | null;
  matchedProduct: ProductLike | null;
}

async function computeCut(
  prisma: PrismaClient,
  cutType: CutType,
  items: ItemWithProduct[],
  returns: ReturnWithProduct[],
  keyFn: (p: ProductLike) => string,
  start: Date,
  end: Date,
): Promise<void> {
  const sold = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item.product);
    sold.set(key, (sold.get(key) ?? 0) + item.quantity);
  }

  const returned = new Map<string, number>();
  for (const r of returns) {
    if (!r.matchedProduct) continue;
    const key = keyFn(r.matchedProduct);
    returned.set(key, (returned.get(key) ?? 0) + 1);
  }

  const totalSold = [...sold.values()].reduce((a, b) => a + b, 0);
  const totalReturned = [...returned.values()].reduce((a, b) => a + b, 0);
  const overallTaxa = totalSold === 0 ? 0 : totalReturned / totalSold;

  const rows = [...sold.entries()].map(([cutValue, unitsSold]) => {
    const unitsReturned = returned.get(cutValue) ?? 0;
    const taxa = unitsSold === 0 ? 0 : unitsReturned / unitsSold;
    return {
      cutType,
      cutValue,
      windowStart: start,
      windowEnd: end,
      unitsSold,
      unitsReturned,
      taxa,
      indice: overallTaxa === 0 ? 0 : taxa / overallTaxa,
      belowMinVolume: unitsSold < metricsConfig.minVolumeThreshold,
    };
  });

  await prisma.$transaction([
    prisma.metricSnapshot.deleteMany({ where: { cutType, windowStart: start, windowEnd: end } }),
    ...rows.map((row) => prisma.metricSnapshot.create({ data: row })),
  ]);
}

async function computeReasonCut(
  prisma: PrismaClient,
  returns: ReturnWithProduct[],
  start: Date,
  end: Date,
): Promise<void> {
  const counts = new Map<string, number>();
  for (const r of returns) {
    const key = r.mappedReason ?? "NAO_MAPEADO";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const rows = [...counts.entries()].map(([cutValue, unitsReturned]) => ({
    cutType: "REASON" as CutType,
    cutValue,
    windowStart: start,
    windowEnd: end,
    unitsSold: total,
    unitsReturned,
    taxa: total === 0 ? 0 : unitsReturned / total,
    indice: 1,
    belowMinVolume: false,
  }));

  await prisma.$transaction([
    prisma.metricSnapshot.deleteMany({ where: { cutType: "REASON", windowStart: start, windowEnd: end } }),
    ...rows.map((row) => prisma.metricSnapshot.create({ data: row })),
  ]);
}

export async function computeMetricSnapshots(
  prisma: PrismaClient,
  options: { now?: Date; windowDays?: number } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 90;
  const { start, end } = resolveWindow(now, windowDays, metricsConfig.maturityLagDays);

  const items = await prisma.orderItem.findMany({
    where: { order: { createdAt: { gte: start, lt: end }, paymentStatus: "paid" } },
    include: { product: true },
  });

  const returns = await prisma.returnRequest.findMany({
    where: { requestedAt: { gte: start, lt: end } },
    include: { matchedProduct: true },
  });

  await computeCut(prisma, "SIZE", items, returns, (p) => p.size ?? "desconhecido", start, end);
  await computeCut(prisma, "COLOR", items, returns, (p) => p.color ?? "desconhecido", start, end);
  await computeCut(prisma, "MODEL", items, returns, (p) => p.model, start, end);
  await computeCut(prisma, "SKU_COLOR", items, returns, (p) => `${p.sku ?? p.model}-${p.color ?? "s/cor"}`, start, end);
  await computeCut(prisma, "SHOE_TYPE", items, returns, (p) => p.shoeType ?? "desconhecido", start, end);
  await computeReasonCut(prisma, returns, start, end);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/metrics/aggregate.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/metrics
git commit -m "feat: compute return-rate and index metrics per cut with lag-aware window"
```

---

### Task 10: Sync orchestration, retry, and status tracking

**Files:**
- Create: `src/sync/syncStatus.ts`
- Create: `src/sync/withRetry.ts`
- Create: `src/sync/runSync.ts`
- Create: `scripts/sync.ts`
- Test: `src/sync/withRetry.test.ts`
- Test: `src/sync/runSync.test.ts`

**Interfaces:**
- Consumes: `ingestNuvemshopOrders`, `syncProductCategories` (Task 3); `ingestTroqueReturnRequests` (Task 5); `matchReturnRequestsToProducts` (Task 6); `syncOrderCancellations` (Task 7); `ingestUmblerMessages` (Task 8); `computeMetricSnapshots` (Task 9).
- Produces: `withRetry<T>(fn, options?): Promise<T>`; `recordSyncResult(prisma, source: "NUVEMSHOP"|"TROQUE"|"UMBLER", result): Promise<void>`; `runSync(prisma, deps): Promise<void>` — invoked by `scripts/sync.ts`, which Task 13's Docker cron calls.

- [ ] **Step 1: Write the failing test for `withRetry`**

```typescript
// src/sync/withRetry.test.ts
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./withRetry";

describe("withRetry", () => {
  it("returns the result once the function succeeds within the retry budget", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    });

    const result = await withRetry(fn, { retries: 3, delayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error once retries are exhausted", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent");
    });

    await expect(withRetry(fn, { retries: 2, delayMs: 1 })).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sync/withRetry.test.ts`
Expected: FAIL — `Cannot find module './withRetry'`

- [ ] **Step 3: Implement `src/sync/withRetry.ts`**

```typescript
export interface RetryOptions {
  retries: number;
  delayMs: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = { retries: 3, delayMs: 1000 },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < options.retries) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sync/withRetry.test.ts`
Expected: PASS

- [ ] **Step 5: Implement `src/sync/syncStatus.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";

export type SourceName = "NUVEMSHOP" | "TROQUE" | "UMBLER";
export type SyncResult = { ok: true } | { ok: false; error: string };

export async function recordSyncResult(
  prisma: PrismaClient,
  source: SourceName,
  result: SyncResult,
): Promise<void> {
  await prisma.syncStatus.upsert({
    where: { source },
    update: {
      lastRunAt: new Date(),
      ...(result.ok ? { lastSuccessAt: new Date(), lastError: null } : { lastError: result.error }),
    },
    create: {
      source,
      lastRunAt: new Date(),
      lastSuccessAt: result.ok ? new Date() : null,
      lastError: result.ok ? null : result.error,
    },
  });
}
```

- [ ] **Step 6: Write the failing test for `runSync`**

```typescript
// src/sync/runSync.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../tests/setupDb";
import { runSync } from "./runSync";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("runSync", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("isolates a failing source from the others and records status for each", async () => {
    await runSync(prisma, {
      nuvemshop: { fetchOrdersSince: async () => [] },
      nuvemshopProducts: { fetchProducts: async () => [] },
      troque: {
        fetchReturnRequestsSince: async () => {
          throw new Error("Troque Commerce is down");
        },
      },
      umbler: { fetchMessagesSince: async () => [] },
    });

    const statuses = await prisma.syncStatus.findMany();
    const bySource = Object.fromEntries(statuses.map((s) => [s.source, s]));

    expect(bySource.NUVEMSHOP.lastError).toBeNull();
    expect(bySource.TROQUE.lastError).toContain("Troque Commerce is down");
    expect(bySource.UMBLER.lastError).toBeNull();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/sync/runSync.test.ts`
Expected: FAIL — `Cannot find module './runSync'`

- [ ] **Step 8: Implement `src/sync/runSync.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import type { NuvemshopOrdersSource, NuvemshopProduct } from "../connectors/nuvemshop/client";
import type { TroqueReturnSource } from "../connectors/troque/client";
import type { UmblerMessageSource } from "../connectors/umbler/client";
import { ingestNuvemshopOrders } from "../connectors/nuvemshop/ingest";
import { ingestTroqueReturnRequests } from "../connectors/troque/ingest";
import { matchReturnRequestsToProducts } from "../connectors/troque/matching";
import { syncOrderCancellations } from "../connectors/nuvemshop/cancellations";
import { ingestUmblerMessages } from "../connectors/umbler/ingest";
import { computeMetricSnapshots } from "../metrics/aggregate";
import { withRetry } from "./withRetry";
import { recordSyncResult, type SourceName } from "./syncStatus";

export interface RunSyncDeps {
  nuvemshop: NuvemshopOrdersSource;
  nuvemshopProducts: { fetchProducts(): Promise<NuvemshopProduct[]> };
  troque: TroqueReturnSource;
  umbler: UmblerMessageSource;
}

async function runSource(prisma: PrismaClient, source: SourceName, fn: () => Promise<void>): Promise<void> {
  try {
    await withRetry(fn);
    await recordSyncResult(prisma, source, { ok: true });
  } catch (err) {
    await recordSyncResult(prisma, source, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runSync(prisma: PrismaClient, deps: RunSyncDeps): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await runSource(prisma, "NUVEMSHOP", () => ingestNuvemshopOrders(prisma, deps.nuvemshop, since));
  await runSource(prisma, "TROQUE", async () => {
    await ingestTroqueReturnRequests(prisma, deps.troque, since);
    await matchReturnRequestsToProducts(prisma);
  });
  await runSource(prisma, "UMBLER", () => ingestUmblerMessages(prisma, deps.umbler, since));

  await syncOrderCancellations(prisma);
  await computeMetricSnapshots(prisma);
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/sync/runSync.test.ts`
Expected: PASS

- [ ] **Step 10: Create the cron entrypoint script**

```typescript
// scripts/sync.ts
import { PrismaClient } from "@prisma/client";
import { NuvemshopClient } from "../src/connectors/nuvemshop/client";
import { TroqueClient } from "../src/connectors/troque/client";
import { UmblerClient } from "../src/connectors/umbler/client";
import { runSync } from "../src/sync/runSync";

const prisma = new PrismaClient();

const nuvemshop = new NuvemshopClient({
  storeId: process.env.NUVEMSHOP_STORE_ID!,
  accessToken: process.env.NUVEMSHOP_ACCESS_TOKEN!,
  userAgent: process.env.NUVEMSHOP_USER_AGENT ?? "regina-rios-devolucoes",
});

runSync(prisma, {
  nuvemshop,
  nuvemshopProducts: nuvemshop,
  troque: new TroqueClient({
    baseUrl: process.env.TROQUE_BASE_URL!,
    apiKey: process.env.TROQUE_API_KEY!,
  }),
  umbler: new UmblerClient({
    baseUrl: process.env.UMBLER_BASE_URL!,
    apiKey: process.env.UMBLER_API_KEY!,
  }),
})
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 11: Commit**

```bash
git add src/sync scripts/sync.ts
git commit -m "feat: add sync orchestration with per-source isolation, retry, and status tracking"
```

---

### Task 11: Authentication

**Files:**
- Create: `src/auth/config.ts`
- Create: `src/auth/verify.ts`
- Create: `src/auth/session.ts`
- Create: `middleware.ts`
- Create: `app/login/page.tsx`
- Create: `app/api/login/route.ts`
- Test: `src/auth/verify.test.ts`
- Test: `src/auth/session.test.ts`

**Interfaces:**
- Produces: `loadUsers(): AppUser[]`; `hashPassword(password, salt): string`; `verifyPassword(password, salt, expectedHash): boolean`; `createSessionToken(username, secret): string`; `verifySessionToken(token, secret): { username: string } | null`; `COOKIE_NAME`. Used by `middleware.ts` and `app/api/login/route.ts`, and by Task 12's dashboard (protected by the same middleware).

- [ ] **Step 1: Write the failing test for password hashing**

```typescript
// src/auth/verify.test.ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./verify";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const salt = "some-salt";
    const hash = hashPassword("correct-horse", salt);
    expect(verifyPassword("correct-horse", salt, hash)).toBe(true);
    expect(verifyPassword("wrong-password", salt, hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/auth/verify.test.ts`
Expected: FAIL — `Cannot find module './verify'`

- [ ] **Step 3: Implement `src/auth/verify.ts` and `src/auth/config.ts`**

```typescript
// src/auth/verify.ts
import { scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

```typescript
// src/auth/config.ts
export interface AppUser {
  username: string;
  passwordHash: string;
}

export function loadUsers(): AppUser[] {
  const raw = process.env.APP_USERS ?? ""; // format: "user1:hash1,user2:hash2"
  return raw
    .split(",")
    .filter(Boolean)
    .map((entry) => {
      const [username, passwordHash] = entry.split(":");
      return { username, passwordHash };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/auth/verify.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the session token**

```typescript
// src/auth/session.test.ts
import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken } from "./session";

describe("session tokens", () => {
  it("round-trips the username with the correct secret", () => {
    const token = createSessionToken("daphinny", "secret-1");
    expect(verifySessionToken(token, "secret-1")).toEqual({ username: "daphinny" });
  });

  it("rejects a token verified with the wrong secret", () => {
    const token = createSessionToken("daphinny", "secret-1");
    expect(verifySessionToken(token, "secret-2")).toBeNull();
  });

  it("rejects a tampered token", () => {
    const token = createSessionToken("daphinny", "secret-1");
    const tampered = token.replace(/.$/, token.endsWith("a") ? "b" : "a");
    expect(verifySessionToken(tampered, "secret-1")).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/auth/session.test.ts`
Expected: FAIL — `Cannot find module './session'`

- [ ] **Step 7: Implement `src/auth/session.ts`**

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "rr_session";

export function createSessionToken(username: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ username, issuedAt: Date.now() })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): { username: string } | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { username: string };
  return { username: data.username };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/auth/session.test.ts`
Expected: PASS

- [ ] **Step 9: Wire up the middleware, login page, and login route**

```typescript
// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/src/auth/session";

export function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? verifySessionToken(token, process.env.SESSION_SECRET!) : null;
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next|api/login|login).*)"] };
```

```typescript
// app/api/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { loadUsers } from "@/src/auth/config";
import { verifyPassword } from "@/src/auth/verify";
import { createSessionToken, COOKIE_NAME } from "@/src/auth/session";

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();
  const user = loadUsers().find((u) => u.username === username);
  const salt = process.env.APP_PASSWORD_SALT!;

  if (!user || !verifyPassword(password, salt, user.passwordHash)) {
    return NextResponse.json({ error: "Usuário ou senha inválidos" }, { status: 401 });
  }

  const token = createSessionToken(user.username, process.env.SESSION_SECRET!);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", path: "/" });
  return response;
}
```

```tsx
// app/login/page.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      setError("Usuário ou senha inválidos");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="usuário" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="senha" />
      <button type="submit">Entrar</button>
      {error && <p>{error}</p>}
    </form>
  );
}
```

- [ ] **Step 10: Generate real password hashes for the two accounts**

Run (once, using a real salt and password for each user):
```bash
node -e "console.log(require('crypto').scryptSync(process.argv[1], process.argv[2], 64).toString('hex'))" "<senha-daphinny>" "<APP_PASSWORD_SALT>"
```
Set `APP_USERS=daphinny:<hash1>,rita:<hash2>` and `APP_PASSWORD_SALT`/`SESSION_SECRET` in `.env`.

- [ ] **Step 11: Manual verification**

Run: `npm run dev`, visit `http://localhost:3000/dashboard` — expect redirect to `/login`. Log in with the seeded credentials — expect redirect back to `/dashboard`.

- [ ] **Step 12: Commit**

```bash
git add src/auth middleware.ts app/login app/api/login
git commit -m "feat: add credential-based login and session middleware"
```

---

### Task 12: Dashboard

**Files:**
- Create: `src/dashboard/queries.ts`
- Create: `app/dashboard/page.tsx`
- Test: `src/dashboard/queries.test.ts`

**Note:** this task covers data plumbing and a functional layout. Before polishing chart styling/colors, consult the `dataviz` skill for this project's visual conventions — that skill is not re-derived here.

**Interfaces:**
- Consumes: `prisma.metricSnapshot`, `prisma.syncStatus` (Task 2, Task 9, Task 10).
- Produces: `getLatestSnapshots(prisma, cutType, options?: { includeLowVolume?: boolean }): Promise<MetricSnapshot[]>`; `getSyncStatuses(prisma): Promise<SyncStatus[]>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/queries.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../../tests/setupDb";
import { getLatestSnapshots } from "./queries";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

describe("getLatestSnapshots", () => {
  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns only the most recent window, sorted by taxa desc, excluding low volume by default", async () => {
    const oldWindow = { windowStart: new Date("2026-05-01"), windowEnd: new Date("2026-08-01") };
    const newWindow = { windowStart: new Date("2026-06-01"), windowEnd: new Date("2026-09-01") };

    await prisma.metricSnapshot.create({
      data: { cutType: "SIZE", cutValue: "OLD", ...oldWindow, unitsSold: 100, unitsReturned: 1, taxa: 0.01, indice: 0.1, belowMinVolume: false, computedAt: new Date("2026-08-01") },
    });
    await prisma.metricSnapshot.create({
      data: { cutType: "SIZE", cutValue: "37", ...newWindow, unitsSold: 20, unitsReturned: 8, taxa: 0.4, indice: 2, belowMinVolume: false, computedAt: new Date("2026-09-01") },
    });
    await prisma.metricSnapshot.create({
      data: { cutType: "SIZE", cutValue: "34", ...newWindow, unitsSold: 5, unitsReturned: 2, taxa: 0.4, indice: 2, belowMinVolume: true, computedAt: new Date("2026-09-01") },
    });

    const result = await getLatestSnapshots(prisma, "SIZE");

    expect(result.map((r) => r.cutValue)).toEqual(["37"]);
  });

  it("includes low-volume rows when includeLowVolume is true", async () => {
    const window = { windowStart: new Date("2026-06-01"), windowEnd: new Date("2026-09-01") };
    await prisma.metricSnapshot.create({
      data: { cutType: "SIZE", cutValue: "34", ...window, unitsSold: 5, unitsReturned: 2, taxa: 0.4, indice: 2, belowMinVolume: true, computedAt: new Date("2026-09-01") },
    });

    const result = await getLatestSnapshots(prisma, "SIZE", { includeLowVolume: true });
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/dashboard/queries.test.ts`
Expected: FAIL — `Cannot find module './queries'`

- [ ] **Step 3: Implement `src/dashboard/queries.ts`**

```typescript
import type { PrismaClient, CutType, MetricSnapshot, SyncStatus } from "@prisma/client";

export async function getLatestSnapshots(
  prisma: PrismaClient,
  cutType: CutType,
  options: { includeLowVolume?: boolean } = {},
): Promise<MetricSnapshot[]> {
  const latestWindow = await prisma.metricSnapshot.findFirst({
    where: { cutType },
    orderBy: { computedAt: "desc" },
    select: { windowStart: true, windowEnd: true },
  });
  if (!latestWindow) return [];

  return prisma.metricSnapshot.findMany({
    where: {
      cutType,
      windowStart: latestWindow.windowStart,
      windowEnd: latestWindow.windowEnd,
      ...(options.includeLowVolume ? {} : { belowMinVolume: false }),
    },
    orderBy: { taxa: "desc" },
  });
}

export async function getSyncStatuses(prisma: PrismaClient): Promise<SyncStatus[]> {
  return prisma.syncStatus.findMany();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=$DATABASE_URL_TEST npx vitest run src/dashboard/queries.test.ts`
Expected: PASS

- [ ] **Step 5: Build the dashboard page (Server Component)**

```tsx
// app/dashboard/page.tsx
import { prisma } from "@/src/lib/prisma";
import { getLatestSnapshots, getSyncStatuses } from "@/src/dashboard/queries";

const BLOCKS = [
  { cutType: "SIZE" as const, title: "Numeração" },
  { cutType: "COLOR" as const, title: "Cor" },
  { cutType: "SKU_COLOR" as const, title: "Modelo/SKU crítico" },
  { cutType: "SHOE_TYPE" as const, title: "Tipo de calçado" },
];

export default async function DashboardPage() {
  const [blocks, reasonBreakdown, syncStatuses] = await Promise.all([
    Promise.all(BLOCKS.map(async (b) => ({ ...b, rows: await getLatestSnapshots(prisma, b.cutType) }))),
    getLatestSnapshots(prisma, "REASON"),
    getSyncStatuses(prisma),
  ]);

  return (
    <main>
      <h1>Devoluções — Regina Rios</h1>

      <section>
        <h2>Status de sincronização</h2>
        <ul>
          {syncStatuses.map((s) => (
            <li key={s.source}>
              {s.source}: {s.lastError ? `erro — ${s.lastError}` : `ok (última sincronização: ${s.lastSuccessAt?.toLocaleString("pt-BR") ?? "nunca"})`}
            </li>
          ))}
        </ul>
      </section>

      {blocks.map((block) => (
        <section key={block.cutType}>
          <h2>{block.title}</h2>
          <table>
            <thead>
              <tr>
                <th>Valor</th>
                <th>Taxa</th>
                <th>Índice</th>
                <th>Vendidos</th>
                <th>Devolvidos</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.cutValue}</td>
                  <td>{(row.taxa * 100).toFixed(1)}%</td>
                  <td>{row.indice.toFixed(2)}</td>
                  <td>{row.unitsSold}</td>
                  <td>{row.unitsReturned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section>
        <h2>Distribuição de motivos</h2>
        <table>
          <thead>
            <tr>
              <th>Motivo</th>
              <th>Quantidade</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {reasonBreakdown.map((row) => (
              <tr key={row.id}>
                <td>{row.cutValue}</td>
                <td>{row.unitsReturned}</td>
                <td>{(row.taxa * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, log in, and visit `/dashboard`. With the fixture data seeded by earlier tests not present in the dev DB, this will show empty tables and sync statuses — that's expected until Task 10's `runSync` has run against real credentials. Confirm the page renders without runtime errors and the sync status section lists `NUVEMSHOP`/`TROQUE`/`UMBLER` once a sync has run at least once (can dry-run `npm run sync` against the dev DB with stub env vars pointed at a local mock server, or simply confirm via `curl` that the route returns 200 after logging in).

- [ ] **Step 7: Commit**

```bash
git add src/dashboard app/dashboard
git commit -m "feat: add dashboard reading pre-aggregated metric snapshots"
```

---

### Task 13: Docker packaging and deploy config

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.next
.git
.env
docker-compose.dev.yml
```

- [ ] **Step 2: Create the multi-stage `Dockerfile`**

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O - http://localhost:3000/api/health || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
```

- [ ] **Step 3: Create `docker-compose.yml` (production)**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - "3000:3000"
    depends_on:
      - db

  cron:
    build: .
    restart: unless-stopped
    env_file: .env
    depends_on:
      - db
    entrypoint:
      - sh
      - -c
      - "echo '0 4 * * * cd /app && npx tsx scripts/sync.ts >> /proc/1/fd/1 2>&1' | crontab - && crond -f"

  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: regina_devolucoes
      POSTGRES_USER: regina
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data

volumes:
  db_data:
```

`tsx` needs to be a runtime dependency (not dev-only) for the `cron` service to run `scripts/sync.ts` directly in the built image — move it from `devDependencies` to `dependencies` in `package.json` (Task 1) before this task, or install it explicitly in the `runtime` stage of the `Dockerfile`.

- [ ] **Step 4: Move `tsx` to runtime dependencies**

```bash
npm install tsx
npm uninstall --save-dev tsx
```

- [ ] **Step 5: Verify the image builds**

Run: `docker compose build`
Expected: build succeeds through all three stages.

- [ ] **Step 6: Verify the database migrates and the app starts**

Run: `POSTGRES_PASSWORD=temporary_password docker compose up -d db`
Run: `POSTGRES_PASSWORD=temporary_password docker compose run --rm app npx prisma migrate deploy`
Expected: migration applies against the compose `db` service.

Run: `POSTGRES_PASSWORD=temporary_password docker compose up -d app`
Run: `curl http://localhost:3000/api/health`
Expected: `{"status":"ok",...}`. (The `cron` service and dashboard will only produce real data once the `.env` credentials for Nuvemshop/Troque Commerce/Umbler are filled in — that's expected at this stage.)

Run: `docker compose down`

- [ ] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore package.json package-lock.json
git commit -m "feat: package app and cron sync for Docker deployment"
```

---

## Self-Review Notes

- **Spec coverage:** §2 sources → Tasks 3/5/8; §3 decisões (janela, corte mínimo, cancelamento separado, IG/FB fora) → Global Constraints + Task 7 + Task 9; §4 taxonomia → Task 4; §5 arquitetura → Tasks 1/13; §6 modelo/normalização → Tasks 2/6; §7 cálculo → Task 9; §8 dashboard → Task 12; §9 erros/observabilidade → Task 10; §10 testes → embedded per task (TDD throughout); §11 deploy → Task 13; §12 riscos → mitigated by Task 6 (matching fallback), Task 9 (maturity lag); §13/§14 → explicitly out of scope, not covered by any task.
- **Placeholder scan:** none — every step has runnable code or an exact command; the two external-API caveats (Tasks 5, 8) are explicit scope notes, not "TBD".
- **Type consistency checked:** `NuvemshopOrdersSource`, `TroqueReturnSource`, `UmblerMessageSource` are defined once (Tasks 3/5/8) and reused verbatim in Tasks 6, 9, 10. `metricsConfig` (Task 9) is the single source for `maturityLagDays`/`minVolumeThreshold`, referenced nowhere else redundantly. `MetricSnapshot` field names match between Task 9 (writer) and Task 12 (reader).
- **Scope:** all 13 tasks form one deployable pipeline (ingest → match → compute → show); none is independently shippable in isolation before Task 9, which is expected for a pipeline rather than independent subsystems — no further decomposition needed.
