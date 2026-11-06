//! attest: helpers for the TEE-attested checker.
//!
//!   attest collateral <quote.hex>                      Intel DCAP collateral (JSON) from Phala's PCCS
//!   attest verify <attestation.json> <policy.json> <vault> <public_key_hex>
//!                                                      the same checks the vault contract runs
//!
//! `attestation.json` is `{ "quote": hex, "tcb_info": {...}, "collateral": {...} }` as produced by
//! `pnpm attest:checker`. The PCCS defaults to https://pccs.phala.network (set PCCS_URL to change).
use anyhow::{Context, Result, bail};
use chaperone_tee::{Policy, TcbInfo};
use dcap_qvl::QuoteCollateralV3;
use dcap_qvl::collateral::{CollateralClient, PHALA_PCCS_URL};

fn read(path: &str) -> Result<String> {
    std::fs::read_to_string(path).with_context(|| format!("read {path}"))
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("collateral") => {
            let quote = hex::decode(read(&args[1])?.trim().trim_start_matches("0x"))?;
            let pccs = std::env::var("PCCS_URL").unwrap_or_else(|_| PHALA_PCCS_URL.to_string());
            let c = CollateralClient::with_default_http(&pccs)?.fetch(&quote).await?;
            println!("{}", serde_json::to_string(&c)?);
        }
        Some("verify") => {
            let a: serde_json::Value = serde_json::from_str(&read(&args[1])?)?;
            let policy: Policy = serde_json::from_str(&read(&args[2])?)?;
            let quote = hex::decode(a["quote"].as_str().context("quote")?.trim_start_matches("0x"))?;
            let tcb: TcbInfo = serde_json::from_value(a["tcb_info"].clone())?;
            let collateral: QuoteCollateralV3 = serde_json::from_value(a["collateral"].clone())?;
            let pk = hex::decode(&args[4])?;
            let rd = chaperone_tee::report_data_for(&args[3], &pk);
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
            match chaperone_tee::verify(&quote, &collateral, &tcb, &rd, now, &policy) {
                Ok(ok) => println!("{}", serde_json::to_string_pretty(&ok)?),
                Err(e) => bail!("rejected: {e}"),
            }
        }
        _ => bail!("usage: attest collateral <quote.hex> | attest verify <attestation.json> <policy.json> <vault> <pk_hex>"),
    }
    Ok(())
}
