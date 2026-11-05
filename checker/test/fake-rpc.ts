// In-memory stand-in for the NEAR RPC used by the checker tests.
import type { AccessKeyInfo, AccountView, Rpc } from "../src/rpc.ts";
import type { LogEntry, Policy } from "../src/types.ts";

export interface FakeChain {
  height: number;
  nowMs: number;
  /** height -> timestamp ms */
  blocks: Map<number, number>;
  accounts: Map<string, AccountView>;
  keys: Map<string, AccessKeyInfo[]>;
  policy: Policy;
  log: LogEntry[];
}

export function fakeRpc(chain: FakeChain): Rpc {
  return {
    url: "fake://",
    finality: "optimistic",
    async block(h?: number) {
      if (h === undefined) return { height: chain.height, timestampMs: chain.nowMs };
      const ts = chain.blocks.get(h);
      if (ts === undefined) throw new Error("UNKNOWN_BLOCK");
      return { height: h, timestampMs: ts };
    },
    async viewAccount(id: string) {
      return chain.accounts.get(id) ?? null;
    },
    async accessKeys(id: string) {
      return chain.keys.get(id) ?? [];
    },
    async view(_contract: string, method: string, args: Record<string, unknown> = {}) {
      if (method === "get_policy") return chain.policy;
      if (method === "get_info") return { log_len: chain.log.length };
      if (method === "get_log") {
        const from = Number(args.from_index ?? 0);
        return chain.log.slice(from, from + Number(args.limit ?? 20));
      }
      throw new Error(`unexpected view ${method}`);
    },
    async call() {
      throw new Error("not used");
    },
  } as unknown as Rpc;
}

export function account(codeHash = "11111111111111111111111111111111"): AccountView {
  return { amount: "1", code_hash: codeHash, storage_usage: 100 };
}

export function entry(over: Partial<LogEntry>): LogEntry {
  return {
    seq: 0,
    request_id: 0,
    ts_ms: 0,
    agent_pk: "ed25519:agent",
    agent_label: "buyer",
    token: "usdc.testnet",
    amount: "0",
    recipient: "vendor.testnet",
    memo: null,
    outcome: "allow",
    risk: "allow",
    score: 0,
    reasons: [],
    transfer: "settled",
    ...over,
  };
}
