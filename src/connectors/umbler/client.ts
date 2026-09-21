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
