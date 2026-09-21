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
