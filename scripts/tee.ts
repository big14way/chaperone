// pnpm tee <command>  -  the TEE-attested checker, end to end.
//
//   pnpm tee compose <image@sha256:...>  write deploy/tee/docker-compose.yml for that image digest
//   pnpm tee attest <checker-url>        fetch the enclave's attestation and fresh Intel collateral,
//                                        print what it measures and verify it locally (same checks
//                                        as the contract); writes .chaperone/tee/
//   pnpm tee policy [off]                owner: approve that container + OS image as the vault's
//                                        TEE policy (or turn TEE mode off)
//   pnpm tee register                    submit the attestation to register_checker (anyone may)
//   pnpm tee status                      the vault's TEE view
//
// Verification runs in Rust (crates/chaperone-tee) through the `attest` tool, so the local check and
// the on-chain check are the same code.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { Account } from "near-api-js";
import { DEFAULT_RPC, REPO_ROOT } from "../checker/src/config.ts";
import { ONE_YOCTO, TGAS, Vault, makeProvider } from "../agent/src/near.ts";
import { keyFor, loadDotEnv } from "./lib/context.ts";
import { banner, bold, dim, green, info, red, step } from "./lib/print.ts";

loadDotEnv();
const DIR = resolve(REPO_ROOT, ".chaperone/tee");
const ATTESTATION = resolve(DIR, "attestation.json");
const POLICY = resolve(DIR, "policy.json");
const COMPOSE = resolve(REPO_ROOT, "deploy/tee/docker-compose.yml");

interface TcbInfo {
  mrtd: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
  rtmr3: string;
  app_compose: string;
  event_log: { imr: number; event: string; event_payload: string }[];
}
interface Attestation {
  vault: string;
  public_key: string;
  report_data: string;
  quote: string;
  tcb_info: TcbInfo;
  app_id?: string;
  compose_hash?: string;
  generated_at?: string;
  checker_url?: string;
  collateral?: unknown;
  collateral_fetched_at?: string;
}

const vaultId = () => process.env.VAULT_ID || (() => { throw new Error("VAULT_ID missing in .env"); })();
const provider = () => makeProvider(process.env.NEAR_RPC_URL || DEFAULT_RPC.testnet);

function cargoAttest(args: string[]): string {
  return execFileSync("cargo", ["run", "-q", "-p", "attest", "--", ...args], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function rawKeyHex(publicKey: string): string {
  if (!publicKey.startsWith("ed25519:")) throw new Error(`not an ed25519 key: ${publicKey}`);
  return Buffer.from(bs58.decode(publicKey.slice(8))).toString("hex");
}

function load(): Attestation {
  if (!existsSync(ATTESTATION)) throw new Error("no attestation yet: run `pnpm tee attest <checker-url>` first");
  return JSON.parse(readFileSync(ATTESTATION, "utf8")) as Attestation;
}

/** The images the attested app-compose runs: what the owner is really approving. */
function imagesOf(appCompose: string): string[] {
  try {
    const c = JSON.parse(appCompose) as { docker_compose_file?: string };
    return [...(c.docker_compose_file ?? "").matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]!);
  } catch {
    return [];
  }
}

function policyFrom(a: Attestation) {
  const { mrtd, rtmr0, rtmr1, rtmr2, app_compose } = a.tcb_info;
  return {
    compose_hashes: [createHash("sha256").update(app_compose).digest("hex")],
    os: [{ mrtd, rtmr0, rtmr1, rtmr2 }],
    accepted_tcb_statuses: [] as string[],
  };
}

/** Fresh Intel DCAP collateral for the quote (Phala's PCCS), then the full check, locally. */
function collateralAndVerify(a: Attestation, policyPath: string): Attestation {
  mkdirSync(DIR, { recursive: true });
  const quoteFile = resolve(DIR, "quote.hex");
  writeFileSync(quoteFile, a.quote);
  step("fetching Intel collateral for the quote");
  const collateral = JSON.parse(cargoAttest(["collateral", quoteFile]));
  const withCollateral = { ...a, collateral, collateral_fetched_at: new Date().toISOString() };
  writeFileSync(ATTESTATION, JSON.stringify(withCollateral, null, 2));
  step("verifying locally (DCAP chain, report data, RTMR3 replay, compose hash, OS image)");
  const ok = JSON.parse(cargoAttest(["verify", ATTESTATION, policyPath, a.vault, rawKeyHex(a.public_key)])) as { tcb_status: string };
  info(green(`verified: TCB ${ok.tcb_status}`));
  return withCollateral;
}

function ownerAccount() {
  const ownerId = process.env.OWNER_ID;
  const key = ownerId && keyFor(ownerId, "OWNER_PRIVATE_KEY");
  if (!ownerId || !key) throw new Error("need OWNER_ID and the owner key (.env or ~/.near-credentials)");
  return new Account(ownerId, provider(), key);
}

async function status() {
  const vault = new Vault(provider(), vaultId());
  const [tee, vi] = await Promise.all([vault.view<Record<string, unknown>>("get_checker_tee"), vault.info()]);
  banner(`TEE status of ${vault.id}`);
  info(`TEE mode:          ${tee.enforced ? green("enforced") : dim("off (any checker key the owner set)")}`);
  info(`checker key:       ${vi.checker_pk}`);
  info(`checker attested:  ${tee.checker_attested ? green("yes") : tee.enforced ? red("no: verdicts are rejected") : dim("no")}`);
  if (tee.attested) info(`attestation:       ${JSON.stringify(tee.attested)}`);
  if (tee.policy) info(`policy:            ${JSON.stringify(tee.policy)}`);
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case "compose": {
    if (!arg || !/^[\w.\-/:]+@sha256:[0-9a-f]{64}$/.test(arg)) throw new Error("usage: pnpm tee compose <registry/image@sha256:<64 hex>> (pin by digest)");
    const vault = vaultId();
    const network = process.env.NEAR_NETWORK || "testnet";
    writeFileSync(
      COMPOSE,
      `# Chaperone checker in a dstack (Intel TDX) confidential VM, e.g. Phala Cloud.
# Generated by \`pnpm tee compose\`. The image is pinned by digest: this file is part of the
# app-compose hash the vault approves, so changing anything here needs a new owner approval.
services:
  checker:
    image: ${arg}
    restart: always
    ports:
      - "8787:8787"
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
    environment:
      VAULT_ID: ${vault}
      NEAR_NETWORK: ${network}
      PORT: "8787"
`,
    );
    step(`wrote ${COMPOSE}`);
    break;
  }
  case "attest": {
    if (!arg) throw new Error("usage: pnpm tee attest <checker-url>");
    const base = arg.replace(/\/+$/, "");
    banner(`attestation of ${base}`);
    const res = await fetch(`${base}/attestation`);
    if (!res.ok) throw new Error(`GET /attestation: HTTP ${res.status}`);
    const a = { ...((await res.json()) as Attestation), checker_url: base };
    if (a.vault !== vaultId()) throw new Error(`enclave is bound to ${a.vault}, not ${vaultId()}`);
    const p = policyFrom(a);
    info(`vault:        ${a.vault}`);
    info(`checker key:  ${a.public_key} (made inside the enclave)`);
    info(`images:       ${imagesOf(a.tcb_info.app_compose).join(", ") || "(none found)"}`);
    info(`compose hash: ${p.compose_hashes[0]}`);
    info(`OS (MRTD):    ${p.os[0]!.mrtd.slice(0, 32)}…`);
    mkdirSync(DIR, { recursive: true });
    writeFileSync(POLICY, JSON.stringify(p, null, 2));
    collateralAndVerify(a, POLICY);
    step(`wrote ${ATTESTATION} and ${POLICY}`);
    info("check the image digest above is the one built from this repo, then: pnpm tee policy && pnpm tee register");
    break;
  }
  case "policy": {
    const off = arg === "off";
    const p = off ? null : JSON.parse(readFileSync(POLICY, "utf8"));
    banner(off ? `turning TEE mode off on ${vaultId()}` : `approving the checker image for ${vaultId()}`);
    if (p) info(`compose ${p.compose_hashes.join(", ")}\n  os mrtd ${p.os.map((o: { mrtd: string }) => o.mrtd.slice(0, 32) + "…").join(", ")}`);
    const out = await ownerAccount().callFunctionRaw({ contractId: vaultId(), methodName: "set_checker_tee_policy", args: { policy: p }, deposit: ONE_YOCTO, gas: 50n * TGAS });
    info(`tx ${out.transaction_outcome.id}`);
    await status();
    break;
  }
  case "register": {
    let a = load();
    banner(`registering ${a.public_key} on ${vaultId()}`);
    // Collateral older than a day is refreshed; the contract checks it against block time.
    if (!a.collateral || Date.now() - Date.parse(a.collateral_fetched_at ?? "0") > 86_400_000) a = collateralAndVerify(a, POLICY);
    const args = { public_key: a.public_key, quote: a.quote, collateral: a.collateral, tcb_info: a.tcb_info };
    step(`register_checker (${(JSON.stringify(args).length / 1024).toFixed(0)} KB of attestation, verified on chain)`);
    const out = await ownerAccount().callFunctionRaw({ contractId: vaultId(), methodName: "register_checker", args, gas: 300n * TGAS });
    const burnt = out.receipts_outcome.reduce((s, r) => s + BigInt(r.outcome.gas_burnt), BigInt(out.transaction_outcome.outcome.gas_burnt));
    info(`tx ${out.transaction_outcome.id} (${(burnt / TGAS).toString()} Tgas)`);
    if (a.checker_url) info(`agents and the dashboard should now use CHECKER_URL=${a.checker_url}`);
    await status();
    break;
  }
  case "status":
    await status();
    break;
  default:
    console.log(bold("usage: pnpm tee compose <image@sha256:..> | attest <checker-url> | policy [off] | register | status"));
    process.exit(cmd ? 1 : 0);
}
