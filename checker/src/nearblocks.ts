// Optional account history from the NearBlocks API v3 (used when NEARBLOCKS_API_KEY is set).
// v3 wraps every result in { data, meta }. The tx-count endpoint is internal-only in v3, so the
// count is taken from one page of the account's transactions and is capped at TX_PAGE.

export const TX_PAGE = 25;

export class NearBlocks {
  constructor(
    readonly baseUrl: string,
    readonly apiKey: string,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}`, accept: "application/json" } : { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`NearBlocks ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Creation time of the account in ms, or null if NearBlocks does not know it. */
  async createdMs(accountId: string): Promise<number | null> {
    const r = await this.get<{ data?: { created?: { block_timestamp?: number | string | null } } | null }>(
      `/v3/accounts/${encodeURIComponent(accountId)}`,
    );
    const ts = r.data?.created?.block_timestamp;
    return ts === undefined || ts === null ? null : Number(BigInt(ts) / 1_000_000n);
  }

  /** Transactions involving the account, capped at TX_PAGE (enough for the LOW_ACTIVITY < 3 check). */
  async txCount(accountId: string): Promise<number | null> {
    const r = await this.get<{ data?: unknown[] | null }>(
      `/v3/accounts/${encodeURIComponent(accountId)}/txns?limit=${TX_PAGE}`,
    );
    return Array.isArray(r.data) ? r.data.length : null;
  }
}

export function defaultNearBlocksUrl(network: string): string {
  return network === "mainnet" ? "https://api.nearblocks.io" : "https://api-testnet.nearblocks.io";
}
