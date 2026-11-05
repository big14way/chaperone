// Where the demos run: the local sandbox (default, no keys needed) or testnet (from .env).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { Account, type KeyPairString } from "near-api-js";
import { DEFAULT_RPC, REPO_ROOT, type CheckerConfig } from "../../checker/src/config.ts";
import { buildServer, createChecker } from "../../checker/src/server.ts";
import { AgentKey, Owner, Vault, makeProvider } from "../../agent/src/near.ts";
import type { ToolContext } from "../../agent/src/tools.ts";
import { startDryWorld } from "./sandbox.ts";
import { dim, info } from "./print.ts";

/** Circle USDC on NEAR testnet (6 decimals). */
export const TESTNET_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

export interface DemoContext {
  network: "sandbox" | "testnet";
  rpcUrl: string;
  vault: Vault;
  owner?: Owner;
  usdc: string;
  vendor: string;
  attacker: string;
  buyer: AgentKey;
  researcher?: AgentKey;
  checkerUrl: string;
  explorer(txHash: string): string;
  ftBalance(accountId: string): Promise<bigint>;
  toolContext(agent: AgentKey, onEvent?: ToolContext["onEvent"]): ToolContext;
  close(): Promise<void>;
}

export function loadDotEnv() {
  try {
    process.loadEnvFile(resolve(REPO_ROOT, ".env"));
  } catch {
    // optional
  }
}

/** Private key from env, or from the legacy NEAR CLI keychain (~/.near-credentials). */
export function keyFor(accountId: string, envName: string, network = "testnet"): KeyPairString | undefined {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv as KeyPairString;
  const file = join(homedir(), ".near-credentials", network, `${accountId}.json`);
  if (existsSync(file)) return (JSON.parse(readFileSync(file, "utf8")) as { private_key: KeyPairString }).private_key;
  return undefined;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} in .env (see .env.example), or run with CHAPERONE_DRY_RUN=1`);
  return v;
}

async function startChecker(config: CheckerConfig): Promise<{ url: string; close: () => Promise<void> }> {
  const app = buildServer(createChecker(config));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => app.close() };
}

function finish(
  base: Omit<DemoContext, "ftBalance" | "toolContext" | "explorer">,
  explorer: (h: string) => string,
): DemoContext {
  return {
    ...base,
    explorer,
    async ftBalance(accountId: string) {
      const v = await base.vault.provider.callFunction({
        contractId: base.usdc,
        method: "ft_balance_of",
        args: { account_id: accountId },
      });
      return BigInt(v as string);
    },
    toolContext(agent, onEvent) {
      return {
        agent,
        token: base.usdc,
        checkerUrl: base.checkerUrl,
        pageVars: { VENDOR: base.vendor, ATTACKER: base.attacker },
        onEvent,
      };
    },
  };
}

export async function openContext(log: (s: string) => void = (s) => info(dim(s))): Promise<DemoContext> {
  loadDotEnv();
  const testnet = process.env.NEAR_NETWORK === "testnet" && process.env.CHAPERONE_DRY_RUN !== "1";
  if (!testnet) {
    const world = await startDryWorld(log);
    const checker = await startChecker({
      network: "sandbox",
      rpcUrl: world.rpcUrl,
      vault: world.vault.id,
      checkerSecretKey: world.checkerKey.secretKey,
      blocklistPath: resolve(REPO_ROOT, "fixtures/blocklist.json"),
      verdictTtlMs: 120_000,
      host: "127.0.0.1",
      port: 0,
    });
    log(`checker running at ${checker.url} with key ${world.checkerKey.publicKey}`);
    return finish(
      {
        network: "sandbox",
        rpcUrl: world.rpcUrl,
        vault: world.vault,
        owner: world.owner,
        usdc: world.usdc,
        vendor: world.vendor,
        attacker: world.attacker,
        buyer: world.buyer,
        researcher: world.researcher,
        checkerUrl: checker.url,
        async close() {
          await checker.close();
          await world.stop();
        },
      },
      (h) => `sandbox tx ${h}`,
    );
  }

  const rpcUrl = process.env.NEAR_RPC_URL || DEFAULT_RPC.testnet;
  const provider = makeProvider(rpcUrl);
  const vault = new Vault(provider, need("VAULT_ID"));
  const ownerId = process.env.OWNER_ID;
  const ownerKey = ownerId ? keyFor(ownerId, "OWNER_PRIVATE_KEY") : undefined;
  const researcherKey = process.env.AGENT_RESEARCHER_PRIVATE_KEY as KeyPairString | undefined;
  let checkerUrl = process.env.CHECKER_URL;
  let stopChecker = async () => {};
  if (!checkerUrl) {
    const c = await startChecker({
      network: "testnet",
      rpcUrl,
      vault: vault.id,
      checkerSecretKey: need("CHECKER_SECRET_KEY"),
      blocklistPath: resolve(REPO_ROOT, process.env.BLOCKLIST_PATH || "fixtures/blocklist.json"),
      supabaseUrl: process.env.SUPABASE_URL || undefined,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || undefined,
      nearblocksApiKey: process.env.NEARBLOCKS_API_KEY || undefined,
      codeCachePath: resolve(REPO_ROOT, ".chaperone/code-hashes.testnet.json"),
      verdictTtlMs: Number(process.env.VERDICT_TTL_MS || 120_000),
      host: "127.0.0.1",
      port: 0,
    });
    checkerUrl = c.url;
    stopChecker = c.close;
  }
  return finish(
    {
      network: "testnet",
      rpcUrl,
      vault,
      owner: ownerId && ownerKey ? new Owner(new Account(ownerId, provider, ownerKey), vault) : undefined,
      usdc: process.env.USDC_ID || TESTNET_USDC,
      vendor: need("VENDOR_ID"),
      attacker: need("ATTACKER_ID"),
      buyer: new AgentKey(vault, "buyer", need("AGENT_BUYER_PRIVATE_KEY") as KeyPairString),
      researcher: researcherKey ? new AgentKey(vault, "researcher", researcherKey) : undefined,
      checkerUrl,
      close: stopChecker,
    },
    (h) => `https://testnet.nearblocks.io/txns/${h}`,
  );
}

/** Run a demo function standalone with its own context. */
export async function runStandalone(fn: (ctx: DemoContext) => Promise<boolean>) {
  let ctx: DemoContext | undefined;
  let ok = false;
  try {
    ctx = await openContext();
    ok = await fn(ctx);
  } catch (e) {
    console.error(e);
  } finally {
    await ctx?.close().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
}
