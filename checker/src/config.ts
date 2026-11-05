// Checker configuration from environment variables (see .env.example).
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

export type Network = "sandbox" | "testnet" | "mainnet";

export interface CheckerConfig {
  network: Network;
  rpcUrl: string;
  vault: string;
  checkerSecretKey: string;
  blocklistPath: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  nearblocksApiKey?: string;
  nearblocksUrl?: string;
  codeCachePath?: string;
  verdictTtlMs: number;
  host: string;
  port: number;
}

export const DEFAULT_RPC: Record<Network, string> = {
  sandbox: "http://127.0.0.1:3030",
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
};

function need(name: string, env: NodeJS.ProcessEnv): string {
  const v = env[name];
  if (!v) throw new Error(`missing env ${name} (see .env.example)`);
  return v;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): CheckerConfig {
  const network = (env.NEAR_NETWORK || "testnet") as Network;
  return {
    network,
    rpcUrl: env.NEAR_RPC_URL || DEFAULT_RPC[network],
    vault: need("VAULT_ID", env),
    checkerSecretKey: need("CHECKER_SECRET_KEY", env),
    blocklistPath: resolve(REPO_ROOT, env.BLOCKLIST_PATH || "fixtures/blocklist.json"),
    supabaseUrl: env.SUPABASE_URL || undefined,
    supabaseAnonKey: env.SUPABASE_ANON_KEY || undefined,
    nearblocksApiKey: env.NEARBLOCKS_API_KEY || undefined,
    nearblocksUrl: env.NEARBLOCKS_API_URL || undefined,
    codeCachePath: resolve(REPO_ROOT, env.CODE_CACHE_PATH || `.chaperone/code-hashes.${network}.json`),
    verdictTtlMs: Number(env.VERDICT_TTL_MS || 120_000),
    host: env.CHECKER_HOST || "127.0.0.1",
    port: Number(env.PORT || env.CHECKER_PORT || 8787),
  };
}
