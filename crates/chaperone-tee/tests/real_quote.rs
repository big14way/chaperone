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
