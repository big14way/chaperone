// Defaults are the recorded testnet deployment (deployments/testnet.json). Override with NEXT_PUBLIC_*.
export type NetworkId = "testnet" | "mainnet";

export const NETWORK: NetworkId = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const VAULT_ID = process.env.NEXT_PUBLIC_VAULT_ID || "chaperone.testnet";
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  (NETWORK === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");

/** Circle USDC contract ids; anything else is shown by account id. */
export const KNOWN_TOKENS: Record<string, string> = {
  "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af": "USDC",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "USDC",
};

export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
export const explorerAccount = (id: string) => `${EXPLORER}/address/${id}`;
export const explorerTx = (hash: string) => `${EXPLORER}/txns/${hash}`;

/** Owner calls: 1 yoctoNEAR proves a full-access key; 150 Tgas covers approve's ft_transfer + callback. */
export const OWNER_GAS = 150_000_000_000_000n;
export const ONE_YOCTO = 1n;
