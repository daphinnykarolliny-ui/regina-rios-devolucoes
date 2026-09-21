import { PrismaClient, type ReasonCategory } from "@prisma/client";
import { normalizeReasonText } from "../src/taxonomy/reasonMapping";

const prisma = new PrismaClient();

const SEED: { text: string; reason: ReasonCategory }[] = [
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
        mappedReason: entry.reason,
        active: true,
      },
    });
  }
  console.log(`Seeded ${SEED.length} reason mappings.`);
}

main().finally(() => prisma.$disconnect());
