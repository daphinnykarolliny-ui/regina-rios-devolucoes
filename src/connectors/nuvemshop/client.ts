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
