// Reason codes from the checker and the vault, in plain language. The raw code stays visible on
// expand; the owner reads the sentence.
import type { LogEntry } from "./types";
import { amount, tokenName } from "./format";

export type Tone = "good" | "warn" | "bad" | "neutral";

const R: Record<string, { text: string; tone: Tone }> = {
  // checker: counterparty signals
  ALLOWLISTED: { text: "Recipient is on your allowlist", tone: "good" },
  KNOWN_COUNTERPARTY: { text: "Paid this recipient before", tone: "good" },
  NO_SPEND_HISTORY: { text: "No spending history yet for this agent", tone: "neutral" },
  NOT_ALLOWLISTED: { text: "Recipient is not on your allowlist", tone: "warn" },
  FIRST_INTERACTION: { text: "First payment to this recipient", tone: "warn" },
  NEW_ACCOUNT: { text: "Recipient account is less than a day old", tone: "bad" },
  YOUNG_ACCOUNT: { text: "Recipient account is less than a week old", tone: "warn" },
  UNKNOWN_AGE: { text: "Recipient account age is unknown", tone: "warn" },
  LOW_ACTIVITY: { text: "Recipient has almost no on-chain history", tone: "warn" },
  IS_CONTRACT: { text: "Recipient is a smart contract", tone: "warn" },
  AMOUNT_SPIKE: { text: "Well above this agent's 7-day average", tone: "warn" },
  AMOUNT_SPIKE_3X: { text: "Three times or more the 7-day average", tone: "bad" },
  PREVIOUSLY_BLOCKED: { text: "Payments to this recipient were blocked before", tone: "bad" },
  BLOCKLISTED: { text: "Recipient is on the shared blocklist", tone: "bad" },
  ACCOUNT_NOT_FOUND: { text: "Recipient account does not exist", tone: "bad" },
  CODE_CHANGED_24H: { text: "Recipient contract code changed in the last 24 h", tone: "bad" },
  NEW_ACCOUNT_LARGE_AMOUNT: { text: "Brand-new account asking for a large amount", tone: "bad" },
  // vault: verdict checks
  RISK_BLOCK: { text: "Risk checker rated it high risk", tone: "bad" },
  RISK_WARN: { text: "Risk checker flagged it for review", tone: "warn" },
  BAD_VERDICT: { text: "Risk verdict was malformed", tone: "bad" },
  BAD_SIGNATURE: { text: "Risk verdict was not signed by the checker (forged)", tone: "bad" },
  VERDICT_EXPIRED: { text: "Risk verdict had expired", tone: "bad" },
  VERDICT_TTL_TOO_LONG: { text: "Risk verdict was valid for too long", tone: "bad" },
  NONCE_REUSED: { text: "Risk verdict was replayed", tone: "bad" },
  // vault: caveats
  ZERO_AMOUNT: { text: "Amount was zero", tone: "bad" },
  SELF_RECIPIENT: { text: "Tried to pay the vault itself", tone: "bad" },
  TOKEN_NOT_ALLOWED: { text: "Token is not allowed by the policy", tone: "bad" },
  PER_TX_CAP: { text: "Over the per-payment cap", tone: "bad" },
  DAILY_CAP: { text: "Over the agent's daily budget", tone: "bad" },
  RECIPIENT_TIMELOCK: { text: "New recipient is still in its waiting period", tone: "bad" },
  PENDING_EXISTS: { text: "Agent already has a request waiting", tone: "bad" },
  // owner and lifecycle
  OWNER_APPROVED: { text: "Approved by the owner", tone: "good" },
  OWNER_REJECTED: { text: "Rejected by the owner", tone: "neutral" },
  AGENT_REVOKED: { text: "Agent key was revoked", tone: "neutral" },
  ALL_REVOKED: { text: "Kill switch: every agent revoked", tone: "neutral" },
  PENDING_EXPIRED: { text: "Request expired after 24 h", tone: "neutral" },
  TRANSFER_FAILED: { text: "Token transfer failed; budget refunded", tone: "bad" },
};

export function reason(code: string): { code: string; text: string; tone: Tone } {
  const r = R[code];
  return { code, text: r?.text ?? code.toLowerCase().replace(/_/g, " "), tone: r?.tone ?? "neutral" };
}

const RANK: Record<Tone, number> = { bad: 0, warn: 1, good: 2, neutral: 3 };

/** Reasons sorted worst-first, with duplicates by meaning removed. */
export function reasons(codes: string[]) {
  const seen = new Set<string>();
  const generic = (c: string) => c === "RISK_WARN" || c === "RISK_BLOCK";
  return [...codes.filter((c) => !generic(c)), ...codes.filter(generic)]
    .map(reason)
    .filter((r) => (seen.has(r.text) ? false : (seen.add(r.text), true)))
    .sort((a, b) => RANK[a.tone] - RANK[b.tone] || Number(a.code.startsWith("RISK_")) - Number(b.code.startsWith("RISK_")));
}

export type Kind = "paid" | "blocked" | "held" | "closed" | "failed";

export function kindOf(e: LogEntry): Kind {
  if (e.outcome === "block") return "blocked";
  if (e.outcome === "warn") return "held";
  if (e.outcome === "rejected" || e.outcome === "cancelled") return "closed";
  if (e.transfer === "failed") return "failed";
  return "paid";
}

/** One sentence for the activity feed. */
export function headline(e: LogEntry): string {
  const amt = `${amount(e.amount)} ${tokenName(e.token)}`;
  switch (e.outcome) {
    case "block":
      return `Blocked ${amt} to ${e.recipient}`;
    case "warn":
      return `Held ${amt} to ${e.recipient} for approval`;
    case "rejected":
      return `Rejected ${amt} to ${e.recipient}`;
    case "cancelled":
      return `Cancelled ${amt} to ${e.recipient}`;
    case "approved":
      return e.transfer === "failed" ? `Approved ${amt} to ${e.recipient}, transfer failed` : `Approved and paid ${amt} to ${e.recipient}`;
    default:
      return e.transfer === "failed" ? `Allowed ${amt} to ${e.recipient}, transfer failed` : `Paid ${amt} to ${e.recipient}`;
  }
}
