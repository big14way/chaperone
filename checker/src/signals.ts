// Gathers the counterparty signals for one spend request.
import type { Blocklist } from "./blocklist.ts";
import type { CodeCache } from "./codecache.ts";
import type { NearBlocks } from "./nearblocks.ts";
import { EMPTY_CODE_HASH, type Rpc } from "./rpc.ts";
import { DAY_MS, type Signals } from "./score.ts";
import type { LogEntry, Policy, VaultInfo } from "./types.ts";

export interface SignalDeps {
  rpc: Rpc;
  vault: string;
  blocklist: Blocklist;
  codeCache: CodeCache;
  nearblocks?: NearBlocks;
}

export interface SpendQuery {
  agent: string;
  token: string;
  amount: bigint;
  recipient: string;
}

/** Read up to the last `max` decision-log entries of the vault. */
export async function readVaultLog(rpc: Rpc, vault: string, max = 500): Promise<LogEntry[]> {
  const info = await rpc.view<VaultInfo>(vault, "get_info");
  const out: LogEntry[] = [];
  for (let from = Math.max(0, info.log_len - max); from < info.log_len; from += 100) {
    out.push(...(await rpc.view<LogEntry[]>(vault, "get_log", { from_index: from, limit: 100 })));
  }
  return out;
}

/**
 * Account age and activity from plain RPC. NEAR initialises a new access key's nonce to
 * `block_height * 1_000_000` and every signed transaction bumps it, so the smallest key nonce
 * dates the account and the nonce deltas count the transactions it signed.
 */
export async function keyNonceHistory(
  rpc: Rpc,
  accountId: string,
  now: { height: number; timestampMs: number },
): Promise<{ ageMs: number | null; txCount: number | null }> {
  const keys = await rpc.accessKeys(accountId);
  if (keys.length === 0) return { ageMs: null, txCount: null };
  const heights = keys.map((k) => Math.floor(k.access_key.nonce / 1_000_000));
  const created = Math.min(...heights);
  const txCount = keys.reduce((n, k, i) => n + (k.access_key.nonce - heights[i]! * 1_000_000), 0);
  try {
    const b = await rpc.block(Math.max(created, 1));
    return { ageMs: Math.max(0, now.timestampMs - b.timestampMs), txCount };
  } catch {
    // Block garbage-collected on a non-archival node: estimate from the recent block rate.
    try {
      const back = Math.max(1, now.height - 1000);
      const old = await rpc.block(back);
      const perBlock = (now.timestampMs - old.timestampMs) / Math.max(1, now.height - back);
      return { ageMs: Math.round((now.height - created) * perBlock), txCount };
    } catch {
      return { ageMs: null, txCount };
    }
  }
}

export async function collectSignals(deps: SignalDeps, q: SpendQuery): Promise<Signals> {
  const { rpc, vault } = deps;
  const now = await rpc.block();
  const [account, policy, log, blocklisted] = await Promise.all([
    rpc.viewAccount(q.recipient),
    rpc.view<Policy>(vault, "get_policy"),
    readVaultLog(rpc, vault),
    deps.blocklist.lookup(q.recipient),
  ]);

  let ageMs: number | null = null;
  let txCount: number | null = null;
  let ageSource: Signals["ageSource"] = "unknown";
  if (account) {
    if (deps.nearblocks) {
      try {
        const [created, count] = await Promise.all([
          deps.nearblocks.createdMs(q.recipient),
          deps.nearblocks.txCount(q.recipient),
        ]);
        if (created !== null) {
          ageMs = Math.max(0, now.timestampMs - created);
          ageSource = "nearblocks";
        }
        txCount = count;
      } catch {
        // fall through to RPC
      }
    }
    if (ageSource === "unknown") {
      const h = await keyNonceHistory(rpc, q.recipient, now);
      ageMs = h.ageMs;
      txCount ??= h.txCount;
      if (ageMs !== null) ageSource = "key-nonce";
    }
  }

  const isContract = !!account && account.code_hash !== EMPTY_CODE_HASH;
  const changedMs = account ? deps.codeCache.observe(q.recipient, account.code_hash, now.timestampMs) : null;
  let codeChangedAgoMs = changedMs === null ? null : now.timestampMs - changedMs;
  // Code on an account younger than a day was necessarily deployed within the day.
  if (isContract && ageMs !== null && ageMs < DAY_MS) {
    codeChangedAgoMs = Math.min(codeChangedAgoMs ?? ageMs, ageMs);
  }

  const toRecipient = log.filter((e) => e.recipient === q.recipient);
  const weekAgo = now.timestampMs - 7 * DAY_MS;
  const mine = log.filter((e) => e.agent_pk === q.agent && e.transfer === "settled" && e.ts_ms >= weekAgo);
  const mean7d = mine.length === 0 ? null : mine.reduce((n, e) => n + BigInt(e.amount), 0n) / BigInt(mine.length);

  return {
    recipient: q.recipient,
    amount: q.amount,
    exists: !!account,
    allowlisted: policy.allow_recipients.includes(q.recipient),
    blocklisted: blocklisted ? { reason: blocklisted.reason } : null,
    ageMs,
    ageSource,
    txCount,
    isContract,
    codeChangedAgoMs,
    priorSettled: toRecipient.filter((e) => e.transfer === "settled").length,
    priorBlocked: toRecipient.filter((e) => e.risk === "block").length,
    mean7d,
    dailyCap: BigInt(policy.daily_cap),
  };
}
