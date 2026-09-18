# Cruzamento de reclamações por canal — Design

Data: 2026-09-18

## 1. Objetivo

Identificar os motivos recorrentes de insatisfação das clientes (numeração,
cor, conforto, qualidade, prazo) e ligar cada motivo a modelo, cor e tamanho
específicos, para virar decisão de compra, de forma e de foto.

## 2. Fontes de dados

| Fonte | O que entrega | Como entra | Papel |
|---|---|---|---|
| Nuvemshop | Vendas, devoluções, cancelamentos, modelo/cor/tamanho/SKU | API | Fonte do catálogo e do denominador (pares vendidos) |
| Troque Commerce | Motivo declarado da troca/devolução, por pedido | API | Fonte primária do motivo |
| Umbler | Queixa em texto livre (WhatsApp), pré e pós-venda | API (credenciais entram após Nuvemshop + Troque Commerce) | Camada qualitativa |
| Instagram / Facebook | Comentários e direct | Meta Graph API — **fase futura**, fora do escopo desta versão | Camada qualitativa futura |
| E-mail | — | Descartado — sem cliente final identificável | Fora de escopo |

Nuvemshop e Troque Commerce são o núcleo (dados quantitativos, taxa de
devolução). Umbler entra como camada qualitativa desde o início da
arquitetura, mesmo que as credenciais só sejam plugadas depois. Instagram e
Facebook entram na arquitetura como extensão prevista, mas sem
implementação nesta versão — exigem app revisado pelo Meta Business, o que
adicionaria fricção sem valor imediato para o núcleo do projeto.

O Martz (já configurado como ferramenta de marketing) não é usado como fonte
neste projeto — não chega ao nível de motivo/produto necessário.

## 3. Decisões de negócio (fechadas)

- **Janela de tempo padrão**: 90 dias, configurável.
- **Cancelamento por falha de pagamento**: tratado separado da devolução
  pós-entrega. Cancelamento nunca é "venda" — não entra no denominador.
- **Corte mínimo de volume para ranking**: parâmetro configurável, não um
  número fixo no código. Ajustado após a primeira coleta real, olhando a
  distribuição real de volume por SKU. Abaixo do corte, o item some do
  ranking padrão mas continua visível num modo "ver tudo", com aviso de
  baixo volume.
- **Instagram/Facebook**: entram como extensão futura prevista na
  arquitetura, não implementados nesta versão.

## 4. Taxonomia de motivos

- **NUMERAÇÃO** — veste menor, veste maior, dúvida de qual pedir
- **COR** — diferente da foto
- **CONFORTO** — machuca, dói, salto instável
- **QUALIDADE** — descolou, quebrou, solado
- **ENTREGA** — prazo, extravio
- **ESTOQUE** — não tem meu número
- **ARREPENDIMENTO** — sem defeito
- **PROCESSO** — dificuldade com a troca em si

Motivos brutos da Troque Commerce são traduzidos para essa taxonomia fixa
por uma tabela de configuração (`ReasonMapping`), ajustável sem alterar
código.

## 5. Arquitetura

Monólito Next.js (App Router, TypeScript), rodando em Docker, isolado do
painel que já existe no VPS da Regina Rios.

```
Nuvemshop API   Troque Commerce API   Umbler API
      \                |                  /
       \               |                 /
        Worker de ingestão (cron, módulos por fonte)
                       |
              Normalização de produto
                       |
                   Postgres
          (raw + normalizado + métricas agregadas)
                       |
              Job de agregação (taxa/índice)
                       |
              Next.js app (dashboard + login)
```

Justificativa: um único runtime (TypeScript ponta a ponta), sem infra extra
(fila, microserviço) que essa escala não justifica agora. Os módulos de
ingestão, normalização, cálculo e dashboard ficam isolados internamente com
interfaces claras — se o volume ou o número de canais crescer a ponto de
justificar separar em serviços, a migração é mecânica, não uma reescrita.

**Stack:**
- Next.js (App Router) + React Server Components
- TypeScript ponta a ponta
- Postgres + Prisma (schema tipado, migrations versionadas)
- Docker multi-stage build (imagem final magra)
- Cron do próprio container dispara ingestão + agregação em horário fixo
- Login simples (duas contas: Daphinny e Rita), sem OAuth/cadastro público
- Reverse proxy (Caddy, HTTPS automático) — domínio a decidir no momento do
  deploy, não bloqueia o desenvolvimento

## 6. Modelo de dados e normalização

**Insight central**: a Troque Commerce sempre referencia um pedido
específico da Nuvemshop. O casamento entre as duas bases não depende de
comparar texto de produto livre — depende de casar pelo número do pedido.

Fluxo de casamento:
1. Toda solicitação de troca/devolução na Troque Commerce traz referência ao
   pedido da Nuvemshop.
2. Buscamos esse pedido na Nuvemshop e pegamos seus itens (SKU, modelo, cor,
   tamanho) — fonte oficial do catálogo.
3. Pedido com um item só → devolução ligada automaticamente a esse SKU.
   Pedido com vários itens → comparamos o texto do produto informado pela
   Troque Commerce contra os itens *daquele pedido* (universo pequeno, não o
   catálogo inteiro). Sem confiança suficiente → fila de revisão manual, sem
   adivinhar.

**Entidades:**

- `Product` (canônico): model, color, size, sku, tipo de calçado — ancorado
  no catálogo da Nuvemshop.
- `ProductAlias`: mapeamento de texto/SKU de cada fonte → `Product`
  canônico, incluindo casos de baixa confiança pendentes de revisão manual.
- `Order` / `OrderItem`: pedidos e itens vindos da Nuvemshop.
- `ReturnRequest`: solicitação da Troque Commerce — motivo bruto, motivo
  mapeado (taxonomia), tipo (troca/devolução), status.
- `OrderCancellation`: cancelamento por falha de pagamento, vindo da
  Nuvemshop — entidade separada de `ReturnRequest`.
- `WhatsAppMessage` (Umbler): texto livre; vínculo a produto é opcional e
  manual — camada qualitativa, não entra no cálculo de taxa.
- `ReasonMapping`: configuração texto/código → taxonomia fixa.
- `MetricSnapshot`: métricas pré-computadas por corte e janela (ver seção
  7), lidas diretamente pelo dashboard.

## 7. Cálculo de taxa e índice

- **Denominador limpo**: só pedidos com pagamento confirmado contam como
  "vendido". `OrderCancellation` fica fora do denominador inteiramente.
- **Taxa** = pares devolvidos ÷ pares vendidos, no mesmo recorte e janela.
- **Índice** = taxa do item ÷ taxa geral do mesmo período (1,0 = na média,
  2,0 = devolve o dobro).
- **Cortes**: tamanho, cor, modelo, SKU+cor, tipo de calçado, motivo.
- **Efeito de lag**: pedidos dos últimos ~30 dias (configurável) ficam
  marcados como "dado imaturo" e excluídos do ranking principal — a
  devolução ainda não teve tempo de acontecer. Evita que o mês corrente
  pareça artificialmente bom.
- **Corte mínimo de volume**: configurável (ver seção 3), não fixo no
  código.
- Tudo pré-calculado num job de agregação após a ingestão, gravado em
  `MetricSnapshot`. O dashboard nunca calcula em tempo real, só lê.

## 8. Dashboard

Quatro blocos — numeração, cor, modelo/SKU crítico, tipo de calçado — cada
um com:
- Taxa em destaque + volume ao lado
- Distribuição de motivos por trás (por categoria da taxonomia)
- Indicador visual para baixo volume / dado imaturo

Filtros no topo: janela de tempo, corte mínimo (toggle "ver tudo"). Área
qualitativa separada e menor, com trechos de WhatsApp/Instagram ligados aos
itens piores do ranking (quando essas fontes estiverem plugadas) — contexto
para o "porquê", não entra no cálculo de taxa.

## 9. Erros e observabilidade

- Cada fonte (Nuvemshop, Troque Commerce, Umbler) roda de forma
  independente no job de ingestão — falha em uma não bloqueia as outras.
- Retry com backoff para falha transitória de API.
- Cada fonte grava seu "última sincronização bem-sucedida", visível num
  painel de status simples dentro do próprio dashboard.
- Sem alerta externo (e-mail/Slack) nesta versão — pode ser adicionado
  depois se fizer falta.

## 10. Testes

- Foco no ponto frágil: casamento pedido↔devolução↔produto. Casos de borda
  cobertos: pedido com item único, pedido com múltiplos itens, motivo sem
  mapeamento na taxonomia, baixa confiança de match caindo para revisão
  manual.
- Cálculo de taxa/índice testado com dados sintéticos conhecidos, garantindo
  que o número bate com o esperado antes de confiar no dashboard.

## 11. Deploy

- `Dockerfile` multi-stage + `docker-compose.yml` (app + Postgres), isolado
  do painel já existente no VPS.
- Migrations do Prisma versionadas no repositório, aplicadas no deploy.
- Credenciais (Nuvemshop, Troque Commerce, Umbler) via variáveis de
  ambiente, nunca no código.
- Cron do próprio container dispara ingestão + agregação em horário fixo.
- Domínio/reverse proxy a decidir no momento do deploy.

## 12. Riscos

- WhatsApp e redes podem não estar acessíveis a tempo — o núcleo
  (Nuvemshop + Troque Commerce) funciona sem eles, mas perde a voz da
  cliente.
- Nomes de produto inconsistentes entre bases podem quebrar casamentos que
  não sejam resolvidos pela referência de pedido (mitigado pela fila de
  revisão manual — seção 6).
- Mês corrente parece "melhor" pelo lag da devolução (mitigado pela marca de
  "dado imaturo" — seção 7).

## 13. Em aberto (não bloqueia o início da implementação)

- Repositório remoto (GitHub privado ou não) — decidir quando a estrutura
  inicial estiver de pé.
- (Sub)domínio de produção — decidir no momento do deploy.
- Valor exato do corte mínimo de volume — decidir após ver a distribuição
  real de dados da primeira coleta.
- Credenciais/documentação de Nuvemshop, Troque Commerce e Umbler — a
  fornecer pela usuária antes da implementação dos conectores.

## 14. Extensões futuras previstas (fora do escopo desta versão)

Registradas aqui para não se perderem e para a arquitetura não fechar porta
para elas — sem desenho detalhado ainda, a refinar quando entrarem em
escopo.

- **Categorias de dor além da taxonomia de devolução, via Umbler**: defeito
  de fábrica fora do fluxo de troca, furo de estoque, caso isolado de
  extravio com transportadora, entre outros. A entidade `WhatsAppMessage`
  já é texto livre e comporta uma taxonomia de tags mais ampla que a da
  seção 4 (que é específica de motivo de troca/devolução) — quando esse
  trabalho entrar em escopo, é uma tabela de tags nova e uma etapa de
  classificação sobre o texto já ingerido, não uma mudança estrutural.
- **Relatório de oportunidades de venda (clientes em stand-by)**: clientes
  com intenção de compra que não avançou, a reabordar. É um relatório
  distinto do núcleo de devolução — provavelmente lê dados de cliente/pedido
  da Nuvemshop (possivelmente cruzando com a rotina já existente de
  carrinho abandonado da Regina Rios) mas com critério próprio de "parado".
  Compartilha a mesma base (Postgres) e pode virar uma seção nova dentro do
  mesmo dashboard, porém é escopo suficiente para merecer seu próprio
  brainstorm quando chegar a vez.
