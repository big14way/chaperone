//! End-to-end tests of the Chaperone vault on a local NEAR sandbox (near-workspaces).
//!
//! Every test deploys a mock 6-decimal USDC (NEP-141) and a fresh vault funded with 1,000 USDC.
//! Default policy: per-tx cap 50, daily cap 100, vendor allowlisted, 24 h timelock for new
//! recipients, warn requires owner.

mod common;

use chaperone::{AgentView, Outcome, SpendRequest, Transfer, VaultInfo, Verdict, reason};
use common::*;
use near_sdk::serde_json::{self as serde_json, Value, json};

#[tokio::test]
async fn allow_within_caps_pays_vendor() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    let before = env.balance(env.vendor.id()).await?;

    let entry = env
        .spend_with(
            &buyer,
            env.vendor.id(),
            25 * USDC,
            Verdict::Allow,
            5,
            &["ALLOWLISTED"],
        )
        .await?;

    assert_outcome(&entry, Outcome::Allow);
    assert_eq!(entry.transfer, Some(Transfer::Settled));
    assert_eq!(env.balance(env.vendor.id()).await? - before, 25 * USDC);
    let agent: AgentView = env
        .view("get_agent", json!({ "public_key": buyer.public_key }))
        .await?;
    assert_eq!(agent.spent_today.0, 25 * USDC);
    assert_eq!(agent.label, "buyer");
    Ok(())
}

#[tokio::test]
async fn block_over_per_tx_cap() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    let before = env.balance(env.vault.id()).await?;

    // Even an "allow" verdict cannot push a spend past the owner's cap.
    let entry = env
        .spend_with(&buyer, env.vendor.id(), 60 * USDC, Verdict::Allow, 5, &[])
        .await?;

    assert_outcome(&entry, Outcome::Block);
    assert!(has(&entry, reason::PER_TX_CAP));
    assert_eq!(entry.transfer, None);
    assert_eq!(env.balance(env.vault.id()).await?, before);
    Ok(())
}

#[tokio::test]
async fn block_on_blocklisted_verdict_and_log_it() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    let before = env.balance(env.attacker.id()).await?;

    // The prompt-injection case: 500 USDC to an address the checker has on its blocklist.
    let entry = env
        .spend_with(
            &buyer,
            env.attacker.id(),
            500 * USDC,
            Verdict::Block,
            100,
            &["BLOCKLISTED", "NEW_ACCOUNT"],
        )
        .await?;

    assert_outcome(&entry, Outcome::Block);
    for code in [
        reason::RISK_BLOCK,
        "BLOCKLISTED",
        reason::PER_TX_CAP,
        reason::DAILY_CAP,
        reason::RECIPIENT_TIMELOCK,
    ] {
        assert!(has(&entry, code), "missing {code} in {:?}", entry.reasons);
    }
    assert_eq!(env.balance(env.attacker.id()).await?, before);

    // The refusal is on chain, in the decision log.
    let log = env.log().await?;
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].recipient.as_str(), env.attacker.id().as_str());
    assert_eq!(log[0].outcome, Outcome::Block);
    Ok(())
}

#[tokio::test]
async fn warn_parks_until_owner_approves() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    let before = env.balance(env.vendor.id()).await?;

    let entry = env
        .spend_with(
            &buyer,
            env.vendor.id(),
            30 * USDC,
            Verdict::Warn,
            45,
            &["AMOUNT_SPIKE"],
        )
        .await?;
    assert_outcome(&entry, Outcome::Warn);
    assert!(has(&entry, reason::RISK_WARN));
    let pending: Vec<SpendRequest> = env.view("get_pending", json!({})).await?;
    assert_eq!(pending.len(), 1);
    assert_eq!(
        env.balance(env.vendor.id()).await?,
        before,
        "nothing paid yet"
    );

    // One open request per agent.
    let second = env
        .spend_with(&buyer, env.vendor.id(), 1 * USDC, Verdict::Allow, 0, &[])
        .await?;
    assert_outcome(&second, Outcome::Block);
    assert!(has(&second, reason::PENDING_EXISTS));

    // Only the owner, with a full-access key (1 yocto), can approve.
    let by_agent = buyer
        .account
        .call(env.vault.id(), "approve")
        .args_json(json!({ "request_id": pending[0].id }))
        .transact()
        .await;
    assert!(by_agent.map(|r| r.is_failure()).unwrap_or(true));

    let approved: chaperone::LogEntry = env
        .owner_call("approve", json!({ "request_id": pending[0].id }))
        .await?
        .into_result()?
        .json()?;
    assert_outcome(&approved, Outcome::Approved);
    assert_eq!(approved.transfer, Some(Transfer::Settled));
    assert_eq!(env.balance(env.vendor.id()).await? - before, 30 * USDC);
    let pending: Vec<SpendRequest> = env.view("get_pending", json!({})).await?;
    assert!(pending.is_empty());
    Ok(())
}

#[tokio::test]
async fn owner_can_reject_warn() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    let entry = env
        .spend_with(&buyer, env.vendor.id(), 10 * USDC, Verdict::Warn, 50, &[])
        .await?;
    let rejected: chaperone::LogEntry = env
        .owner_call("reject", json!({ "request_id": entry.request_id }))
        .await?
        .into_result()?
        .json()?;
    assert_outcome(&rejected, Outcome::Rejected);
    assert!(has(&rejected, reason::OWNER_REJECTED));
    // The agent is free to ask again.
    let next = env
        .spend_with(&buyer, env.vendor.id(), 10 * USDC, Verdict::Allow, 0, &[])
        .await?;
    assert_outcome(&next, Outcome::Allow);
    Ok(())
}

#[tokio::test]
async fn revoke_all_kills_pending_and_keys() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let researcher = env.add_agent("researcher", None, None).await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    let parked = env
        .spend_with(&buyer, env.vendor.id(), 20 * USDC, Verdict::Warn, 40, &[])
        .await?;
    assert_outcome(&parked, Outcome::Warn);

    let revoked: u32 = env
        .owner_call("revoke_all", json!({}))
        .await?
        .into_result()?
        .json()?;
    assert_eq!(revoked, 2);

    let info: VaultInfo = env.view("get_info", json!({})).await?;
    assert_eq!(info.policy_version, 1);
    assert_eq!(info.agents, 0);
    assert_eq!(info.pending, 0);
    let log = env.log().await?;
    let cancelled = log.last().unwrap();
    assert_outcome(cancelled, Outcome::Cancelled);
    assert!(has(cancelled, reason::ALL_REVOKED));

    // The parked request can no longer be approved.
    let res = env
        .owner_call("approve", json!({ "request_id": parked.request_id }))
        .await?;
    assert!(res.is_failure());

    // Both keys are gone from the vault account: agents cannot even sign.
    for agent in [&researcher, &buyer] {
        let v = env
            .verdict(agent, env.vendor.id(), USDC, Verdict::Allow, 0, &[])
            .await?;
        let attempt = env.spend(agent, env.vendor.id(), USDC, v).await;
        assert!(attempt.map(|r| r.is_failure()).unwrap_or(true));
    }
    let keys = env.vault.view_access_keys().await?;
    assert_eq!(
        keys.len(),
        1,
        "only the vault's own full-access key remains"
    );
    Ok(())
}

#[tokio::test]
async fn daily_cap_rolls_over_next_day() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let buyer = env.add_agent("buyer", None, None).await?;

    for _ in 0..2 {
        let e = env
            .spend_with(&buyer, env.vendor.id(), 50 * USDC, Verdict::Allow, 0, &[])
            .await?;
        assert_outcome(&e, Outcome::Allow);
    }
    let over = env
        .spend_with(&buyer, env.vendor.id(), 1 * USDC, Verdict::Allow, 0, &[])
        .await?;
    assert_outcome(&over, Outcome::Block);
    assert!(has(&over, reason::DAILY_CAP));

    // Move block time past the next UTC day boundary.
    let now = env.chain_now_ms().await?;
    let next_day = (now / chaperone::DAY_MS + 1) * chaperone::DAY_MS;
    env.advance_ms(next_day - now + 1_000).await?;

    let fresh = env
        .spend_with(&buyer, env.vendor.id(), 50 * USDC, Verdict::Allow, 0, &[])
        .await?;
    assert_outcome(&fresh, Outcome::Allow);
    let agent: AgentView = env
        .view("get_agent", json!({ "public_key": buyer.public_key }))
        .await?;
    assert_eq!(agent.spent_today.0, 50 * USDC);
    Ok(())
}

#[tokio::test]
async fn two_agents_have_separate_caps() -> anyhow::Result<()> {
    let env = Env::new().await?;
    // A swarm sharing one vault: the researcher may buy small datasets, the buyer pays vendors.
    let researcher = env
        .add_agent("researcher", Some(5 * USDC), Some(2 * USDC))
        .await?;
    let buyer = env
        .add_agent("buyer", Some(100 * USDC), Some(50 * USDC))
        .await?;

    let too_big = env
        .spend_with(
            &researcher,
            env.vendor.id(),
            3 * USDC,
            Verdict::Allow,
            0,
            &[],
        )
        .await?;
    assert_outcome(&too_big, Outcome::Block);
    assert!(has(&too_big, reason::PER_TX_CAP));

    for _ in 0..2 {
        let ok = env
            .spend_with(
                &researcher,
                env.vendor.id(),
                2 * USDC,
                Verdict::Allow,
                0,
                &[],
            )
            .await?;
        assert_outcome(&ok, Outcome::Allow);
    }
    let over = env
        .spend_with(
            &researcher,
            env.vendor.id(),
            2 * USDC,
            Verdict::Allow,
            0,
            &[],
        )
        .await?;
    assert_outcome(&over, Outcome::Block);
    assert!(has(&over, reason::DAILY_CAP));

    // The buyer's budget is untouched by the researcher's spending.
    let paid = env
        .spend_with(&buyer, env.vendor.id(), 40 * USDC, Verdict::Allow, 0, &[])
        .await?;
    assert_outcome(&paid, Outcome::Allow);
    assert_eq!(paid.agent_label, "buyer");

    let agents: Vec<AgentView> = env.view("get_agents", json!({})).await?;
    let get = |l: &str| agents.iter().find(|a| a.label == l).unwrap().clone();
    assert_eq!(get("researcher").spent_today.0, 4 * USDC);
    assert_eq!(get("researcher").daily_cap.0, 5 * USDC);
    assert_eq!(get("buyer").spent_today.0, 40 * USDC);
    Ok(())
}

#[tokio::test]
async fn new_recipient_waits_for_timelock() -> anyhow::Result<()> {
    let env = Env::with_policy(|p| p.new_recipient_timelock_ms = 60 * 60 * 1000).await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    let newcomer = env.attacker.id(); // not allowlisted

    let first = env
        .spend_with(&buyer, newcomer, 5 * USDC, Verdict::Allow, 10, &[])
        .await?;
    assert_outcome(&first, Outcome::Block);
    assert!(has(&first, reason::RECIPIENT_TIMELOCK));
    let seen: Option<u64> = env
        .view("get_first_seen", json!({ "account_id": newcomer }))
        .await?;
    assert!(seen.is_some());

    env.advance_ms(60 * 60 * 1000 + 1_000).await?;
    let later = env
        .spend_with(&buyer, newcomer, 5 * USDC, Verdict::Allow, 10, &[])
        .await?;
    assert_outcome(&later, Outcome::Allow);
    Ok(())
}

#[tokio::test]
async fn forged_expired_and_replayed_verdicts_are_refused() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    let vendor = env.vendor.id();

    // Signed for 1 USDC, used for 40 USDC.
    let v = env
        .verdict(&buyer, vendor, USDC, Verdict::Allow, 0, &[])
        .await?;
    let e: chaperone::LogEntry = env
        .spend(&buyer, vendor, 40 * USDC, v)
        .await?
        .into_result()?
        .json()?;
    assert_outcome(&e, Outcome::Block);
    assert!(has(&e, reason::BAD_SIGNATURE));

    // Signed by someone other than the checker.
    let mut forged = env
        .verdict(&buyer, vendor, USDC, Verdict::Allow, 0, &[])
        .await?;
    forged["signature"] = json!(near_sdk::base64::Engine::encode(
        &near_sdk::base64::engine::general_purpose::STANDARD,
        [9u8; 64]
    ));
    let e: chaperone::LogEntry = env
        .spend(&buyer, vendor, USDC, forged)
        .await?
        .into_result()?
        .json()?;
    assert!(has(&e, reason::BAD_SIGNATURE));

    // Expired.
    let now = env.chain_now_ms().await?;
    let stale = env.verdict_with(&buyer, vendor, USDC, Verdict::Allow, 0, &[], now - 1, None);
    let e: chaperone::LogEntry = env
        .spend(&buyer, vendor, USDC, stale)
        .await?
        .into_result()?
        .json()?;
    assert!(has(&e, reason::VERDICT_EXPIRED));

    // Replayed nonce.
    let v = env.verdict_with(
        &buyer,
        vendor,
        USDC,
        Verdict::Allow,
        0,
        &[],
        now + 120_000,
        Some("once".into()),
    );
    let ok: chaperone::LogEntry = env
        .spend(&buyer, vendor, USDC, v.clone())
        .await?
        .into_result()?
        .json()?;
    assert_outcome(&ok, Outcome::Allow);
    let replay: chaperone::LogEntry = env
        .spend(&buyer, vendor, USDC, v)
        .await?
        .into_result()?
        .json()?;
    assert_outcome(&replay, Outcome::Block);
    assert!(has(&replay, reason::NONCE_REUSED));

    // A high score is a block even if the label says allow.
    let e = env
        .spend_with(&buyer, vendor, USDC, Verdict::Allow, 90, &[])
        .await?;
    assert_outcome(&e, Outcome::Block);
    assert!(has(&e, reason::RISK_BLOCK));
    Ok(())
}

#[tokio::test]
async fn function_call_key_limits_hold() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let buyer = env.add_agent("buyer", None, None).await?;

    // The key itself: function-call only, receiver = vault, method = request_spend.
    let key = env
        .vault
        .view_access_key(&buyer.public_key.parse()?)
        .await?;
    match key.permission {
        near_workspaces::types::AccessKeyPermission::FunctionCall(fc) => {
            assert_eq!(fc.receiver_id.as_str(), env.vault.id().as_str());
            assert_eq!(fc.method_names, vec!["request_spend".to_string()]);
            assert!(fc.allowance.is_some(), "gas allowance is capped");
        }
        _ => panic!("agent key must not be full access"),
    }

    // Cannot move tokens directly: wrong receiver and needs a 1 yocto deposit.
    let direct = buyer
        .account
        .call(env.usdc.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": env.attacker.id(), "amount": (500 * USDC).to_string() }))
        .deposit(ONE_YOCTO)
        .transact()
        .await;
    assert!(direct.map(|r| r.is_failure()).unwrap_or(true));

    // Cannot change its own policy or add keys.
    for (method, args) in [
        (
            "set_policy",
            json!({ "policy": default_policy(env.usdc.id(), env.attacker.id()) }),
        ),
        (
            "add_agent",
            json!({ "public_key": buyer.public_key, "label": "evil" }),
        ),
        ("revoke_all", json!({})),
    ] {
        let r = buyer
            .account
            .call(env.vault.id(), method)
            .args_json(args)
            .transact()
            .await;
        assert!(
            r.map(|r| r.is_failure()).unwrap_or(true),
            "{method} must fail"
        );
    }

    // Cannot attach a deposit even to request_spend.
    let v = env
        .verdict(&buyer, env.vendor.id(), USDC, Verdict::Allow, 0, &[])
        .await?;
    let with_deposit = buyer
        .account
        .call(env.vault.id(), "request_spend")
        .args_json(json!({
            "token": env.usdc.id(), "amount": USDC.to_string(),
            "recipient": env.vendor.id(), "verdict": v,
        }))
        .deposit(ONE_YOCTO)
        .transact()
        .await;
    assert!(with_deposit.map(|r| r.is_failure()).unwrap_or(true));

    // Another account cannot call request_spend at all.
    let v = env
        .verdict(&buyer, env.vendor.id(), USDC, Verdict::Allow, 0, &[])
        .await?;
    let outsider = env
        .attacker
        .call(env.vault.id(), "request_spend")
        .args_json(json!({
            "token": env.usdc.id(), "amount": USDC.to_string(),
            "recipient": env.attacker.id(), "verdict": v,
        }))
        .max_gas()
        .transact()
        .await?;
    assert!(outsider.is_failure());
    Ok(())
}

#[tokio::test]
async fn failed_transfer_refunds_daily_budget() -> anyhow::Result<()> {
    // Recipient allowlisted but never registered with the token: ft_transfer fails.
    let env = Env::with_policy(|p| {
        p.allow_recipients
            .push("unregistered.test.near".parse().unwrap());
    })
    .await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    let unregistered: near_workspaces::AccountId = "unregistered.test.near".parse()?;
    let e = env
        .spend_with(&buyer, &unregistered, 10 * USDC, Verdict::Allow, 0, &[])
        .await?;
    assert_outcome(&e, Outcome::Allow);
    assert_eq!(e.transfer, Some(Transfer::Failed));
    assert!(has(&e, reason::TRANSFER_FAILED));
    let agent: AgentView = env
        .view("get_agent", json!({ "public_key": buyer.public_key }))
        .await?;
    assert_eq!(agent.spent_today.0, 0);
    Ok(())
}

#[tokio::test]
async fn gas_allowance_exhaustion_locks_agent_out_until_rekeyed() -> anyhow::Result<()> {
    let env = Env::new().await?;
    // A key may only sign a transaction its remaining allowance can cover at the pessimistic
    // gas price: ~0.1009 NEAR for 100 Tgas in the sandbox. Give the key just over that.
    let tight = near_workspaces::types::NearToken::from_micronear(101_000);
    let buyer = env
        .add_agent_with_allowance("buyer", None, None, Some(tight))
        .await?;

    let first = env
        .spend_with(&buyer, env.vendor.id(), USDC, Verdict::Allow, 0, &[])
        .await?;
    assert_outcome(&first, Outcome::Allow);

    // The key is charged up front at the pessimistic price; unused gas is refunded to the
    // allowance a few blocks later. Net, it pays only the gas burnt (well under 0.01 NEAR) ...
    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
    let key = env
        .vault
        .view_access_key(&buyer.public_key.parse()?)
        .await?;
    let left = match key.permission {
        near_workspaces::types::AccessKeyPermission::FunctionCall(fc) => fc.allowance.unwrap(),
        _ => unreachable!(),
    };
    let burnt = tight.as_yoctonear() - left.as_yoctonear();
    assert!(
        burnt > 0 && burnt < 10_000_000_000_000_000_000_000,
        "burnt {burnt}"
    );
    // ... but what is left no longer covers the next 100 Tgas call.

    let v = env
        .verdict(&buyer, env.vendor.id(), USDC, Verdict::Allow, 0, &[])
        .await?;
    let locked = env.spend(&buyer, env.vendor.id(), USDC, v).await;
    let msg = match locked {
        Err(e) => format!("{e:?}"),
        Ok(r) => {
            assert!(r.is_failure(), "spend must not go through");
            format!("{:?}", r.failures())
        }
    };
    assert!(
        msg.contains("NotEnoughAllowance"),
        "unexpected error: {msg}"
    );

    // The owner re-keys the agent with a fresh allowance.
    env.owner_call("revoke_agent", json!({ "public_key": buyer.public_key }))
        .await?
        .into_result()?;
    let buyer2 = env.add_agent("buyer", None, None).await?;
    let again = env
        .spend_with(&buyer2, env.vendor.id(), USDC, Verdict::Allow, 0, &[])
        .await?;
    assert_outcome(&again, Outcome::Allow);
    Ok(())
}

#[tokio::test]
async fn owner_upgrades_code_and_state_survives_others_cannot() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    env.spend_with(&buyer, env.vendor.id(), 5 * USDC, Verdict::Allow, 5, &[])
        .await?;
    let before: VaultInfo = env.view("get_info", json!({})).await?;
    let code = wasm("chaperone");

    // A stranger cannot replace the code.
    let res = env
        .attacker
        .call(env.vault.id(), "update_contract")
        .args(code.clone())
        .deposit(ONE_YOCTO)
        .max_gas()
        .transact()
        .await?;
    assert!(res.is_failure(), "non-owner upgrade must fail");

    // Garbage input is refused even from the owner.
    let res = env
        .owner
        .call(env.vault.id(), "update_contract")
        .args(b"not wasm at all".to_vec())
        .deposit(ONE_YOCTO)
        .max_gas()
        .transact()
        .await?;
    assert!(res.is_failure(), "non-wasm input must fail");

    // The owner can, and the vault keeps its state.
    let res = env
        .owner
        .call(env.vault.id(), "update_contract")
        .args(code)
        .deposit(ONE_YOCTO)
        .max_gas()
        .transact()
        .await?;
    assert!(res.is_success(), "owner upgrade failed: {res:?}");
    let after: VaultInfo = env.view("get_info", json!({})).await?;
    assert_eq!(after.log_len, before.log_len);
    assert_eq!(after.agents, before.agents);
    assert_eq!(after.owner, before.owner);
    Ok(())
}

fn tee_fixture() -> (Value, Value, String, Value) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../crates/chaperone-tee/tests/fixtures/");
    let read = |f: &str| std::fs::read_to_string(format!("{dir}{f}")).unwrap();
    let tcb: Value = serde_json::from_str(&read("nearai_tcb_info.json")).unwrap();
    let collateral: Value = serde_json::from_str(&read("nearai_collateral.json")).unwrap();
    let quote = read("nearai_quote.hex").trim().to_string();
    let policy = json!({
        "compose_hashes": [tcb["compose_hash"].as_str().unwrap()],
        "os": [{ "mrtd": tcb["mrtd"], "rtmr0": tcb["rtmr0"], "rtmr1": tcb["rtmr1"], "rtmr2": tcb["rtmr2"] }],
        "accepted_tcb_statuses": []
    });
    (tcb, collateral, quote, policy)
}

#[tokio::test]
async fn tee_mode_requires_an_attested_checker() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let buyer = env.add_agent("buyer", None, None).await?;
    let (_, _, _, policy) = tee_fixture();

    // Before TEE mode the owner-set checker works.
    let ok = env.spend_with(&buyer, env.vendor.id(), 5 * USDC, Verdict::Allow, 5, &[]).await?;
    assert_outcome(&ok, Outcome::Allow);

    // A stranger cannot set the TEE policy.
    let res = env.attacker.call(env.vault.id(), "set_checker_tee_policy").args_json(json!({ "policy": policy })).deposit(ONE_YOCTO).max_gas().transact().await?;
    assert!(res.is_failure());

    // The owner turns TEE mode on: the existing checker key is not attested, so its verdicts are refused.
    assert!(env.owner_call("set_checker_tee_policy", json!({ "policy": policy })).await?.is_success());
    let view: chaperone::TeeView = env.view("get_checker_tee", json!({})).await?;
    assert!(view.enforced && !view.checker_attested);
    let refused = env.spend_with(&buyer, env.vendor.id(), 5 * USDC, Verdict::Allow, 5, &[]).await?;
    assert_outcome(&refused, Outcome::Block);
    assert!(has(&refused, reason::CHECKER_NOT_ATTESTED));

    // In TEE mode the owner cannot swap the checker key by hand.
    let res = env.owner_call("set_checker", json!({ "checker_pk": checker_pk_string(&env.checker) })).await?;
    assert!(res.is_failure());

    // Turning TEE mode off restores the owner-set checker.
    assert!(env.owner_call("set_checker_tee_policy", json!({ "policy": null })).await?.is_success());
    let ok = env.spend_with(&buyer, env.vendor.id(), 5 * USDC, Verdict::Allow, 5, &[]).await?;
    assert_outcome(&ok, Outcome::Allow);
    Ok(())
}

#[tokio::test]
async fn register_checker_verifies_a_real_tdx_quote_on_chain() -> anyhow::Result<()> {
    let env = Env::new().await?;
    let (tcb, collateral, quote, policy) = tee_fixture();

    // No policy yet: registration is refused.
    let res = env.attacker.call(env.vault.id(), "register_checker")
        .args_json(json!({ "public_key": checker_pk_string(&env.checker), "quote": quote, "collateral": collateral, "tcb_info": tcb }))
        .max_gas().transact().await?;
    assert!(format!("{:?}", res.into_result().unwrap_err()).contains("no TEE policy"));

    assert!(env.owner_call("set_checker_tee_policy", json!({ "policy": policy })).await?.is_success());

    // A real Intel TDX quote (NEAR AI Cloud's) passes DCAP, TCB and measurement checks on chain, but its
    // report data binds NEAR AI's signing key, not this vault and this checker key, so it is refused.
    let res = env.attacker.call(env.vault.id(), "register_checker")
        .args_json(json!({ "public_key": checker_pk_string(&env.checker), "quote": quote, "collateral": collateral, "tcb_info": tcb }))
        .max_gas().transact().await?;
    let gas = res.total_gas_burnt;
    let err = format!("{:?}", res.into_result().unwrap_err());
    assert!(err.contains("report_data mismatch"), "expected the binding check to fail last, got: {err}");
    println!("register_checker with a real quote burnt {} Tgas", gas.as_tgas());
    assert!(gas.as_tgas() < 300, "verification must fit in one transaction");

    // A forged quote fails DCAP.
    let mut bad = quote.clone();
    bad.replace_range(200..202, "00");
    let res = env.attacker.call(env.vault.id(), "register_checker")
        .args_json(json!({ "public_key": checker_pk_string(&env.checker), "quote": bad, "collateral": collateral, "tcb_info": tcb }))
        .max_gas().transact().await?;
    assert!(format!("{:?}", res.into_result().unwrap_err()).contains("attestation rejected"));
    Ok(())
}
