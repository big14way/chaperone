//! Data types stored by the vault and returned by its view methods.

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{AccountId, PublicKey, near};

/// Owner-set caveats. Every caveat must pass for a spend to go through.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    /// Maximum an agent may spend per UTC day (block timestamp), in token base units.
    pub daily_cap: U128,
    /// Maximum for a single request, in token base units.
    pub per_tx_cap: U128,
    /// Recipients that skip the new-recipient timelock.
    pub allow_recipients: Vec<AccountId>,
    /// NEP-141 token contracts the vault may pay out. Anything else is refused.
    pub allow_tokens: Vec<AccountId>,
    /// A recipient that is not allowlisted must have been first seen by this vault at least
    /// this long ago. 0 disables the timelock.
    pub new_recipient_timelock_ms: u64,
    /// When true (default), a WARN verdict parks the request until the owner approves it.
    /// When false, WARN is treated like ALLOW (caveats still apply).
    pub warn_requires_owner: bool,
}

/// The checker's opinion of a counterparty.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    Warn,
    Block,
}

impl Verdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            Verdict::Allow => "allow",
            Verdict::Warn => "warn",
            Verdict::Block => "block",
        }
    }
}

/// A risk verdict signed (ed25519) by the counterparty checker. The signature covers the
/// canonical message built by [`crate::verdict_message`], which binds the verdict to this vault,
/// this agent key, and the exact token, amount and recipient.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RiskVerdict {
    pub verdict: Verdict,
    /// 0..=100, higher is riskier.
    pub score: u8,
    pub reasons: Vec<String>,
    pub nonce: String,
    pub expires_ms: u64,
    pub signature: Base64VecU8,
}

/// An agent is one function-call access key on the vault account.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub label: String,
    /// Spent in the current day bucket, in token base units (all allowlisted tokens are
    /// assumed to share decimals, e.g. USDC variants).
    pub spent_today: U128,
    /// `block_timestamp_ms / 86_400_000` of the last counted spend.
    pub day_bucket: u64,
    /// Optional per-agent ceilings. The effective cap is the lower of this and the policy cap.
    pub daily_cap: Option<U128>,
    pub per_tx_cap: Option<U128>,
    /// Open warn-band request, if any. One at a time per agent.
    pub pending_request: Option<u64>,
    /// Policy version at which the agent was added. `revoke_all` bumps the version.
    pub version: u32,
    pub added_ms: u64,
}

/// View of an agent with its effective limits for the current day.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct AgentView {
    pub public_key: PublicKey,
    pub label: String,
    pub spent_today: U128,
    pub remaining_today: U128,
    pub daily_cap: U128,
    pub per_tx_cap: U128,
    pub pending_request: Option<u64>,
    pub version: u32,
    pub added_ms: u64,
}

/// A warn-band request waiting for the owner.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct SpendRequest {
    pub id: u64,
    pub agent_pk: PublicKey,
    pub agent_label: String,
    pub token: AccountId,
    pub amount: U128,
    pub recipient: AccountId,
    pub memo: Option<String>,
    pub score: u8,
    pub reasons: Vec<String>,
    pub created_ms: u64,
    pub expires_ms: u64,
    pub version: u32,
}

/// What the vault decided.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Passed every caveat and the checker said allow: transfer sent.
    Allow,
    /// Refused. `reasons` says why.
    Block,
    /// Parked for the owner (checker said warn).
    Warn,
    /// Owner approved a parked request: transfer sent.
    Approved,
    /// Owner rejected a parked request.
    Rejected,
    /// Parked request cancelled by revoke_agent / revoke_all, or expired.
    Cancelled,
}

/// Settlement status of the ft_transfer for allow / approved decisions.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transfer {
    Sent,
    Settled,
    Failed,
}

/// One line of the decision log.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct LogEntry {
    pub seq: u64,
    pub request_id: u64,
    pub ts_ms: u64,
    pub agent_pk: PublicKey,
    pub agent_label: String,
    pub token: AccountId,
    pub amount: U128,
    pub recipient: AccountId,
    pub memo: Option<String>,
    pub outcome: Outcome,
    /// Checker verdict and score as received (None when the verdict failed verification).
    pub risk: Option<Verdict>,
    pub score: Option<u8>,
    /// Reason codes: caveat failures from the contract plus the checker's reasons.
    pub reasons: Vec<String>,
    pub transfer: Option<Transfer>,
}

/// Summary of the vault configuration.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct VaultInfo {
    pub owner: AccountId,
    pub checker_pk: PublicKey,
    pub policy_version: u32,
    pub agents: u32,
    pub pending: u32,
    pub log_len: u64,
}
