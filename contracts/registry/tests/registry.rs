//! The shared blocklist registry on a local NEAR sandbox (near-workspaces).
use chaperone_registry::Flag;
use near_workspaces::network::ValidatorKey;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract};
use serde_json::json;

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

struct Env {
    _node: near_sandbox::Sandbox,
    registry: Contract,
    owner: Account,
    vault_owner: Account,
    stranger: Account,
}

async fn env() -> anyhow::Result<Env> {
    let node = near_sandbox::Sandbox::start_sandbox().await?;
    let worker = near_workspaces::sandbox()
        .rpc_addr(&node.rpc_addr)
        .validator_key(ValidatorKey::HomeDir(node.home_dir.path().to_path_buf()))
        .await?;
    let root = worker.root_account()?;
    let mut accounts = vec![];
    for name in ["owner", "vaultowner", "stranger", "registry"] {
        accounts.push(root.create_subaccount(name).initial_balance(NearToken::from_near(10)).transact().await?.into_result()?);
    }
    let wasm = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/near/chaperone_registry/chaperone_registry.wasm"))
        .expect("run `pnpm build:contracts` first");
    let registry = accounts[3].deploy(&wasm).await?.into_result()?;
    registry.call("new").args_json(json!({ "owner": accounts[0].id() })).transact().await?.into_result()?;
    Ok(Env { _node: node, registry, owner: accounts[0].clone(), vault_owner: accounts[1].clone(), stranger: accounts[2].clone() })
}

async fn report(by: &Account, e: &Env, who: &str, reason: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(by
        .call(e.registry.id(), "report")
        .args_json(json!({ "account_id": who, "reason": reason, "evidence": "tx 9xQ…: invoice page changed the payee" }))
        .deposit(ONE_YOCTO)
        .transact()
        .await?)
}

async fn flag(e: &Env, who: &str) -> anyhow::Result<Option<Flag>> {
    Ok(e.registry.view("get_flag").args_json(json!({ "account_id": who })).await?.json()?)
}

#[tokio::test]
async fn trusted_reporters_flag_and_everyone_reads() -> anyhow::Result<()> {
    let e = env().await?;
    // Not trusted yet.
    let denied = report(&e.vault_owner, &e, "drainer.test.near", "PAYMENT_REDIRECT_SCAM").await?;
    assert!(format!("{:?}", denied.into_result().unwrap_err()).contains("trusted reporter"));

    e.owner.call(e.registry.id(), "add_reporter").args_json(json!({ "account_id": e.vault_owner.id() })).deposit(ONE_YOCTO).transact().await?.into_result()?;
    let out = report(&e.vault_owner, &e, "drainer.test.near", "PAYMENT_REDIRECT_SCAM").await?.into_result()?;
    assert!(out.logs().iter().any(|l| l.contains("\"event\":\"flagged\"")));

    let f = flag(&e, "drainer.test.near").await?.expect("flagged");
    assert_eq!(f.reason, "PAYMENT_REDIRECT_SCAM");
    assert_eq!(f.reporter.as_str(), e.vault_owner.id().as_str());
    assert!(flag(&e, "vendor.test.near").await?.is_none());

    // A second report keeps the first flag.
    report(&e.owner, &e, "drainer.test.near", "OTHER").await?.into_result()?;
    assert_eq!(flag(&e, "drainer.test.near").await?.unwrap().reporter.as_str(), e.vault_owner.id().as_str());
    let all: Vec<Flag> = e.registry.view("get_flags").args_json(json!({})).await?.json()?;
    assert_eq!(all.len(), 1);
    Ok(())
}

#[tokio::test]
async fn only_reporter_or_owner_clears_and_input_is_checked() -> anyhow::Result<()> {
    let e = env().await?;
    e.owner.call(e.registry.id(), "add_reporter").args_json(json!({ "account_id": e.vault_owner.id() })).deposit(ONE_YOCTO).transact().await?.into_result()?;
    report(&e.vault_owner, &e, "drainer.test.near", "PAYMENT_REDIRECT_SCAM").await?.into_result()?;

    let bad = report(&e.vault_owner, &e, "x.test.near", "not a code").await?;
    assert!(format!("{:?}", bad.into_result().unwrap_err()).contains("UPPER_SNAKE"));

    let stranger = e.stranger.call(e.registry.id(), "clear").args_json(json!({ "account_id": "drainer.test.near" })).deposit(ONE_YOCTO).transact().await?;
    assert!(format!("{:?}", stranger.into_result().unwrap_err()).contains("only the reporter or the owner"));

    // Removing a reporter does not erase what it filed; the owner can still clear it.
    e.owner.call(e.registry.id(), "remove_reporter").args_json(json!({ "account_id": e.vault_owner.id() })).deposit(ONE_YOCTO).transact().await?.into_result()?;
    assert!(flag(&e, "drainer.test.near").await?.is_some());
    e.owner.call(e.registry.id(), "clear").args_json(json!({ "account_id": "drainer.test.near" })).deposit(ONE_YOCTO).transact().await?.into_result()?;
    assert!(flag(&e, "drainer.test.near").await?.is_none());
    Ok(())
}
