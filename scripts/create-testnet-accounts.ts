// pnpm accounts:testnet  -  create the demo accounts on NEAR testnet through the public faucet helper
// (free, no wallet needed). Keys go to the legacy NEAR CLI keychain, ~/.near-credentials/testnet/,
// which deploy-testnet.sh and setup-testnet.ts read. Existing accounts are left alone.
//
//   pnpm accounts:testnet                       # chaperone, chaperone-owner, chaperone-vendor, chaperone-attacker
//   ACCOUNT_PREFIX=myvault pnpm accounts:testnet  # myvault, myvault-owner, ...
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { DEFAULT_RPC } from "../checker/src/config.ts";
import { banner, info, step } from "./lib/print.ts";

const HELPER = process.env.NEAR_HELPER_URL || "https://helper.nearprotocol.com/account";
const RPC = process.env.NEAR_RPC_URL || DEFAULT_RPC.testnet;
const prefix = process.env.ACCOUNT_PREFIX || "chaperone";
const roles: Array<[string, string]> = [
  ["VAULT_ID", `${prefix}.testnet`],
  ["OWNER_ID", `${prefix}-owner.testnet`],
  ["VENDOR_ID", `${prefix}-vendor.testnet`],
  ["ATTACKER_ID", `${prefix}-attacker.testnet`],
];
const keyDir = join(homedir(), ".near-credentials", "testnet");

async function exists(accountId: string): Promise<boolean> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "view_account", finality: "final", account_id: accountId },
    }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { cause?: { name?: string } } };
  if (body.result) return true;
  if (body.error?.cause?.name === "UNKNOWN_ACCOUNT") return false;
  throw new Error(`view_account ${accountId}: ${JSON.stringify(body.error)}`);
}

banner("creating testnet accounts via the faucet helper");
mkdirSync(keyDir, { recursive: true });
for (const [envName, accountId] of roles) {
  const keyFile = join(keyDir, `${accountId}.json`);
  if (await exists(accountId)) {
    info(`${accountId}: exists${existsSync(keyFile) ? " (key in keychain)" : " (NO local key: pick another ACCOUNT_PREFIX)"}`);
    continue;
  }
  step(`create ${accountId}`);
  const kp = KeyPair.fromRandom("ed25519");
  const publicKey = kp.getPublicKey().toString();
  const res = await fetch(HELPER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  if (!res.ok) throw new Error(`faucet helper ${res.status}: ${(await res.text()).slice(0, 300)}`);
  writeFileSync(keyFile, JSON.stringify({ account_id: accountId, public_key: publicKey, private_key: kp.toString() }));
  chmodSync(keyFile, 0o600);
  info(`${accountId}: created, key saved to ${keyFile}`);
}

step("add these to .env");
for (const [envName, accountId] of roles) console.log(`${envName}=${accountId}`);
