// TypeScript mirrors of the vault contract's JSON views.

export type Outcome = "allow" | "block" | "warn" | "approved" | "rejected" | "cancelled";
export type TransferStatus = "sent" | "settled" | "failed";

export interface LogEntry {
  seq: number;
  request_id: number;
  ts_ms: number;
  agent_pk: string;
  agent_label: string;
  token: string;
  amount: string;
  recipient: string;
  memo: string | null;
  outcome: Outcome;
  risk: "allow" | "warn" | "block" | null;
  score: number | null;
  reasons: string[];
  transfer: TransferStatus | null;
}

export interface Policy {
  daily_cap: string;
  per_tx_cap: string;
  allow_recipients: string[];
  allow_tokens: string[];
  new_recipient_timelock_ms: number;
  warn_requires_owner: boolean;
}

export interface VaultInfo {
  owner: string;
  checker_pk: string;
  policy_version: number;
  agents: number;
  pending: number;
  log_len: number;
}

export interface AgentView {
  public_key: string;
  label: string;
  spent_today: string;
  remaining_today: string;
  daily_cap: string;
  per_tx_cap: string;
  pending_request: number | null;
  version: number;
  added_ms: number;
}

export interface SpendRequest {
  id: number;
  agent_pk: string;
  agent_label: string;
  token: string;
  amount: string;
  recipient: string;
  memo: string | null;
  score: number;
  reasons: string[];
  created_ms: number;
  expires_ms: number;
  version: number;
}
