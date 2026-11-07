//! Verification of a dstack (Intel TDX) attestation for the Chaperone risk checker.
//!
//! The checker runs in a TDX confidential VM (dstack, e.g. on Phala Cloud). At boot it creates its
//! ed25519 signing key inside the enclave and asks the platform for a TDX quote whose report data
//! commits to that key and to the vault: `report_data = sha256("chaperone-checker-v1:" || vault ||
//! ":" || public_key) || 32 zero bytes`. A verifier (the vault contract, or the `attest` CLI) accepts
//! the key only if all of the following hold:
//!
//! 1. the quote verifies against Intel's DCAP trust chain with the supplied collateral (dcap-qvl);
//! 2. the TCB status is acceptable (`UpToDate` unless the policy allows more);
//! 3. the quote's report data equals the expected binding for this vault and key;
//! 4. MRTD and RTMR0-3 in the supplied TCB info equal the quote's, and RTMR3 replays from the
//!    dstack event log (every runtime event re-hashed);
//! 5. the event log's single `compose-hash` event equals sha256(app_compose) and that hash is one
//!    the owner approved (it pins the exact container image digest and configuration);
//! 6. MRTD and RTMR0-2 (firmware, kernel, OS image) match an approved OS measurement set.
//!
//! The event-digest and RTMR3 replay rules follow NEAR's `shade-attestation` crate (MIT), which
//! NEAR's Shade Agents use for the same purpose.
use dcap_qvl::QuoteCollateralV3;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha384};

/// dstack measures every runtime event into RTMR3 with this event type.
pub const DSTACK_EVENT_TYPE: u32 = 134_217_729;
pub const REPORT_DATA_DOMAIN: &[u8] = b"chaperone-checker-v1:";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EventLog {
    pub imr: u32,
    pub event_type: u32,
    pub digest: String,
    pub event: String,
    pub event_payload: String,
}

/// The `tcb_info` a dstack guest reports (`/info` of the dstack guest agent). Unknown fields are ignored.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TcbInfo {
    pub mrtd: String,
    pub rtmr0: String,
    pub rtmr1: String,
    pub rtmr2: String,
    pub rtmr3: String,
    pub app_compose: String,
    pub event_log: Vec<EventLog>,
}

/// Firmware, kernel and OS image measurements of an approved dstack image (hex, 48 bytes each).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OsMeasurement {
    pub mrtd: String,
    pub rtmr0: String,
    pub rtmr1: String,
    pub rtmr2: String,
}

/// What the owner approved.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    /// sha256(app_compose) of approved checker deployments, hex.
    pub compose_hashes: Vec<String>,
    /// Approved OS images. Must not be empty.
    pub os: Vec<OsMeasurement>,
    /// Accepted TCB statuses; empty means `["UpToDate"]`.
    #[serde(default)]
    pub accepted_tcb_statuses: Vec<String>,
}

/// A successful verification.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Accepted {
    pub compose_hash: String,
    pub mrtd: String,
    pub tcb_status: String,
    pub advisory_ids: Vec<String>,
}

/// The report data the checker must put in its quote for `vault` and `public_key` (raw 32 bytes).
pub fn report_data_for(vault: &str, public_key: &[u8]) -> [u8; 64] {
    let mut h = Sha256::new();
    h.update(REPORT_DATA_DOMAIN);
    h.update(vault.as_bytes());
    h.update(b":");
    h.update(public_key);
    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&h.finalize());
    out
}

fn event_digest(event_type: u32, event: &str, payload: &[u8]) -> [u8; 48] {
    let mut h = Sha384::new();
    h.update(event_type.to_le_bytes());
    h.update(b":");
    h.update(event.as_bytes());
    h.update(b":");
    h.update(payload);
    h.finalize().into()
}

fn unhex(name: &str, s: &str) -> Result<Vec<u8>, String> {
    hex::decode(s.trim_start_matches("0x")).map_err(|_| format!("{name} is not hex"))
}

fn same(name: &str, a: &[u8], b: &[u8]) -> Result<(), String> {
    if a == b { Ok(()) } else { Err(format!("{name} mismatch")) }
}

/// Replays RTMR3 from the event log and returns it.
pub fn replay_rtmr3(events: &[EventLog]) -> Result<[u8; 48], String> {
    let mut rtmr = [0u8; 48];
    for e in events.iter().filter(|e| e.imr == 3) {
        if e.event_type != DSTACK_EVENT_TYPE {
            return Err(format!("unexpected event type {} in RTMR3", e.event_type));
        }
        let payload = unhex("event payload", &e.event_payload)?;
        // Newer dstack guests leave `digest` empty in the quote's event log: it is fully determined
        // by the event, so it is recomputed. A digest that is present must still match. Either way
        // the replayed RTMR3 has to equal the one in the signed quote.
        let digest = event_digest(e.event_type, &e.event, &payload);
        if !e.digest.is_empty() {
            same(&format!("digest of event {}", e.event), &unhex("event digest", &e.digest)?, &digest)?;
        }
        let mut h = Sha384::new();
        h.update(rtmr);
        h.update(digest);
        rtmr = h.finalize().into();
    }
    Ok(rtmr)
}

/// The single `compose-hash` event payload, checked against sha256(app_compose).
pub fn compose_hash(tcb: &TcbInfo) -> Result<String, String> {
    let mut it = tcb.event_log.iter().filter(|e| e.imr == 3 && e.event == "compose-hash");
    let ev = it.next().ok_or("no compose-hash event")?;
    if it.next().is_some() {
        return Err("duplicate compose-hash events".into());
    }
    let actual = hex::encode(Sha256::digest(tcb.app_compose.as_bytes()));
    if ev.event_payload.to_lowercase() != actual {
        return Err("compose-hash event does not match app_compose".into());
    }
    Ok(actual)
}

/// Full verification. `now_secs` is the verifier's clock (block time in the contract).
pub fn verify(
    quote: &[u8],
    collateral: &QuoteCollateralV3,
    tcb: &TcbInfo,
    expected_report_data: &[u8; 64],
    now_secs: u64,
    policy: &Policy,
) -> Result<Accepted, String> {
    if policy.os.is_empty() || policy.compose_hashes.is_empty() {
        return Err("policy has no approved OS or compose hash".into());
    }
    let report = dcap_qvl::verify::verify(quote, collateral, now_secs).map_err(|e| format!("DCAP verification failed: {e}"))?;
    let default_statuses = ["UpToDate".to_string()];
    let statuses: &[String] = if policy.accepted_tcb_statuses.is_empty() { &default_statuses } else { &policy.accepted_tcb_statuses };
    if !statuses.contains(&report.status) {
        return Err(format!("TCB status {} not accepted", report.status));
    }
    let td = report.report.as_td10().ok_or("not a TDX (TD 1.0) report")?;
    same("report_data", &td.report_data, expected_report_data)?;

    same("mrtd", &unhex("mrtd", &tcb.mrtd)?, &td.mr_td)?;
    same("rtmr0", &unhex("rtmr0", &tcb.rtmr0)?, &td.rt_mr0)?;
    same("rtmr1", &unhex("rtmr1", &tcb.rtmr1)?, &td.rt_mr1)?;
    same("rtmr2", &unhex("rtmr2", &tcb.rtmr2)?, &td.rt_mr2)?;
    same("rtmr3", &unhex("rtmr3", &tcb.rtmr3)?, &td.rt_mr3)?;
    same("rtmr3 event-log replay", &replay_rtmr3(&tcb.event_log)?, &td.rt_mr3)?;

    let compose = compose_hash(tcb)?;
    if !policy.compose_hashes.iter().any(|h| h.to_lowercase() == compose) {
        return Err(format!("compose hash {compose} is not approved"));
    }
    let os_ok = policy.os.iter().any(|o| {
        [(&o.mrtd, &td.mr_td), (&o.rtmr0, &td.rt_mr0), (&o.rtmr1, &td.rt_mr1), (&o.rtmr2, &td.rt_mr2)]
            .iter()
            .all(|(want, got)| unhex("os", want).map(|w| w.as_slice() == got.as_slice()).unwrap_or(false))
    });
    if !os_ok {
        return Err("OS measurements (MRTD, RTMR0-2) are not approved".into());
    }
    Ok(Accepted { compose_hash: compose, mrtd: hex::encode(td.mr_td), tcb_status: report.status, advisory_ids: report.advisory_ids })
}
