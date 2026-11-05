//! Shared sandbox fixture for the vault integration tests.
//!
//! Wasm files come from `cargo near build` (see the root `pnpm build:contracts`), so the
//! tests exercise exactly what gets deployed.

#![allow(dead_code)]

use std::sync::atomic::{AtomicU64, Ordering};

use chaperone::{LogEntry, Outcome, Policy, Verdict, verdict_message};
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde_json::{Value, json};
use near_workspaces::network::{Sandbox, ValidatorKey};
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};

pub const USDC: u128 = 1_000_000; // 6 decimals
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

static NONCE: AtomicU64 = AtomicU64::new(1);

pub fn wasm(name: &str) -> Vec<u8> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let path = root.join(format!("target/near/{name}/{name}.wasm"));
    std::fs::read(&path).unwrap_or_else(|_| {
        panic!(
            "missing {}: run `pnpm build:contracts` (cargo near build) first",
            path.display()
        )
    })
}

pub struct Env {
    /// Keeps the sandbox node alive for the duration of the test.
    _node: near_sandbox::Sandbox,
    pub worker: Worker<Sandbox>,
    pub owner: Account,
    pub vault: Contract,
    pub usdc: Contract,
    pub vendor: Account,
    pub attacker: Account,
    pub checker: SigningKey,
}

pub struct AgentHandle {
    pub label: String,
    pub account: Account,
    pub public_key: String,
}

pub fn default_policy(usdc: &AccountId, vendor: &AccountId) -> Policy {
    Policy {
        daily_cap: U128(100 * USDC),
        per_tx_cap: U128(50 * USDC),
        allow_recipients: vec![vendor.as_str().parse().unwrap()],
        allow_tokens: vec![usdc.as_str().parse().unwrap()],
        new_recipient_timelock_ms: 86_400_000,
        warn_requires_owner: true,
    }
}

pub fn checker_pk_string(key: &SigningKey) -> String {
    format!(
        "ed25519:{}",
        near_sdk::bs58::encode(key.verifying_key().to_bytes()).into_string()
    )
}

impl Env {
    /// Sandbox with: mock USDC, a funded vault (1,000 USDC), an owner, an allowlisted vendor
    /// and an attacker account. No agents yet.
    pub async fn new() -> anyhow::Result<Self> {
        Self::with_policy(|_| {}).await
    }

    pub async fn with_policy(tweak: impl FnOnce(&mut Policy)) -> anyhow::Result<Self> {
        // A long epoch lets `fast_forward` jump a whole day in one step (it advances at most
        // one epoch per step otherwise, which takes minutes for a day of blocks).
        let node = near_sandbox::Sandbox::start_sandbox_with_config(near_sandbox::SandboxConfig {
            additional_genesis: Some(json!({ "epoch_length": 500_000 })),
            additional_accounts: vec![near_sandbox::GenesisAccount::default_with_name(
                "registrar".parse()?,
            )],
            ..Default::default()
        })
        .await?;
        let worker = near_workspaces::sandbox()
            .rpc_addr(&node.rpc_addr)
            .validator_key(ValidatorKey::HomeDir(node.home_dir.path().to_path_buf()))
            .await?;
        let root = worker.root_account()?;
        let sub = |name: &'static str, near: u128| {
            let root = root.clone();
            async move {
                root.create_subaccount(name)
                    .initial_balance(NearToken::from_near(near))
                    .transact()
                    .await?
                    .into_result()
                    .map_err(anyhow::Error::from)
            }
        };
        let owner = sub("owner", 50).await?;
        let vendor = sub("vendor", 5).await?;
        let attacker = sub("attacker", 5).await?;
        let usdc_acc = sub("usdc", 20).await?;
        let vault_acc = sub("vault", 30).await?;

        let usdc = usdc_acc.deploy(&wasm("mock_ft")).await?.into_result()?;
        usdc.call("new")
            .args_json(
                json!({ "owner_id": owner.id(), "total_supply": (1_000_000 * USDC).to_string() }),
            )
            .transact()
            .await?
            .into_result()?;

        let checker = SigningKey::from_bytes(&[7u8; 32]);
        let mut policy = default_policy(usdc.id(), vendor.id());
        tweak(&mut policy);
        let vault = vault_acc.deploy(&wasm("chaperone")).await?.into_result()?;
        vault
            .call("new")
            .args_json(json!({
                "owner": owner.id(),
                "checker_pk": checker_pk_string(&checker),
                "policy": policy,
            }))
            .transact()
            .await?
            .into_result()?;

        // Register vault, vendor and attacker with the token, then fund the vault.
        for who in [vault.id(), vendor.id(), attacker.id()] {
            owner
                .call(usdc.id(), "storage_deposit")
                .args_json(json!({ "account_id": who, "registration_only": true }))
                .deposit(NearToken::from_millinear(10))
                .transact()
                .await?
                .into_result()?;
        }
        owner
            .call(usdc.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": vault.id(),
                "amount": (1_000 * USDC).to_string(),
                "msg": "fund",
            }))
            .deposit(ONE_YOCTO)
            .max_gas()
            .transact()
            .await?
            .into_result()?;

        Ok(Self {
            _node: node,
            worker,
            owner,
            vault,
            usdc,
            vendor,
            attacker,
            checker,
        })
    }

    /// Owner registers an agent. The vault adds the function-call key to itself.
    pub async fn add_agent(
        &self,
        label: &str,
        daily_cap: Option<u128>,
        per_tx_cap: Option<u128>,
    ) -> anyhow::Result<AgentHandle> {
        self.add_agent_with_allowance(label, daily_cap, per_tx_cap, None)
            .await
    }

    pub async fn add_agent_with_allowance(
        &self,
        label: &str,
        daily_cap: Option<u128>,
        per_tx_cap: Option<u128>,
        allowance: Option<NearToken>,
    ) -> anyhow::Result<AgentHandle> {
        let sk = SecretKey::from_random(KeyType::ED25519);
        let public_key = sk.public_key().to_string();
        self.owner
            .call(self.vault.id(), "add_agent")
            .args_json(json!({
                "public_key": public_key,
                "label": label,
                "daily_cap": daily_cap.map(|c| c.to_string()),
                "per_tx_cap": per_tx_cap.map(|c| c.to_string()),
                "allowance": allowance.map(|a| a.as_yoctonear().to_string()),
            }))
            .deposit(ONE_YOCTO)
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        let account = Account::from_secret_key(self.vault.id().clone(), sk, &self.worker);
        Ok(AgentHandle {
            label: label.into(),
            account,
            public_key,
        })
    }

    pub async fn chain_now_ms(&self) -> anyhow::Result<u64> {
        Ok(self.worker.view_block().await?.timestamp() / 1_000_000)
    }

    /// What the checker service would return, signed with the checker key.
    pub async fn verdict(
        &self,
        agent: &AgentHandle,
        recipient: &AccountId,
        amount: u128,
        verdict: Verdict,
        score: u8,
        reasons: &[&str],
    ) -> anyhow::Result<Value> {
        let expires_ms = self.chain_now_ms().await? + 120_000;
        Ok(self.verdict_with(
            agent, recipient, amount, verdict, score, reasons, expires_ms, None,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn verdict_with(
        &self,
        agent: &AgentHandle,
        recipient: &AccountId,
        amount: u128,
        verdict: Verdict,
        score: u8,
        reasons: &[&str],
        expires_ms: u64,
        nonce: Option<String>,
    ) -> Value {
        let nonce = nonce.unwrap_or_else(|| format!("t-{}", NONCE.fetch_add(1, Ordering::SeqCst)));
        let reasons: Vec<String> = reasons.iter().map(|s| s.to_string()).collect();
        let msg = verdict_message(
            &self.vault.id().as_str().parse().unwrap(),
            &agent.public_key.parse().unwrap(),
            &self.usdc.id().as_str().parse().unwrap(),
            U128(amount),
            &recipient.as_str().parse().unwrap(),
            verdict,
            score,
            &reasons,
            &nonce,
            expires_ms,
        );
        let sig = self.checker.sign(msg.as_bytes()).to_bytes().to_vec();
        json!({
            "verdict": verdict,
            "score": score,
            "reasons": reasons,
            "nonce": nonce,
            "expires_ms": expires_ms,
            "signature": Base64VecU8(sig),
        })
    }

    /// Agent calls request_spend with its function-call key.
    pub async fn spend(
        &self,
        agent: &AgentHandle,
        recipient: &AccountId,
        amount: u128,
        verdict: Value,
    ) -> anyhow::Result<ExecutionFinalResult> {
        Ok(agent
            .account
            .call(self.vault.id(), "request_spend")
            .args_json(json!({
                "token": self.usdc.id(),
                "amount": amount.to_string(),
                "recipient": recipient,
                "memo": "test",
                "verdict": verdict,
            }))
            .gas(near_workspaces::types::Gas::from_tgas(100))
            .transact()
            .await?)
    }

    /// Convenience: sign a verdict and spend, returning the decision log entry.
    pub async fn spend_with(
        &self,
        agent: &AgentHandle,
        recipient: &AccountId,
        amount: u128,
        verdict: Verdict,
        score: u8,
        reasons: &[&str],
    ) -> anyhow::Result<LogEntry> {
        let v = self
            .verdict(agent, recipient, amount, verdict, score, reasons)
            .await?;
        let res = self.spend(agent, recipient, amount, v).await?;
        Ok(res.into_result()?.json::<LogEntry>()?)
    }

    pub async fn owner_call(
        &self,
        method: &str,
        args: Value,
    ) -> anyhow::Result<ExecutionFinalResult> {
        Ok(self
            .owner
            .call(self.vault.id(), method)
            .args_json(args)
            .deposit(ONE_YOCTO)
            .max_gas()
            .transact()
            .await?)
    }

    pub async fn balance(&self, who: &AccountId) -> anyhow::Result<u128> {
        let v: String = self
            .usdc
            .view("ft_balance_of")
            .args_json(json!({ "account_id": who }))
            .await?
            .json()?;
        Ok(v.parse()?)
    }

    pub async fn log(&self) -> anyhow::Result<Vec<LogEntry>> {
        Ok(self
            .vault
            .view("get_log")
            .args_json(json!({ "limit": 100 }))
            .await?
            .json()?)
    }

    pub async fn view<T: near_sdk::serde::de::DeserializeOwned>(
        &self,
        method: &str,
        args: Value,
    ) -> anyhow::Result<T> {
        Ok(self.vault.view(method).args_json(args).await?.json()?)
    }

    /// Advance block time by at least `ms`, using sandbox fast-forward.
    pub async fn advance_ms(&self, ms: u64) -> anyhow::Result<()> {
        let start = self.chain_now_ms().await?;
        let target = start + ms;
        // Probe the per-block time step, then jump; repeat until the target is passed.
        self.worker.fast_forward(100).await?;
        let mut now = self.chain_now_ms().await?;
        let per_block = ((now - start) / 100).max(1);
        for _ in 0..8 {
            if now >= target {
                return Ok(());
            }
            let blocks = (target - now) / per_block;
            self.worker.fast_forward(blocks + blocks / 10 + 10).await?;
            now = self.chain_now_ms().await?;
        }
        anyhow::ensure!(now >= target, "fast_forward reached {now}, wanted {target}");
        Ok(())
    }
}

pub fn has(entry: &LogEntry, code: &str) -> bool {
    entry.reasons.iter().any(|r| r == code)
}

pub fn assert_outcome(entry: &LogEntry, outcome: Outcome) {
    assert_eq!(
        entry.outcome, outcome,
        "unexpected outcome, reasons: {:?}",
        entry.reasons
    );
}
