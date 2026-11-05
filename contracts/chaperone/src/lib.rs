//! # Chaperone vault
//!
//! A policy wallet for AI agents. The vault account holds the funds (NEP-141 tokens such as
//! USDC). Each agent holds only a function-call access key on the vault account that can call
//! a single method, `request_spend`. Because function-call keys cannot attach a deposit, an
//! agent can never call `ft_transfer` on the token itself; the vault does the transfer after
//! every check passes.
//!
//! A spend goes through, in order:
//! 1. agent identity: the signing public key must be a registered, non-revoked agent;
//! 2. the checker's ed25519-signed risk verdict (bound to vault, agent key, token, amount,
//!    recipient; with nonce and expiry);
//! 3. owner caveats (all must pass): token allowlist, per-tx cap, daily cap per UTC day,
//!    recipient allowlist OR first-seen timelock, one open warn request per agent;
//! 4. outcome: ALLOW sends `ft_transfer` from the vault, BLOCK is logged and refused,
//!    WARN is parked until the owner approves or rejects it.
//!
//! A rule can only make the outcome stricter. Nothing changes the amount or the recipient.

mod types;

pub use types::*;

use near_contract_standards::fungible_token::core::ext_ft_core;
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap, LookupSet, Vector};
use near_sdk::{
    AccountId, Allowance, BorshStorageKey, CurveType, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue, PublicKey, env, near, require,
};

/// Length of a budget day, in milliseconds of block time.
pub const DAY_MS: u64 = 86_400_000;
/// A verdict may not be valid for longer than this.
pub const MAX_VERDICT_TTL_MS: u64 = 10 * 60 * 1000;
/// A parked warn-band request expires after this long.
pub const PENDING_TTL_MS: u64 = DAY_MS;
/// Score bands, mirrored from the checker. The contract applies the stricter of the
/// checker's label and the band of its score.
pub const WARN_SCORE: u8 = 30;
pub const BLOCK_SCORE: u8 = 70;
/// Gas allowance given to a new agent key when the owner does not specify one (0.5 NEAR).
pub const DEFAULT_AGENT_ALLOWANCE: NearToken = NearToken::from_millinear(500);
/// The only method an agent key may call.
pub const AGENT_METHOD: &str = "request_spend";

const MAX_AGENTS: u32 = 32;
const MAX_MEMO_LEN: usize = 256;
const MAX_LABEL_LEN: usize = 32;
const MAX_REASONS: usize = 16;
const MAX_REASON_LEN: usize = 48;
const MAX_NONCE_LEN: usize = 64;
const MAX_LIST_ITEMS: u32 = 32;
const MAX_LOG_PAGE: u64 = 100;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_ON_TRANSFER: Gas = Gas::from_tgas(10);
const EVENT_STANDARD: &str = "chaperone";
const EVENT_VERSION: &str = "1.0.0";

/// Reason codes written to the decision log.
pub mod reason {
    pub const BAD_VERDICT: &str = "BAD_VERDICT";
    pub const BAD_SIGNATURE: &str = "BAD_SIGNATURE";
    pub const VERDICT_EXPIRED: &str = "VERDICT_EXPIRED";
    pub const VERDICT_TTL_TOO_LONG: &str = "VERDICT_TTL_TOO_LONG";
    pub const NONCE_REUSED: &str = "NONCE_REUSED";
    pub const RISK_BLOCK: &str = "RISK_BLOCK";
    pub const RISK_WARN: &str = "RISK_WARN";
    pub const ZERO_AMOUNT: &str = "ZERO_AMOUNT";
    pub const SELF_RECIPIENT: &str = "SELF_RECIPIENT";
    pub const TOKEN_NOT_ALLOWED: &str = "TOKEN_NOT_ALLOWED";
    pub const PER_TX_CAP: &str = "PER_TX_CAP";
    pub const DAILY_CAP: &str = "DAILY_CAP";
    pub const RECIPIENT_TIMELOCK: &str = "RECIPIENT_TIMELOCK";
    pub const PENDING_EXISTS: &str = "PENDING_EXISTS";
    pub const OWNER_APPROVED: &str = "OWNER_APPROVED";
    pub const OWNER_REJECTED: &str = "OWNER_REJECTED";
    pub const AGENT_REVOKED: &str = "AGENT_REVOKED";
    pub const ALL_REVOKED: &str = "ALL_REVOKED";
    pub const PENDING_EXPIRED: &str = "PENDING_EXPIRED";
    pub const TRANSFER_FAILED: &str = "TRANSFER_FAILED";
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Agents,
    Pending,
    Log,
    Nonces,
    FirstSeen,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Chaperone {
    owner: AccountId,
    checker_pk: PublicKey,
    policy: Policy,
    /// Bumped by `revoke_all`. Agents and parked requests from an older version are dead.
    policy_version: u32,
    agents: IterableMap<PublicKey, Agent>,
    pending: IterableMap<u64, SpendRequest>,
    log: Vector<LogEntry>,
    used_nonces: LookupSet<String>,
    first_seen: LookupMap<AccountId, u64>,
    next_request_id: u64,
}

/// The exact bytes the checker signs. Every field is either an account id, a key, a number or
/// an uppercase reason code, so the newline-separated format cannot be confused.
#[allow(clippy::too_many_arguments)]
pub fn verdict_message(
    vault: &AccountId,
    agent_pk: &PublicKey,
    token: &AccountId,
    amount: U128,
    recipient: &AccountId,
    verdict: Verdict,
    score: u8,
    reasons: &[String],
    nonce: &str,
    expires_ms: u64,
) -> String {
    format!(
        "chaperone-verdict:v1\nvault={vault}\nagent={agent_pk}\ntoken={token}\namount={}\nrecipient={recipient}\nverdict={}\nscore={score}\nreasons={}\nnonce={nonce}\nexpires_ms={expires_ms}",
        amount.0,
        verdict.as_str(),
        reasons.join(","),
    )
}

/// Band of a score: < 30 allow, 30..=70 warn, > 70 block.
pub fn band(score: u8) -> Verdict {
    if score > BLOCK_SCORE {
        Verdict::Block
    } else if score >= WARN_SCORE {
        Verdict::Warn
    } else {
        Verdict::Allow
    }
}

fn stricter(a: Verdict, b: Verdict) -> Verdict {
    fn rank(v: Verdict) -> u8 {
        match v {
            Verdict::Allow => 0,
            Verdict::Warn => 1,
            Verdict::Block => 2,
        }
    }
    if rank(a) >= rank(b) { a } else { b }
}

fn is_reason_code(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_REASON_LEN
        && s.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

fn is_nonce(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_NONCE_LEN
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn assert_ed25519(pk: &PublicKey, what: &str) {
    require!(
        pk.curve_type() == CurveType::ED25519,
        format!("{what} must be an ed25519 key")
    );
}

fn validate_policy(p: &Policy) {
    require!(p.per_tx_cap.0 > 0, "per_tx_cap must be > 0");
    require!(
        p.per_tx_cap.0 <= p.daily_cap.0,
        "per_tx_cap must not exceed daily_cap"
    );
    require!(!p.allow_tokens.is_empty(), "allow_tokens must not be empty");
    require!(
        p.allow_tokens.len() as u32 <= MAX_LIST_ITEMS
            && p.allow_recipients.len() as u32 <= MAX_LIST_ITEMS,
        "allowlists are limited to 32 entries"
    );
}

fn roll_day(agent: &mut Agent, today: u64) {
    if agent.day_bucket != today {
        agent.day_bucket = today;
        agent.spent_today = U128(0);
    }
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({
            "standard": EVENT_STANDARD,
            "version": EVENT_VERSION,
            "event": event,
            "data": [data],
        })
    ));
}

#[near]
impl Chaperone {
    /// Initialise the vault. Must be called by the vault account itself (deploy + init batch).
    /// `owner` must be a different account: agent keys act as the vault account, so an owner
    /// equal to the vault would let agents pass owner checks.
    #[init]
    #[private]
    pub fn new(owner: AccountId, checker_pk: PublicKey, policy: Policy) -> Self {
        require!(
            owner != env::current_account_id(),
            "owner must be a separate account from the vault"
        );
        assert_ed25519(&checker_pk, "checker_pk");
        validate_policy(&policy);
        Self {
            owner,
            checker_pk,
            policy,
            policy_version: 0,
            agents: IterableMap::new(StorageKey::Agents),
            pending: IterableMap::new(StorageKey::Pending),
            log: Vector::new(StorageKey::Log),
            used_nonces: LookupSet::new(StorageKey::Nonces),
            first_seen: LookupMap::new(StorageKey::FirstSeen),
            next_request_id: 0,
        }
    }

    // ------------------------------------------------------------------ agent entry point

    /// Ask the vault to pay `amount` of `token` to `recipient`.
    ///
    /// Must be signed by an agent's function-call key on the vault account. Never panics on a
    /// policy refusal: a BLOCK is written to the log and returned, so the refusal is on chain.
    pub fn request_spend(
        &mut self,
        token: AccountId,
        amount: U128,
        recipient: AccountId,
        memo: Option<String>,
        verdict: RiskVerdict,
    ) -> PromiseOrValue<LogEntry> {
        let vault = env::current_account_id();
        require!(
            env::predecessor_account_id() == vault,
            "request_spend must be signed by an agent key on the vault account"
        );
        let agent_pk = env::signer_account_pk();
        let mut agent = self
            .agents
            .get(&agent_pk)
            .cloned()
            .unwrap_or_else(|| env::panic_str("UNKNOWN_AGENT: signer key is not an agent"));
        require!(agent.version == self.policy_version, reason::AGENT_REVOKED);
        if let Some(m) = &memo {
            require!(m.len() <= MAX_MEMO_LEN, "memo too long");
        }

        let now = env::block_timestamp_ms();
        let today = now / DAY_MS;
        let request_id = self.next_request_id;
        self.next_request_id += 1;

        let mut reasons: Vec<String> = Vec::new();

        // 1. Checker verdict: authentic, fresh, single use.
        let verified = self.verify_verdict(&agent_pk, &token, amount, &recipient, &verdict, now);
        let risk = match verified {
            Ok(()) => {
                self.used_nonces.insert(verdict.nonce.clone());
                let effective = stricter(verdict.verdict, band(verdict.score));
                match effective {
                    Verdict::Block => reasons.push(reason::RISK_BLOCK.into()),
                    Verdict::Warn => reasons.push(reason::RISK_WARN.into()),
                    Verdict::Allow => {}
                }
                reasons.extend(verdict.reasons.iter().cloned());
                Some(effective)
            }
            Err(code) => {
                reasons.push(code.into());
                None
            }
        };

        // 2. Caveats. All are evaluated so the log shows every failing rule.
        let mut caveats: Vec<String> = Vec::new();
        roll_day(&mut agent, today);
        if amount.0 == 0 {
            caveats.push(reason::ZERO_AMOUNT.into());
        }
        if recipient == vault {
            caveats.push(reason::SELF_RECIPIENT.into());
        }
        if !self.policy.allow_tokens.contains(&token) {
            caveats.push(reason::TOKEN_NOT_ALLOWED.into());
        }
        if amount.0 > self.effective_per_tx_cap(&agent) {
            caveats.push(reason::PER_TX_CAP.into());
        }
        if agent.spent_today.0.saturating_add(amount.0) > self.effective_daily_cap(&agent) {
            caveats.push(reason::DAILY_CAP.into());
        }
        if !self.policy.allow_recipients.contains(&recipient) {
            let first = match self.first_seen.get(&recipient) {
                Some(t) => *t,
                None => {
                    self.first_seen.insert(recipient.clone(), now);
                    now
                }
            };
            if now.saturating_sub(first) < self.policy.new_recipient_timelock_ms {
                caveats.push(reason::RECIPIENT_TIMELOCK.into());
            }
        }
        if let Some(pid) = agent.pending_request {
            if self.pending.get(&pid).is_some_and(|r| now < r.expires_ms) {
                caveats.push(reason::PENDING_EXISTS.into());
            } else {
                self.cancel_pending(pid, reason::PENDING_EXPIRED);
                agent.pending_request = None;
            }
        }
        let caveats_pass = caveats.is_empty();
        reasons.extend(caveats);

        // 3. Outcome.
        let outcome = match (risk, caveats_pass) {
            (None, _) | (_, false) | (Some(Verdict::Block), _) => Outcome::Block,
            (Some(Verdict::Warn), true) if self.policy.warn_requires_owner => Outcome::Warn,
            _ => Outcome::Allow,
        };

        let mut entry = LogEntry {
            seq: 0,
            request_id,
            ts_ms: now,
            agent_pk: agent_pk.clone(),
            agent_label: agent.label.clone(),
            token: token.clone(),
            amount,
            recipient: recipient.clone(),
            memo: memo.clone(),
            outcome,
            risk,
            score: verified.ok().map(|_| verdict.score),
            reasons: reasons.clone(),
            transfer: None,
        };

        match outcome {
            Outcome::Allow => {
                agent.spent_today = U128(agent.spent_today.0 + amount.0);
                self.agents.insert(agent_pk.clone(), agent);
                entry.transfer = Some(Transfer::Sent);
                let seq = self.push_log(entry);
                PromiseOrValue::Promise(
                    self.pay(token, recipient, amount, memo, seq, agent_pk, today),
                )
            }
            Outcome::Warn => {
                agent.pending_request = Some(request_id);
                self.agents.insert(agent_pk.clone(), agent);
                self.pending.insert(
                    request_id,
                    SpendRequest {
                        id: request_id,
                        agent_pk,
                        agent_label: entry.agent_label.clone(),
                        token,
                        amount,
                        recipient,
                        memo,
                        score: verdict.score,
                        reasons,
                        created_ms: now,
                        expires_ms: now + PENDING_TTL_MS,
                        version: self.policy_version,
                    },
                );
                let seq = self.push_log(entry);
                PromiseOrValue::Value(self.log.get(seq as u32).cloned().unwrap())
            }
            _ => {
                self.agents.insert(agent_pk, agent);
                let seq = self.push_log(entry);
                PromiseOrValue::Value(self.log.get(seq as u32).cloned().unwrap())
            }
        }
    }

    /// Settles the log line of a transfer. Reverses the agent's daily spend if it failed.
    #[private]
    pub fn on_transfer_resolved(
        &mut self,
        seq: u64,
        agent_pk: PublicKey,
        amount: U128,
        day_bucket: u64,
    ) -> LogEntry {
        require!(env::promise_results_count() == 1, "callback only");
        let ok = env::promise_result_checked(0, 256).is_ok();
        if !ok
            && let Some(agent) = self.agents.get_mut(&agent_pk)
            && agent.day_bucket == day_bucket
        {
            agent.spent_today = U128(agent.spent_today.0.saturating_sub(amount.0));
        }
        let entry = self
            .log
            .get_mut(seq as u32)
            .unwrap_or_else(|| env::panic_str("log entry missing"));
        entry.transfer = Some(if ok {
            Transfer::Settled
        } else {
            Transfer::Failed
        });
        if !ok {
            entry.reasons.push(reason::TRANSFER_FAILED.into());
        }
        let entry = entry.clone();
        emit(
            "transfer",
            json!({ "seq": seq, "request_id": entry.request_id, "settled": ok }),
        );
        entry
    }

    // ------------------------------------------------------------------ owner methods
    // Every owner method requires exactly 1 yoctoNEAR, which only a full-access key can attach.

    /// Approve a parked warn-band request and pay it.
    #[payable]
    pub fn approve(&mut self, request_id: u64) -> Promise {
        self.assert_owner();
        let req = self
            .pending
            .remove(&request_id)
            .unwrap_or_else(|| env::panic_str("no such pending request"));
        let now = env::block_timestamp_ms();
        require!(req.version == self.policy_version, "request was revoked");
        require!(now < req.expires_ms, "request expired");
        require!(
            self.policy.allow_tokens.contains(&req.token),
            "token is no longer allowed"
        );
        let today = now / DAY_MS;
        let agent = self
            .agents
            .get_mut(&req.agent_pk)
            .unwrap_or_else(|| env::panic_str("agent was revoked"));
        agent.pending_request = None;
        roll_day(agent, today);
        // Owner approval overrides the warn verdict, and still counts toward the day.
        agent.spent_today = U128(agent.spent_today.0 + req.amount.0);

        let mut reasons = req.reasons.clone();
        reasons.push(reason::OWNER_APPROVED.into());
        let seq = self.push_log(LogEntry {
            seq: 0,
            request_id,
            ts_ms: now,
            agent_pk: req.agent_pk.clone(),
            agent_label: req.agent_label.clone(),
            token: req.token.clone(),
            amount: req.amount,
            recipient: req.recipient.clone(),
            memo: req.memo.clone(),
            outcome: Outcome::Approved,
            risk: Some(Verdict::Warn),
            score: Some(req.score),
            reasons,
            transfer: Some(Transfer::Sent),
        });
        self.pay(
            req.token,
            req.recipient,
            req.amount,
            req.memo,
            seq,
            req.agent_pk,
            today,
        )
    }

    /// Reject a parked warn-band request.
    #[payable]
    pub fn reject(&mut self, request_id: u64) -> LogEntry {
        self.assert_owner();
        let seq = self.cancel_pending_with(request_id, Outcome::Rejected, reason::OWNER_REJECTED);
        self.log
            .get(seq.unwrap_or_else(|| env::panic_str("no such pending request")) as u32)
            .cloned()
            .unwrap()
    }

    /// Replace the policy.
    #[payable]
    pub fn set_policy(&mut self, policy: Policy) -> Policy {
        self.assert_owner();
        validate_policy(&policy);
        self.policy = policy.clone();
        emit("policy", json!({ "policy": policy }));
        policy
    }

    /// Rotate the checker key. Verdicts signed by the old key stop verifying immediately.
    #[payable]
    pub fn set_checker(&mut self, checker_pk: PublicKey) {
        self.assert_owner();
        assert_ed25519(&checker_pk, "checker_pk");
        self.checker_pk = checker_pk;
    }

    /// Register an agent and add its function-call key to the vault account.
    /// The key may call `request_spend` on this contract only, with a gas allowance of
    /// `allowance` yoctoNEAR (default 0.5 NEAR). It can never attach a deposit.
    #[payable]
    pub fn add_agent(
        &mut self,
        public_key: PublicKey,
        label: String,
        daily_cap: Option<U128>,
        per_tx_cap: Option<U128>,
        allowance: Option<U128>,
    ) -> Promise {
        self.assert_owner();
        assert_ed25519(&public_key, "public_key");
        require!(
            !label.is_empty() && label.len() <= MAX_LABEL_LEN,
            "label must be 1 to 32 bytes"
        );
        require!(
            !self.agents.contains_key(&public_key),
            "agent already exists"
        );
        require!(self.agents.len() < MAX_AGENTS, "too many agents");
        let allowance = Allowance::limited(NearToken::from_yoctonear(
            allowance
                .map(|a| a.0)
                .unwrap_or(DEFAULT_AGENT_ALLOWANCE.as_yoctonear()),
        ))
        .unwrap_or_else(|| env::panic_str("allowance must be > 0"));
        let now = env::block_timestamp_ms();
        self.agents.insert(
            public_key.clone(),
            Agent {
                label: label.clone(),
                spent_today: U128(0),
                day_bucket: now / DAY_MS,
                daily_cap,
                per_tx_cap,
                pending_request: None,
                version: self.policy_version,
                added_ms: now,
            },
        );
        emit(
            "agent_added",
            json!({ "public_key": public_key, "label": label }),
        );
        let vault = env::current_account_id();
        Promise::new(vault.clone()).add_access_key_allowance(
            public_key,
            allowance,
            vault,
            AGENT_METHOD,
        )
    }

    /// Remove one agent, cancel its parked request and delete its key.
    #[payable]
    pub fn revoke_agent(&mut self, public_key: PublicKey) -> Promise {
        self.assert_owner();
        let agent = self
            .agents
            .remove(&public_key)
            .unwrap_or_else(|| env::panic_str("no such agent"));
        if let Some(pid) = agent.pending_request {
            self.cancel_pending(pid, reason::AGENT_REVOKED);
        }
        emit(
            "agent_revoked",
            json!({ "public_key": public_key, "label": agent.label }),
        );
        Promise::new(env::current_account_id()).delete_key(public_key)
    }

    /// Kill switch: bump the policy version, cancel every parked request, remove every agent
    /// and delete every agent key. Returns the number of agents revoked.
    #[payable]
    pub fn revoke_all(&mut self) -> u32 {
        self.assert_owner();
        self.policy_version += 1;
        let ids: Vec<u64> = self.pending.keys().copied().collect();
        for id in ids {
            self.cancel_pending_with(id, Outcome::Cancelled, reason::ALL_REVOKED);
        }
        let keys: Vec<PublicKey> = self.agents.keys().cloned().collect();
        self.agents.clear();
        let vault = env::current_account_id();
        for pk in &keys {
            // One promise per key, so a key that was already removed by hand does not stop
            // the others from being deleted.
            let _ = Promise::new(vault.clone()).delete_key(pk.clone());
        }
        emit(
            "revoke_all",
            json!({ "policy_version": self.policy_version, "agents": keys.len() }),
        );
        keys.len() as u32
    }

    /// Move tokens out of the vault to the owner (or `receiver_id`).
    #[payable]
    pub fn withdraw(
        &mut self,
        token: AccountId,
        amount: U128,
        receiver_id: Option<AccountId>,
    ) -> Promise {
        self.assert_owner();
        let to = receiver_id.unwrap_or_else(|| self.owner.clone());
        ext_ft_core::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to, amount, Some("chaperone withdraw".into()))
    }

    // ------------------------------------------------------------------ views

    pub fn get_info(&self) -> VaultInfo {
        VaultInfo {
            owner: self.owner.clone(),
            checker_pk: self.checker_pk.clone(),
            policy_version: self.policy_version,
            agents: self.agents.len(),
            pending: self.pending.len(),
            log_len: self.log.len() as u64,
        }
    }

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_agent(&self, public_key: PublicKey) -> Option<AgentView> {
        self.agents
            .get(&public_key)
            .map(|a| self.agent_view(&public_key, a))
    }

    pub fn get_agents(&self) -> Vec<AgentView> {
        self.agents
            .iter()
            .map(|(pk, a)| self.agent_view(pk, a))
            .collect()
    }

    pub fn get_pending(&self) -> Vec<SpendRequest> {
        self.pending.values().cloned().collect()
    }

    /// Decision log. With `from_index` it pages forward; without, it returns the last `limit`
    /// entries (default 20, max 100).
    pub fn get_log(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<LogEntry> {
        let len = self.log.len() as u64;
        let limit = limit.unwrap_or(20).min(MAX_LOG_PAGE);
        let start = from_index.unwrap_or_else(|| len.saturating_sub(limit));
        (start..len.min(start.saturating_add(limit)))
            .filter_map(|i| self.log.get(i as u32).cloned())
            .collect()
    }

    /// When this vault first saw `account_id` as a recipient (ms), if ever.
    pub fn get_first_seen(&self, account_id: AccountId) -> Option<u64> {
        self.first_seen.get(&account_id).copied()
    }

    /// The canonical message the checker must sign, for client-side cross-checks.
    #[allow(clippy::too_many_arguments)]
    pub fn get_verdict_message(
        &self,
        agent_pk: PublicKey,
        token: AccountId,
        amount: U128,
        recipient: AccountId,
        verdict: Verdict,
        score: u8,
        reasons: Vec<String>,
        nonce: String,
        expires_ms: u64,
    ) -> String {
        verdict_message(
            &env::current_account_id(),
            &agent_pk,
            &token,
            amount,
            &recipient,
            verdict,
            score,
            &reasons,
            &nonce,
            expires_ms,
        )
    }
}

// ---------------------------------------------------------------------- funding

#[near]
impl FungibleTokenReceiver for Chaperone {
    /// Fund the vault with `ft_transfer_call`. Only allowlisted tokens are kept; anything else
    /// is refunded by returning the full amount.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let _ = msg;
        if !self.policy.allow_tokens.contains(&token) {
            emit(
                "deposit_refused",
                json!({ "token": token, "sender": sender_id, "amount": amount }),
            );
            return PromiseOrValue::Value(amount);
        }
        emit(
            "deposit",
            json!({ "token": token, "sender": sender_id, "amount": amount }),
        );
        PromiseOrValue::Value(U128(0))
    }
}

// ---------------------------------------------------------------------- internals

impl Chaperone {
    fn assert_owner(&self) {
        near_sdk::assert_one_yocto();
        let caller = env::predecessor_account_id();
        require!(caller == self.owner, "only the owner");
        require!(caller != env::current_account_id(), "only the owner");
    }

    fn effective_daily_cap(&self, agent: &Agent) -> u128 {
        let cap = self.policy.daily_cap.0;
        agent.daily_cap.map_or(cap, |c| c.0.min(cap))
    }

    fn effective_per_tx_cap(&self, agent: &Agent) -> u128 {
        let cap = self.policy.per_tx_cap.0;
        agent.per_tx_cap.map_or(cap, |c| c.0.min(cap))
    }

    fn agent_view(&self, pk: &PublicKey, a: &Agent) -> AgentView {
        let today = env::block_timestamp_ms() / DAY_MS;
        let spent = if a.day_bucket == today {
            a.spent_today.0
        } else {
            0
        };
        let daily = self.effective_daily_cap(a);
        AgentView {
            public_key: pk.clone(),
            label: a.label.clone(),
            spent_today: U128(spent),
            remaining_today: U128(daily.saturating_sub(spent)),
            daily_cap: U128(daily),
            per_tx_cap: U128(self.effective_per_tx_cap(a)),
            pending_request: a.pending_request,
            version: a.version,
            added_ms: a.added_ms,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn verify_verdict(
        &self,
        agent_pk: &PublicKey,
        token: &AccountId,
        amount: U128,
        recipient: &AccountId,
        v: &RiskVerdict,
        now: u64,
    ) -> Result<(), &'static str> {
        if v.score > 100
            || !is_nonce(&v.nonce)
            || v.reasons.len() > MAX_REASONS
            || !v.reasons.iter().all(|r| is_reason_code(r))
        {
            return Err(reason::BAD_VERDICT);
        }
        let sig: [u8; 64] = v
            .signature
            .0
            .as_slice()
            .try_into()
            .map_err(|_| reason::BAD_SIGNATURE)?;
        let pk: [u8; 32] = self.checker_pk.as_bytes()[1..]
            .try_into()
            .map_err(|_| reason::BAD_SIGNATURE)?;
        let msg = verdict_message(
            &env::current_account_id(),
            agent_pk,
            token,
            amount,
            recipient,
            v.verdict,
            v.score,
            &v.reasons,
            &v.nonce,
            v.expires_ms,
        );
        if !env::ed25519_verify(&sig, msg.as_bytes(), &pk) {
            return Err(reason::BAD_SIGNATURE);
        }
        if v.expires_ms <= now {
            return Err(reason::VERDICT_EXPIRED);
        }
        if v.expires_ms > now + MAX_VERDICT_TTL_MS {
            return Err(reason::VERDICT_TTL_TOO_LONG);
        }
        if self.used_nonces.contains(&v.nonce) {
            return Err(reason::NONCE_REUSED);
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn pay(
        &self,
        token: AccountId,
        recipient: AccountId,
        amount: U128,
        memo: Option<String>,
        seq: u64,
        agent_pk: PublicKey,
        day_bucket: u64,
    ) -> Promise {
        ext_ft_core::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(recipient, amount, memo)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_TRANSFER)
                    .on_transfer_resolved(seq, agent_pk, amount, day_bucket),
            )
    }

    fn push_log(&mut self, mut entry: LogEntry) -> u64 {
        let seq = self.log.len() as u64;
        entry.seq = seq;
        emit("decision", serde_json::to_value(&entry).unwrap_or_default());
        self.log.push(entry);
        seq
    }

    fn cancel_pending(&mut self, request_id: u64, code: &str) {
        self.cancel_pending_with(request_id, Outcome::Cancelled, code);
    }

    /// Remove a parked request and log why. Returns the log seq, or None if it did not exist.
    fn cancel_pending_with(
        &mut self,
        request_id: u64,
        outcome: Outcome,
        code: &str,
    ) -> Option<u64> {
        let req = self.pending.remove(&request_id)?;
        if let Some(agent) = self.agents.get_mut(&req.agent_pk)
            && agent.pending_request == Some(request_id)
        {
            agent.pending_request = None;
        }
        let mut reasons = req.reasons;
        reasons.push(code.into());
        Some(self.push_log(LogEntry {
            seq: 0,
            request_id,
            ts_ms: env::block_timestamp_ms(),
            agent_pk: req.agent_pk,
            agent_label: req.agent_label,
            token: req.token,
            amount: req.amount,
            recipient: req.recipient,
            memo: req.memo,
            outcome,
            risk: Some(Verdict::Warn),
            score: Some(req.score),
            reasons,
            transfer: None,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    #[test]
    fn score_bands() {
        assert_eq!(band(0), Verdict::Allow);
        assert_eq!(band(29), Verdict::Allow);
        assert_eq!(band(30), Verdict::Warn);
        assert_eq!(band(70), Verdict::Warn);
        assert_eq!(band(71), Verdict::Block);
        assert_eq!(stricter(Verdict::Allow, band(90)), Verdict::Block);
        assert_eq!(stricter(Verdict::Block, band(0)), Verdict::Block);
    }

    #[test]
    fn verdict_message_is_stable() {
        let pk: PublicKey = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
            .parse()
            .unwrap();
        let msg = verdict_message(
            &acc("vault.test.near"),
            &pk,
            &acc("usdc.test.near"),
            U128(25_000_000),
            &acc("vendor.test.near"),
            Verdict::Allow,
            12,
            &["ALLOWLISTED".to_string(), "KNOWN_COUNTERPARTY".to_string()],
            "n-1",
            1_700_000_000_000,
        );
        assert_eq!(
            msg,
            "chaperone-verdict:v1\nvault=vault.test.near\nagent=ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp\ntoken=usdc.test.near\namount=25000000\nrecipient=vendor.test.near\nverdict=allow\nscore=12\nreasons=ALLOWLISTED,KNOWN_COUNTERPARTY\nnonce=n-1\nexpires_ms=1700000000000"
        );
    }

    #[test]
    fn reason_and_nonce_charsets() {
        assert!(is_reason_code("NEW_ACCOUNT_1"));
        assert!(!is_reason_code("new"));
        assert!(!is_reason_code("A,B"));
        assert!(!is_reason_code("A\nB"));
        assert!(is_nonce("abc-123_X"));
        assert!(!is_nonce(""));
        assert!(!is_nonce("a\nb"));
    }

    #[test]
    #[should_panic(expected = "per_tx_cap must not exceed daily_cap")]
    fn policy_rejects_per_tx_above_daily() {
        validate_policy(&Policy {
            daily_cap: U128(10),
            per_tx_cap: U128(11),
            allow_recipients: vec![],
            allow_tokens: vec![acc("usdc.test.near")],
            new_recipient_timelock_ms: 0,
            warn_requires_owner: true,
        });
    }
}
