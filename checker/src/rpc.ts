// Minimal NEAR JSON-RPC client (fetch only). Works against the local sandbox and testnet.

export class RpcError extends Error {
  constructor(
    message: string,
    readonly cause_name?: string,
  ) {
    super(message);
  }
}

export interface AccountView {
  amount: string;
  code_hash: string;
  storage_usage: number;
}

export interface AccessKeyInfo {
  public_key: string;
  access_key: { nonce: number; permission: unknown };
}

/** Code hash of an account with no contract deployed. */
export const EMPTY_CODE_HASH = "11111111111111111111111111111111";

export type Finality = "optimistic" | "final";

export class Rpc {
  private id = 0;
  /**
   * Reads default to `optimistic` so a verdict sees the vault's latest log entries, including
   * ones from transactions that finished a block ago.
   */
  constructor(
    readonly url: string,
    readonly finality: Finality = "optimistic",
  ) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    if (!res.ok) throw new RpcError(`RPC ${method} HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: T & { error?: string };
      error?: { message?: string; data?: unknown; cause?: { name?: string } };
    };
    if (body.error) {
      throw new RpcError(
        `RPC ${method}: ${body.error.cause?.name ?? body.error.message ?? "error"}`,
        body.error.cause?.name,
      );
    }
    // Older nodes report query errors inside `result.error`.
    if (body.result && typeof body.result === "object" && "error" in body.result && body.result.error) {
      throw new RpcError(`RPC ${method}: ${body.result.error}`);
    }
    return body.result as T;
  }

  async block(blockId?: number): Promise<{ height: number; timestampMs: number }> {
    const params = blockId === undefined ? { finality: this.finality } : { block_id: blockId };
    const b = await this.call<{ header: { height: number; timestamp_nanosec: string } }>("block", params);
    return {
      height: b.header.height,
      timestampMs: Number(BigInt(b.header.timestamp_nanosec) / 1_000_000n),
    };
  }

  /** Account state, or null if the account does not exist. */
  async viewAccount(accountId: string): Promise<AccountView | null> {
    try {
      return await this.call<AccountView>("query", {
        request_type: "view_account",
        finality: this.finality,
        account_id: accountId,
      });
    } catch (e) {
      if (e instanceof RpcError && /UNKNOWN_ACCOUNT|does not exist/i.test(`${e.cause_name} ${e.message}`)) {
        return null;
      }
      throw e;
    }
  }

  async accessKeys(accountId: string): Promise<AccessKeyInfo[]> {
    const r = await this.call<{ keys: AccessKeyInfo[] }>("query", {
      request_type: "view_access_key_list",
      finality: this.finality,
      account_id: accountId,
    });
    return r.keys;
  }

  async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await this.call<{ result: number[] }>("query", {
      request_type: "call_function",
      finality: this.finality,
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
  }
}
