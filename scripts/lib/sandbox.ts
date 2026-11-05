// Dry-run world: a local NEAR sandbox with mock USDC, a funded vault, an owner, two agents,
// an allowlisted vendor with some history and a freshly created attacker account.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, type KeyPairString } from "near-api-js";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";
import { REPO_ROOT } from "../../checker/src/config.ts";
import { Rpc } from "../../checker/src/rpc.ts";
import type { Policy } from "../../checker/src/types.ts";
import { generateCheckerKey, type CheckerKey } from "../../checker/src/verdict.ts";
import { AgentKey, ONE_YOCTO, Owner, TGAS, Vault, toUnits } from "../../agent/src/near.ts";

export const DAY_MS = 86_400_000;

/** Newest of target/near (fresh `cargo near build`) and contracts/res (committed build). */
export function wasm(name: "chaperone" | "mock_ft"): Uint8Array {
  const candidates = [
    resolve(REPO_ROOT, `target/near/${name}/${name}.wasm`),
    resolve(REPO_ROOT, `contracts/res/${name}.wasm`),
  ].filter((p) => existsSync(p));
  if (candidates.length === 0) throw new Error(`no ${name}.wasm: run pnpm build:contracts`);
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return readFileSync(candidates[0]!);
}

export function demoPolicy(usdc: string, vendor: string): Policy {
  return {
    daily_cap: toUnits("100").toString(),
    per_tx_cap: toUnits("50").toString(),
    allow_recipients: [vendor],
    allow_tokens: [usdc],
    new_recipient_timelock_ms: DAY_MS,
    warn_requires_owner: true,
  };
}

async function waitForHeight(rpc: Rpc, height: number, timeoutMs = 120_000) {
  const t0 = Date.now();
  for (;;) {
    if ((await rpc.block()).height >= height) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`sandbox did not reach height ${height}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Advance sandbox block time by at least `ms` (needs a long epoch, see startDryWorld). Waits on
 * the *final* head: transactions reference a final block hash, and one from before the jump would
 * be outside the validity window.
 */
export async function fastForward(rpcUrl: string, ms: number) {
  const rpc = new Rpc(rpcUrl, "final");
  const start = await rpc.block();
  await rpc.call("sandbox_fast_forward", { delta_height: 100 });
  await waitForHeight(rpc, start.height + 100);
  let now = await rpc.block();
  const perBlock = Math.max(1, (now.timestampMs - start.timestampMs) / (now.height - start.height));
  for (let i = 0; i < 8 && now.timestampMs < start.timestampMs + ms; i++) {
    const blocks = Math.ceil((start.timestampMs + ms - now.timestampMs) / perBlock);
    const delta = blocks + Math.ceil(blocks / 10) + 10;
    await rpc.call("sandbox_fast_forward", { delta_height: delta });
    await waitForHeight(rpc, now.height + delta);
    now = await rpc.block();
  }
  await waitForHeight(rpc, now.height + 2);
}

export interface DryWorld {
  sandbox: Sandbox;
  rpcUrl: string;
  provider: JsonRpcProvider;
  vault: Vault;
  owner: Owner;
  usdc: string;
  vendor: string;
  attacker: string;
  buyer: AgentKey;
  researcher: AgentKey;
  checkerKey: CheckerKey;
  stop(): Promise<void>;
}

export async function startDryWorld(log: (s: string) => void = () => {}): Promise<DryWorld> {
  log("starting local NEAR sandbox (first run downloads the node binary, ~80 MB)");
  // A long epoch lets sandbox_fast_forward jump days in one step.
  const sandbox = await Sandbox.start({ config: { additionalGenesis: { epoch_length: 500_000 } } });
  try {
    const rpcUrl = sandbox.rpcUrl;
    const provider = new JsonRpcProvider({ url: rpcUrl });
    const root = new Account(DEFAULT_ACCOUNT_ID, provider, DEFAULT_PRIVATE_KEY as KeyPairString);

    const create = async (name: string, near: `${number}`) => {
      const kp = KeyPair.fromRandom("ed25519");
      const id = `${name}.${DEFAULT_ACCOUNT_ID}`;
      await root.createAccount({ newAccountId: id, publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto(near) });
      return new Account(id, provider, kp.toString());
    };

    log("creating accounts: owner, vault, usdc, vendor");
    const [ownerAcc, vaultAcc, usdcAcc, vendorAcc] = await Promise.all([
      create("owner", "50"),
      create("vault", "30"),
      create("usdc", "20"),
      create("vendor", "5"),
    ]);

    log("deploying mock USDC (NEP-141, 6 decimals) and the Chaperone vault");
    await usdcAcc.signAndSendTransaction({
      receiverId: usdcAcc.accountId,
      actions: [
        actions.deployContract(wasm("mock_ft")),
        actions.functionCall(
          "new",
          { owner_id: ownerAcc.accountId, total_supply: toUnits("1000000").toString(), symbol: "USDC" },
          100n * TGAS,
          0n,
        ),
      ],
    });
    const checkerKey = generateCheckerKey();
    await vaultAcc.signAndSendTransaction({
      receiverId: vaultAcc.accountId,
      actions: [
        actions.deployContract(wasm("chaperone")),
        actions.functionCall(
          "new",
          {
            owner: ownerAcc.accountId,
            checker_pk: checkerKey.publicKey,
            policy: demoPolicy(usdcAcc.accountId, vendorAcc.accountId),
          },
          100n * TGAS,
          0n,
        ),
      ],
    });

    log("registering vault and vendor with the token, funding the vault with 1,000 USDC");
    for (const who of [vaultAcc.accountId, vendorAcc.accountId]) {
      await ownerAcc.callFunction({
        contractId: usdcAcc.accountId,
        methodName: "storage_deposit",
        args: { account_id: who, registration_only: true },
        deposit: nearToYocto("0.01"),
        gas: 30n * TGAS,
      });
    }
    await ownerAcc.callFunction({
      contractId: usdcAcc.accountId,
      methodName: "ft_transfer_call",
      args: { receiver_id: vaultAcc.accountId, amount: toUnits("1000").toString(), msg: "fund" },
      deposit: ONE_YOCTO,
      gas: 100n * TGAS,
    });

    // Give the vendor some history: a few transactions, then let three days pass.
    for (let i = 0; i < 3; i++) {
      await vendorAcc.transfer({ receiverId: ownerAcc.accountId, amount: nearToYocto("0.01") });
    }
    log("fast-forwarding the chain three days so the vendor has an established account");
    await fastForward(rpcUrl, 3 * DAY_MS);

    log("creating a brand-new attacker account");
    const attackerAcc = await create("attacker", "2");
    await ownerAcc.callFunction({
      contractId: usdcAcc.accountId,
      methodName: "storage_deposit",
      args: { account_id: attackerAcc.accountId, registration_only: true },
      deposit: nearToYocto("0.01"),
      gas: 30n * TGAS,
    });

    const vault = new Vault(provider, vaultAcc.accountId);
    const owner = new Owner(ownerAcc, vault);
    log("owner adds two agents (function-call keys the vault adds to itself)");
    const buyerKey = KeyPair.fromRandom("ed25519");
    const researcherKey = KeyPair.fromRandom("ed25519");
    await owner.addAgent(buyerKey.getPublicKey().toString(), "buyer");
    await owner.addAgent(researcherKey.getPublicKey().toString(), "researcher", {
      dailyCap: toUnits("5"),
      perTxCap: toUnits("2"),
    });

    return {
      sandbox,
      rpcUrl,
      provider,
      vault,
      owner,
      usdc: usdcAcc.accountId,
      vendor: vendorAcc.accountId,
      attacker: attackerAcc.accountId,
      buyer: new AgentKey(vault, "buyer", buyerKey.toString()),
      researcher: new AgentKey(vault, "researcher", researcherKey.toString()),
      checkerKey,
      stop: () => sandbox.tearDown(),
    };
  } catch (e) {
    await sandbox.tearDown().catch(() => {});
    throw e;
  }
}
