// Optional account history from the NearBlocks API (used when NEARBLOCKS_API_KEY is set).

export class NearBlocks {
  constructor(
    readonly baseUrl: string,
    readonly apiKey: string,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`NearBlocks ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Creation time of the account in ms, or null if NearBlocks does not know it. */
  async createdMs(accountId: string): Promise<number | null> {
    const r = await this.get<{ account?: Array<{ created?: { block_timestamp?: number | string | null } }> }>(
      `/v1/account/${encodeURIComponent(accountId)}`,
    );
    const ts = r.account?.[0]?.created?.block_timestamp;
    return ts === undefined || ts === null ? null : Number(BigInt(ts) / 1_000_000n);
  }

  async txCount(accountId: string): Promise<number | null> {
    const r = await this.get<{ txns?: Array<{ count?: string | number }> }>(
      `/v1/account/${encodeURIComponent(accountId)}/txns/count`,
    );
    const c = r.txns?.[0]?.count;
    return c === undefined ? null : Number(c);
  }
}

export function defaultNearBlocksUrl(network: string): string {
  return network === "mainnet" ? "https://api.nearblocks.io" : "https://api-testnet.nearblocks.io";
}
