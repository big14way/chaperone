//! # Chaperone blocklist registry
//!
//! One shared, public list of accounts known to take money they should not: payment-redirect
//! scams, drainers, poisoned "new address" invoices. Every Chaperone checker reads it, so an
//! account flagged after hitting one vault is a hard block for every other vault.
//!
//! Writes are limited to reporters the registry owner trusts (vault owners, checker operators).
//! Each flag carries a reason code and evidence (a tx hash, a URL, a short note) and records who
//! filed it. The reporter who filed a flag, or the owner, can clear it. Reads are open to anyone.
//! Events follow NEP-297 (`chaperone_registry`).
use near_sdk::store::{IterableMap, IterableSet};
use near_sdk::serde_json::{self, json};
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, near, require};

pub const MAX_REASON: usize = 64;
pub const MAX_EVIDENCE: usize = 512;

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Reporters,
    Flags,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Flag {
    pub account_id: AccountId,
    /// Short code, e.g. `PAYMENT_REDIRECT_SCAM`.
    pub reason: String,
    pub evidence: String,
    pub reporter: AccountId,
    pub reported_ms: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    owner: AccountId,
    reporters: IterableSet<AccountId>,
    flags: IterableMap<AccountId, Flag>,
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "chaperone_registry", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[near]
impl Registry {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        let mut reporters = IterableSet::new(Key::Reporters);
        reporters.insert(owner.clone());
        Self { owner, reporters, flags: IterableMap::new(Key::Flags) }
    }

    /// Owner: trust an account to file flags.
    #[payable]
    pub fn add_reporter(&mut self, account_id: AccountId) {
        self.assert_owner();
        if self.reporters.insert(account_id.clone()) {
            emit("reporter_added", json!({ "account_id": account_id }));
        }
    }

    /// Owner: stop trusting a reporter. Flags it filed stay until cleared.
    #[payable]
    pub fn remove_reporter(&mut self, account_id: AccountId) {
        self.assert_owner();
        require!(account_id != self.owner, "the owner is always a reporter");
        if self.reporters.remove(&account_id) {
            emit("reporter_removed", json!({ "account_id": account_id }));
        }
    }

    /// Reporter: flag `account_id`. An account already flagged keeps its first flag.
    #[payable]
    pub fn report(&mut self, account_id: AccountId, reason: String, evidence: String) -> Flag {
        near_sdk::assert_one_yocto();
        let reporter = env::predecessor_account_id();
        require!(self.reporters.contains(&reporter), "only a trusted reporter can flag accounts");
        require!(!reason.is_empty() && reason.len() <= MAX_REASON, "reason: 1 to 64 characters");
        require!(reason.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'), "reason is an UPPER_SNAKE code");
        require!(!evidence.is_empty() && evidence.len() <= MAX_EVIDENCE, "evidence: 1 to 512 characters");
        if let Some(existing) = self.flags.get(&account_id) {
            return existing.clone();
        }
        let flag = Flag { account_id: account_id.clone(), reason, evidence, reporter, reported_ms: env::block_timestamp_ms() };
        self.flags.insert(account_id, flag.clone());
        emit("flagged", json!(flag));
        flag
    }

    /// The reporter who filed the flag, or the owner: remove it.
    #[payable]
    pub fn clear(&mut self, account_id: AccountId) {
        near_sdk::assert_one_yocto();
        let caller = env::predecessor_account_id();
        let flag = self.flags.get(&account_id).cloned().unwrap_or_else(|| env::panic_str("not flagged"));
        require!(caller == flag.reporter || caller == self.owner, "only the reporter or the owner can clear a flag");
        self.flags.remove(&account_id);
        emit("cleared", json!({ "account_id": account_id, "by": caller }));
    }

    // ------------------------------------------------------------------ views

    pub fn get_flag(&self, account_id: AccountId) -> Option<Flag> {
        self.flags.get(&account_id).cloned()
    }

    pub fn get_flags(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Flag> {
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.flags.values().skip(from_index.unwrap_or(0) as usize).take(limit).cloned().collect()
    }

    pub fn get_flag_count(&self) -> u32 {
        self.flags.len()
    }

    pub fn get_reporters(&self) -> Vec<AccountId> {
        self.reporters.iter().cloned().collect()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    fn assert_owner(&self) {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }
}
