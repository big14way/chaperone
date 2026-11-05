// pnpm setup:testnet  -  after scripts/deploy-testnet.sh: register token storage, fund the vault,
// add the buyer and researcher agents, and record the deployment in deployments/testnet.json.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, KeyPair, nearToYocto, type KeyPairString } from "near-api-js";
import { DEFAULT_RPC, REPO_ROOT } from "../checker/src/config.ts";
import { AgentKey, ONE_YOCTO, Owner, TGAS, Vault, makeProvider, toUnits } from "../agent/src/near.ts";
import { TESTNET_USDC, keyFor, loadDotEnv } from "./lib/context.ts";
import { banner, info, step } from "./lib/print.ts";

loadDotEnv();
const need = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`missing ${n} in .env (see .env.example)`);
  return v;
};

const rpcUrl = process.env.NEAR_RPC_URL || DEFAULT_RPC.testnet;
const provider = makeProvider(rpcUrl);
const vaultId = need("VAULT_ID");
const ownerId = need("OWNER_ID");
const ownerKey = keyFor(ownerId, "OWNER_PRIVATE_KEY");
if (!ownerKey) throw new Error(`no key for ${ownerId}: set OWNER_PRIVATE_KEY or create it with the legacy keychain`);
const usdc = process.env.USDC_ID || TESTNET_USDC;
const ownerAcc = new Account(ownerId, provider, ownerKey);
const vault = new Vault(provider, vaultId);
const owner = new Owner(ownerAcc, vault);

banner(`setting up ${vaultId} on testnet`);
const infoView = await vault.info();
if (infoView.owner !== ownerId) throw new Error(`vault owner is ${infoView.owner}, not ${ownerId}`);
info(`vault initialised; checker key ${infoView.checker_pk}`);

step("register token storage for the vault and the demo recipients");
const bounds = (await provider.callFunction({ contractId: usdc, method: "storage_balance_bounds", args: {} })) as { min: string };
for (const who of [vaultId, process.env.VENDOR_ID, process.env.ATTACKER_ID].filter(Boolean) as string[]) {
  const bal = await provider.callFunction({ contractId: usdc, method: "storage_balance_of", args: { account_id: who } });
  if (bal) {
    info(`${who}: already registered`);
    continue;
  }
  await ownerAcc.callFunction({
    contractId: usdc,
    methodName: "storage_deposit",
    args: { account_id: who, registration_only: true },
    deposit: BigInt(bounds.min || nearToYocto("0.00125")),
    gas: 30n * TGAS,
  });
  info(`${who}: registered`);
}

const fund = process.env.FUND_USDC || "0";
if (fund !== "0") {
  step(`fund the vault with ${fund} USDC from ${ownerId} (ft_transfer_call)`);
  await ownerAcc.callFunction({
    contractId: usdc,
    methodName: "ft_transfer_call",
    args: { receiver_id: vaultId, amount: toUnits(fund).toString(), msg: "fund" },
    deposit: ONE_YOCTO,
    gas: 100n * TGAS,
  });
}

step("add agents (the vault adds each function-call key to itself)");
const existing = new Set((await vault.agents()).map((a) => a.public_key));
const agents: Array<{ label: string; envName: string; caps: { dailyCap?: bigint; perTxCap?: bigint } }> = [
  { label: "buyer", envName: "AGENT_BUYER_PRIVATE_KEY", caps: {} },
  { label: "researcher", envName: "AGENT_RESEARCHER_PRIVATE_KEY", caps: { dailyCap: toUnits("5"), perTxCap: toUnits("2") } },
];
const secrets: string[] = [];
const publicAgents: Array<{ label: string; public_key: string }> = [];
for (const a of agents) {
  const sk = (process.env[a.envName] as KeyPairString | undefined) || KeyPair.fromRandom("ed25519").toString();
  const key = new AgentKey(vault, a.label, sk);
  if (!existing.has(key.publicKey)) {
    await owner.addAgent(key.publicKey, a.label, a.caps);
    info(`${a.label}: added ${key.publicKey}`);
  } else {
    info(`${a.label}: already registered`);
  }
  secrets.push(`${a.envName}=${sk}`);
  publicAgents.push({ label: a.label, public_key: key.publicKey });
}

mkdirSync(resolve(REPO_ROOT, ".chaperone"), { recursive: true });
const secretFile = resolve(REPO_ROOT, ".chaperone/testnet-agents.env");
writeFileSync(secretFile, `${secrets.join("\n")}\n`);
chmodSync(secretFile, 0o600);
mkdirSync(resolve(REPO_ROOT, "deployments"), { recursive: true });
const record = {
  network: "testnet",
  vault: vaultId,
  owner: ownerId,
  token: usdc,
  checker_pk: infoView.checker_pk,
  agents: publicAgents,
  policy: await vault.policy(),
  recorded_at: new Date().toISOString(),
};
writeFileSync(resolve(REPO_ROOT, "deployments/testnet.json"), `${JSON.stringify(record, null, 2)}\n`);
step("done");
info(`agent private keys written to .chaperone/testnet-agents.env (gitignored): copy them into .env`);
info(`public deployment record: deployments/testnet.json`);
