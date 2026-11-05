// Pure scoring: signals in, verdict out. Bands: score < 30 allow, 30..70 warn, > 70 block.
import type { VerdictLabel } from "./verdict.ts";

export const DAY_MS = 86_400_000;
export const WARN_AT = 30;
export const BLOCK_ABOVE = 70;

export interface Signals {
  recipient: string;
  amount: bigint;
  /** Recipient exists on chain. */
  exists: boolean;
  /** Recipient is on the vault owner's allowlist. */
  allowlisted: boolean;
  blocklisted: { reason: string } | null;
  /** Account age in ms; null when unknown. */
  ageMs: number | null;
  ageSource: "nearblocks" | "key-nonce" | "unknown";
  /** Transactions signed by the recipient; null when unknown. */
  txCount: number | null;
  isContract: boolean;
  /** ms since the recipient's code hash was seen to change; null if never. */
  codeChangedAgoMs: number | null;
  /** Settled payments from this vault to the recipient. */
  priorSettled: number;
  /** Earlier requests to the recipient that the checker rated BLOCK. */
  priorBlocked: number;
  /** Mean of this agent's settled spends over the last 7 days; null when there are none. */
  mean7d: bigint | null;
  dailyCap: bigint;
}

export interface Assessment {
  verdict: VerdictLabel;
  score: number;
  reasons: string[];
}

export function band(score: number): VerdictLabel {
  if (score > BLOCK_ABOVE) return "block";
  if (score >= WARN_AT) return "warn";
  return "allow";
}

export function assess(s: Signals): Assessment {
  const hard: string[] = [];
  const soft: Array<[string, number]> = [];

  // Hard blocks: any one of these forces BLOCK regardless of the other signals.
  if (!s.exists) hard.push("ACCOUNT_NOT_FOUND");
  if (s.blocklisted) hard.push("BLOCKLISTED");
  if (s.codeChangedAgoMs !== null && s.codeChangedAgoMs < DAY_MS) hard.push("CODE_CHANGED_24H");
  if (!s.allowlisted && s.ageMs !== null && s.ageMs < DAY_MS && s.amount * 10n > s.dailyCap) {
    hard.push("NEW_ACCOUNT_LARGE_AMOUNT");
  }

  if (s.allowlisted) {
    // The owner vouched for this recipient: age and activity do not count against it.
    soft.push(["ALLOWLISTED", 0]);
  } else {
    soft.push(["NOT_ALLOWLISTED", 10]);
    if (s.ageMs === null) soft.push(["UNKNOWN_AGE", 15]);
    else if (s.ageMs < DAY_MS) soft.push(["NEW_ACCOUNT", 30]);
    else if (s.ageMs < 7 * DAY_MS) soft.push(["YOUNG_ACCOUNT", 15]);
    if (s.txCount !== null && s.txCount < 3) soft.push(["LOW_ACTIVITY", 10]);
    if (s.priorSettled === 0) soft.push(["FIRST_INTERACTION", 10]);
  }
  if (s.isContract) soft.push(["IS_CONTRACT", 10]);
  if (s.priorBlocked > 0) soft.push(["PREVIOUSLY_BLOCKED", 30]);
  if (s.priorSettled > 0) soft.push(["KNOWN_COUNTERPARTY", -10]);
  if (s.mean7d === null) {
    soft.push(["NO_SPEND_HISTORY", 0]);
  } else if (s.mean7d > 0n) {
    // ratio in tenths, integer math
    const ratio10 = (s.amount * 10n) / s.mean7d;
    if (ratio10 >= 30n) soft.push(["AMOUNT_SPIKE_3X", 60]);
    else if (ratio10 >= 15n) soft.push(["AMOUNT_SPIKE", 40]);
  }

  const reasons = [...hard, ...soft.map(([r]) => r)].slice(0, 16);
  if (hard.length > 0) return { verdict: "block", score: 100, reasons };
  const raw = soft.reduce((n, [, w]) => n + w, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { verdict: band(score), score, reasons };
}
