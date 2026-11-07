//! Runs the verifier against a real dstack TDX attestation: NEAR AI Cloud's report for
//! deepseek-ai/DeepSeek-V4.1-Flash-1017 (quote, TCB info with event log), with Intel collateral fetched
//! from Phala's PCCS by `attest collateral`. NEAR AI binds report_data = signing_address (20 bytes,
//! zero-padded to 32) || nonce (32), so the test uses that binding instead of the checker's.
use chaperone_tee::{OsMeasurement, Policy, TcbInfo, verify};
use dcap_qvl::QuoteCollateralV3;

struct Fixture {
    quote: Vec<u8>,
    tcb: TcbInfo,
    collateral: QuoteCollateralV3,
    report_data: [u8; 64],
    now: u64,
}

fn fixture() -> Fixture {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/");
    let read = |f: &str| std::fs::read_to_string(format!("{dir}{f}")).unwrap();
    let meta: serde_json::Value = serde_json::from_str(&read("nearai_meta.json")).unwrap();
    let mut report_data = [0u8; 64];
    let addr = hex::decode(meta["signing_address"].as_str().unwrap().trim_start_matches("0x")).unwrap();
    report_data[..addr.len()].copy_from_slice(&addr);
    report_data[32..].copy_from_slice(&hex::decode(meta["request_nonce"].as_str().unwrap()).unwrap());
    Fixture {
        quote: hex::decode(read("nearai_quote.hex").trim()).unwrap(),
        tcb: serde_json::from_str(&read("nearai_tcb_info.json")).unwrap(),
        collateral: serde_json::from_str(&read("nearai_collateral.json")).unwrap(),
        report_data,
        now: meta["fetched_at"].as_u64().unwrap() + 60,
    }
}

fn policy(f: &Fixture) -> Policy {
    Policy {
        compose_hashes: vec![chaperone_tee::compose_hash(&f.tcb).unwrap()],
        os: vec![OsMeasurement { mrtd: f.tcb.mrtd.clone(), rtmr0: f.tcb.rtmr0.clone(), rtmr1: f.tcb.rtmr1.clone(), rtmr2: f.tcb.rtmr2.clone() }],
        accepted_tcb_statuses: vec![],
    }
}

#[test]
fn accepts_a_real_tdx_attestation() {
    let f = fixture();
    let ok = verify(&f.quote, &f.collateral, &f.tcb, &f.report_data, f.now, &policy(&f)).expect("real attestation must verify");
    assert_eq!(ok.tcb_status, "UpToDate");
    assert_eq!(ok.compose_hash.len(), 64);
}

#[test]
fn rejects_another_nonce_or_key_binding() {
    let f = fixture();
    let mut rd = f.report_data;
    rd[63] ^= 1;
    let e = verify(&f.quote, &f.collateral, &f.tcb, &rd, f.now, &policy(&f)).unwrap_err();
    assert!(e.contains("report_data"), "{e}");
}

#[test]
fn rejects_an_unapproved_compose_hash() {
    let f = fixture();
    let mut p = policy(&f);
    p.compose_hashes = vec!["00".repeat(32)];
    let e = verify(&f.quote, &f.collateral, &f.tcb, &f.report_data, f.now, &p).unwrap_err();
    assert!(e.contains("not approved"), "{e}");
}

#[test]
fn rejects_a_different_app_compose() {
    let mut f = fixture();
    let p = policy(&f);
    f.tcb.app_compose.push(' ');
    let e = verify(&f.quote, &f.collateral, &f.tcb, &f.report_data, f.now, &p).unwrap_err();
    assert!(e.contains("compose"), "{e}");
}

#[test]
fn rejects_a_tampered_event_log() {
    let mut f = fixture();
    let p = policy(&f);
    let ev = f.tcb.event_log.iter_mut().find(|e| e.imr == 3 && e.event == "app-id").unwrap();
    ev.event_payload = "00".repeat(20);
    let e = verify(&f.quote, &f.collateral, &f.tcb, &f.report_data, f.now, &p).unwrap_err();
    assert!(e.contains("digest of event") || e.contains("rtmr3"), "{e}");
}

#[test]
fn rejects_an_unapproved_os_image() {
    let f = fixture();
    let mut p = policy(&f);
    p.os[0].rtmr1 = "00".repeat(48);
    let e = verify(&f.quote, &f.collateral, &f.tcb, &f.report_data, f.now, &p).unwrap_err();
    assert!(e.contains("OS measurements"), "{e}");
}

#[test]
fn rejects_expired_collateral() {
    let f = fixture();
    let e = verify(&f.quote, &f.collateral, &f.tcb, &f.report_data, f.now + 400 * 86_400, &policy(&f)).unwrap_err();
    assert!(e.contains("DCAP"), "{e}");
}

#[test]
fn checker_report_data_binds_vault_and_key() {
    let a = chaperone_tee::report_data_for("chaperone.testnet", &[1u8; 32]);
    let b = chaperone_tee::report_data_for("other.testnet", &[1u8; 32]);
    let c = chaperone_tee::report_data_for("chaperone.testnet", &[2u8; 32]);
    assert_ne!(a, b);
    assert_ne!(a, c);
    assert_eq!(&a[32..], &[0u8; 32]);
}

#[test]
fn report_data_matches_the_typescript_enclave() {
    // Same value as checker/test/tee.test.ts: the enclave and the contract must agree byte for byte.
    let rd = chaperone_tee::report_data_for("chaperone.testnet", &[1u8; 32]);
    assert_eq!(hex::encode(&rd[..32]), "f63aac1c25490c2b399152a79709a3c8e5a3233edbb8ff84468f97fdd519284b");
}

/// The checker image from this repo, attested by a Phala Cloud dstack CVM: the checker's own binding
/// (vault and enclave key), and an event log whose per-event digests are left empty.
struct Checker {
    quote: Vec<u8>,
    tcb: TcbInfo,
    collateral: QuoteCollateralV3,
    report_data: [u8; 64],
    now: u64,
}

fn phala_checker() -> Checker {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/phala_checker_attestation.json")).unwrap();
    let a: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let pk = bs58::decode(a["public_key"].as_str().unwrap().trim_start_matches("ed25519:")).into_vec().unwrap();
    let fetched = a["collateral_fetched_at"].as_str().unwrap();
    Checker {
        quote: hex::decode(a["quote"].as_str().unwrap()).unwrap(),
        tcb: serde_json::from_value(a["tcb_info"].clone()).unwrap(),
        collateral: serde_json::from_value(a["collateral"].clone()).unwrap(),
        report_data: chaperone_tee::report_data_for(a["vault"].as_str().unwrap(), &pk),
        now: chrono_secs(fetched) + 60,
    }
}

/// Seconds since the epoch for an ISO-8601 UTC timestamp like 2026-11-07T10:09:23.150Z.
fn chrono_secs(iso: &str) -> u64 {
    let (date, time) = iso.split_once('T').unwrap();
    let d: Vec<i64> = date.split('-').map(|x| x.parse().unwrap()).collect();
    let t: Vec<f64> = time.trim_end_matches('Z').split(':').map(|x| x.parse().unwrap()).collect();
    // Days from civil (Howard Hinnant).
    let (y, m) = if d[1] <= 2 { (d[0] - 1, d[1] + 9) } else { (d[0], d[1] - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + d[2] - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    (days * 86_400 + (t[0] * 3600.0 + t[1] * 60.0 + t[2]) as i64) as u64
}

fn checker_policy(c: &Checker) -> Policy {
    Policy {
        compose_hashes: vec![chaperone_tee::compose_hash(&c.tcb).unwrap()],
        os: vec![OsMeasurement { mrtd: c.tcb.mrtd.clone(), rtmr0: c.tcb.rtmr0.clone(), rtmr1: c.tcb.rtmr1.clone(), rtmr2: c.tcb.rtmr2.clone() }],
        accepted_tcb_statuses: vec![],
    }
}

#[test]
fn accepts_the_checker_attested_on_phala_cloud() {
    let c = phala_checker();
    assert!(c.tcb.event_log.iter().filter(|e| e.imr == 3).all(|e| e.digest.is_empty()), "fixture has digest-less events");
    let ok = verify(&c.quote, &c.collateral, &c.tcb, &c.report_data, c.now, &checker_policy(&c)).expect("checker attestation must verify");
    assert_eq!(ok.compose_hash, "31d5ee67a701e18f222fb058325c3bade861d1a688ac4207f5dd43ae568dbf16");
    assert!(c.tcb.app_compose.contains("ghcr.io/big14way/chaperone-checker@sha256:"));
}

#[test]
fn rejects_a_tampered_digestless_event_log() {
    let mut c = phala_checker();
    let p = checker_policy(&c);
    let ev = c.tcb.event_log.iter_mut().find(|e| e.imr == 3 && e.event == "app-id").unwrap();
    ev.event_payload = "00".repeat(20);
    let e = verify(&c.quote, &c.collateral, &c.tcb, &c.report_data, c.now, &p).unwrap_err();
    assert!(e.contains("rtmr3"), "{e}");
}

#[test]
fn rejects_the_checker_bound_to_another_vault() {
    let c = phala_checker();
    let pk = [7u8; 32];
    let rd = chaperone_tee::report_data_for("chaperone.testnet", &pk);
    let e = verify(&c.quote, &c.collateral, &c.tcb, &rd, c.now, &checker_policy(&c)).unwrap_err();
    assert!(e.contains("report_data"), "{e}");
}
