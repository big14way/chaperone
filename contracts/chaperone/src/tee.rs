//! TEE-attested checker. When the owner sets a TEE policy, the vault only accepts verdicts from a
//! checker key that was registered with a verified Intel TDX (dstack) attestation: the quote must
//! verify against Intel's DCAP chain, bind this vault and the key in its report data, and come from
//! a container (app-compose hash) and OS image the owner approved. `register_checker` is open to
//! anyone because the attestation itself is the authority. Verification lives in `chaperone-tee`.
//!
//! State is kept under its own storage key so the vault's main struct (and deployed state) is unchanged.
use crate::*;
use chaperone_tee::{Policy as TeePolicy, TcbInfo};
use dcap_qvl::QuoteCollateralV3;
use near_sdk::serde_json::Value;

fn parse<T: near_sdk::serde::de::DeserializeOwned>(name: &str, v: Value) -> T {
    serde_json::from_value(v).unwrap_or_else(|e| env::panic_str(&format!("bad {name}: {e}")))
}

const TEE_KEY: &[u8] = b"tee";

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct TeeState {
    /// The approved policy as JSON (compose hashes, OS measurements, accepted TCB statuses).
    pub policy_json: Option<String>,
    pub attested: Option<AttestedChecker>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct AttestedChecker {
    pub public_key: PublicKey,
    pub compose_hash: String,
    pub mrtd: String,
    pub tcb_status: String,
    pub registered_ms: u64,
}

#[near(serializers = [json])]
pub struct TeeView {
    /// True when a TEE policy is set: only an attested checker key can sign valid verdicts.
    pub enforced: bool,
    /// True when the current checker key is the attested one.
    pub checker_attested: bool,
    /// The approved policy (compose_hashes, os, accepted_tcb_statuses).
    pub policy: Option<Value>,
    pub attested: Option<AttestedChecker>,
}

pub(crate) fn load() -> TeeState {
    env::storage_read(TEE_KEY)
        .map(|b| borsh::from_slice(&b).unwrap_or_else(|_| env::panic_str("corrupt tee state")))
        .unwrap_or_default()
}

fn save(s: &TeeState) {
    env::storage_write(TEE_KEY, &borsh::to_vec(s).unwrap());
}

fn policy_of(s: &TeeState) -> Option<TeePolicy> {
    s.policy_json.as_ref().map(|j| serde_json::from_str(j).unwrap_or_else(|_| env::panic_str("corrupt tee policy")))
}

/// `Err(CHECKER_NOT_ATTESTED)` when a TEE policy is set and `checker_pk` is not the attested key.
pub(crate) fn require_attested(checker_pk: &PublicKey) -> Result<(), &'static str> {
    let s = load();
    if s.policy_json.is_none() {
        return Ok(());
    }
    match s.attested {
        Some(a) if &a.public_key == checker_pk => Ok(()),
        _ => Err(reason::CHECKER_NOT_ATTESTED),
    }
}

pub(crate) fn enforced() -> bool {
    load().policy_json.is_some()
}

#[near]
impl Chaperone {
    /// Owner: approve the checker's container (app-compose hash) and OS image, or turn TEE mode off
    /// with `null`. Changing the policy clears the registered checker; it must re-register.
    #[payable]
    pub fn set_checker_tee_policy(&mut self, policy: Option<Value>) {
        self.assert_owner();
        let policy: Option<TeePolicy> = policy.map(|v| parse("policy", v));
        if let Some(p) = &policy {
            require!(!p.compose_hashes.is_empty() && !p.os.is_empty(), "policy needs a compose hash and an OS measurement");
            require!(p.compose_hashes.iter().all(|h| h.len() == 64 && hex::decode(h).is_ok()), "compose hashes are 32-byte hex");
        }
        let s = TeeState { policy_json: policy.as_ref().map(|p| serde_json::to_string(p).unwrap()), attested: None };
        save(&s);
        emit("checker_tee_policy", json!({ "policy": policy }));
    }

    /// Anyone: register the checker key with a TDX attestation. On success the key becomes the
    /// vault's checker. The quote's report data must be `chaperone_tee::report_data_for(vault, key)`.
    pub fn register_checker(&mut self, public_key: PublicKey, quote: String, collateral: Value, tcb_info: Value) -> AttestedChecker {
        let collateral: QuoteCollateralV3 = parse("collateral", collateral);
        let tcb_info: TcbInfo = parse("tcb_info", tcb_info);
        assert_ed25519(&public_key, "public_key");
        let mut s = load();
        let policy = policy_of(&s).unwrap_or_else(|| env::panic_str("no TEE policy: the owner must approve a checker image first"));
        let quote = hex::decode(quote.trim_start_matches("0x")).unwrap_or_else(|_| env::panic_str("quote is not hex"));
        let expected = chaperone_tee::report_data_for(env::current_account_id().as_str(), &public_key.as_bytes()[1..]);
        let now_ms = env::block_timestamp_ms();
        let ok = chaperone_tee::verify(&quote, &collateral, &tcb_info, &expected, now_ms / 1000, &policy)
            .unwrap_or_else(|e| env::panic_str(&format!("attestation rejected: {e}")));
        let a = AttestedChecker { public_key: public_key.clone(), compose_hash: ok.compose_hash, mrtd: ok.mrtd, tcb_status: ok.tcb_status, registered_ms: now_ms };
        s.attested = Some(a.clone());
        save(&s);
        self.checker_pk = public_key;
        emit("checker_attested", json!({ "public_key": a.public_key, "compose_hash": a.compose_hash, "tcb_status": a.tcb_status }));
        a
    }

    pub fn get_checker_tee(&self) -> TeeView {
        let s = load();
        let checker_attested = s.attested.as_ref().is_some_and(|a| a.public_key == self.checker_pk);
        let policy = s.policy_json.as_ref().map(|j| serde_json::from_str::<Value>(j).unwrap());
        TeeView { enforced: s.policy_json.is_some(), checker_attested, policy, attested: s.attested }
    }
}
