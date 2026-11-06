// pnpm lock:testnet  -  delete the vault account's own full-access key(s), after checking that the owner
// upgrade path (update_contract) is in the deployed code. Afterwards the vault holds only agent
// function-call keys, and code changes go through `pnpm upgrade:testnet`. Irreversible: run once, on purpose.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { Account } from "near-api-js";
import { DEFAULT_RPC } from "../checker/src/config.ts";
import { makeProvider } from "../agent/src/near.ts";
import { loadDotEnv } from "./lib/context.ts";
import { banner, info, step } from "./lib/print.ts";

loadDotEnv();
if (process.env.CONFIRM_LOCK !== "yes") throw new Error("irreversible: set CONFIRM_LOCK=yes to delete the vault's full-access key");
const vaultId = process.env.VAULT_ID!;
const file = `${homedir()}/.near-credentials/testnet/${vaultId}.json`;
if (!existsSync(file)) throw new Error(`no deployer key at ${file}`);
const cred = JSON.parse(readFileSync(file, "utf8")) as { public_key: string; private_key: `ed25519:${string}` };
const provider = makeProvider(process.env.NEAR_RPC_URL || DEFAULT_RPC.testnet);
banner(`locking ${vaultId}`);
// Refuse if the deployed code cannot be upgraded by the owner (it would be frozen forever).
const code = await provider.viewContractCode({ contractId: vaultId });
if (!Buffer.from(code.code_base64, "base64").includes(Buffer.from("update_contract"))) throw new Error("deployed code has no update_contract; deploy it first");
const res = await new Account(vaultId, provider, cred.private_key).deleteKey(cred.public_key);
step(`deleted ${cred.public_key}`);
info(`tx ${res.transaction_outcome.id}`);
