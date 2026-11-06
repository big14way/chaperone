// pnpm upgrade:testnet  -  replace the vault's code through the owner (update_contract, 1 yoctoNEAR).
// The vault account has no full-access key, so this is the only upgrade path. State is kept.
// Builds first with `pnpm build:contracts`; reads contracts/res/chaperone.wasm.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Account } from "near-api-js";
import { DEFAULT_RPC, REPO_ROOT } from "../checker/src/config.ts";
import { ONE_YOCTO, TGAS, Vault, makeProvider } from "../agent/src/near.ts";
import { keyFor, loadDotEnv } from "./lib/context.ts";
import { banner, info, step } from "./lib/print.ts";

loadDotEnv();
const vaultId = process.env.VAULT_ID!;
const ownerId = process.env.OWNER_ID!;
const key = keyFor(ownerId, "OWNER_PRIVATE_KEY");
if (!vaultId || !ownerId || !key) throw new Error("need VAULT_ID, OWNER_ID and the owner key (.env or ~/.near-credentials)");
const provider = makeProvider(process.env.NEAR_RPC_URL || DEFAULT_RPC.testnet);
const code = readFileSync(resolve(REPO_ROOT, "contracts/res/chaperone.wasm"));
banner(`upgrading ${vaultId} through its owner`);
const before = await new Vault(provider, vaultId).info();
step(`new code: ${code.length} bytes, sha256 ${createHash("sha256").update(code).digest("hex").slice(0, 16)}…`);
const owner = new Account(ownerId, provider, key);
const out = await owner.callFunctionRaw({ contractId: vaultId, methodName: "update_contract", args: new Uint8Array(code), deposit: ONE_YOCTO, gas: 300n * TGAS });
info(`tx ${out.transaction_outcome.id}`);
const after = await new Vault(provider, vaultId).info();
if (after.log_len !== before.log_len || after.agents !== before.agents) throw new Error("state changed unexpectedly");
step(`done: state kept (agents ${after.agents}, log ${after.log_len}, pending ${after.pending})`);
