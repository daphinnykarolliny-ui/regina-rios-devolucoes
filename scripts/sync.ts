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
