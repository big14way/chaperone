import { describe, expect, it } from "vitest";
import { fileBlocklist } from "../src/blocklist.ts";
import { CodeCache } from "../src/codecache.ts";
import { DAY_MS } from "../src/score.ts";
import { collectSignals, keyNonceHistory } from "../src/signals.ts";
import { account, entry, fakeRpc, type FakeChain } from "./fake-rpc.ts";

const USDC = 1_000_000n;
const NOW = 1_800_000_000_000;

function chain(): FakeChain {
  return {
    height: 10_000,
    nowMs: NOW,
    blocks: new Map([
      [2_000, NOW - 3 * DAY_MS],
      [9_990, NOW - 60_000],
      [9_000, NOW - 1_000_000],
    ]),
    accounts: new Map([
      ["vendor.testnet", account()],
      ["attacker.testnet", account()],
    ]),
    keys: new Map([
      // created at height 2000, 7 transactions signed since
      ["vendor.testnet", [{ public_key: "ed25519:v", access_key: { nonce: 2_000 * 1_000_000 + 7, permission: "FullAccess" } }]],
      // created 10 blocks ago, never used
      ["attacker.testnet", [{ public_key: "ed25519:a", access_key: { nonce: 9_990 * 1_000_000, permission: "FullAccess" } }]],
    ]),
    policy: {
      daily_cap: (100n * USDC).toString(),
      per_tx_cap: (50n * USDC).toString(),
      allow_recipients: ["vendor.testnet"],
      allow_tokens: ["usdc.testnet"],
      new_recipient_timelock_ms: DAY_MS,
      warn_requires_owner: true,
    },
    log: [],
  };
}

describe("key-nonce account history", () => {
  it("dates the account and counts its transactions from access key nonces", async () => {
    const c = chain();
    const h = await keyNonceHistory(fakeRpc(c), "vendor.testnet", { height: c.height, timestampMs: c.nowMs });
    expect(h).toEqual({ ageMs: 3 * DAY_MS, txCount: 7 });
  });

  it("estimates the age from the block rate when the creation block is gone", async () => {
    const c = chain();
    c.blocks.delete(2_000);
    const h = await keyNonceHistory(fakeRpc(c), "vendor.testnet", { height: c.height, timestampMs: c.nowMs });
    // 1000 blocks per 1,000,000 ms -> 1000 ms per block; 8000 blocks back
    expect(h.ageMs).toBe(8_000_000);
  });
});

describe("collectSignals", () => {
  const deps = (c: FakeChain) => ({
    rpc: fakeRpc(c),
    vault: "vault.testnet",
    blocklist: fileBlocklist("/nonexistent.json"),
    codeCache: new CodeCache(),
  });

  it("reads policy, history and the 7-day mean from the vault log", async () => {
    const c = chain();
    c.log = [
      entry({ seq: 0, agent_pk: "ed25519:buyer", amount: (20n * USDC).toString(), ts_ms: NOW - DAY_MS }),
      entry({ seq: 1, agent_pk: "ed25519:buyer", amount: (30n * USDC).toString(), ts_ms: NOW - 2 * DAY_MS }),
      entry({ seq: 2, agent_pk: "ed25519:buyer", amount: (900n * USDC).toString(), ts_ms: NOW - 9 * DAY_MS }),
      entry({ seq: 3, agent_pk: "ed25519:other", amount: (5n * USDC).toString(), ts_ms: NOW - DAY_MS }),
      entry({ seq: 4, recipient: "attacker.testnet", outcome: "block", risk: "block", transfer: null }),
    ];
    const s = await collectSignals(deps(c), {
      agent: "ed25519:buyer",
      token: "usdc.testnet",
      amount: 45n * USDC,
      recipient: "vendor.testnet",
    });
    expect(s.allowlisted).toBe(true);
    expect(s.priorSettled).toBe(4);
    expect(s.mean7d).toBe(25n * USDC);
    expect(s.ageSource).toBe("key-nonce");
    expect(s.dailyCap).toBe(100n * USDC);

    const a = await collectSignals(deps(c), {
      agent: "ed25519:buyer",
      token: "usdc.testnet",
      amount: 500n * USDC,
      recipient: "attacker.testnet",
    });
    expect(a.allowlisted).toBe(false);
    expect(a.priorBlocked).toBe(1);
    expect(a.ageMs).toBe(60_000);
    expect(a.txCount).toBe(0);
  });

  it("flags a code hash change, and code on a day-old account", async () => {
    const c = chain();
    const d = deps(c);
    c.accounts.set("vendor.testnet", account("hashA"));
    const q = { agent: "ed25519:buyer", token: "usdc.testnet", amount: USDC, recipient: "vendor.testnet" };
    expect((await collectSignals(d, q)).codeChangedAgoMs).toBeNull();
    c.accounts.set("vendor.testnet", account("hashB"));
    c.nowMs += 1_000;
    expect((await collectSignals(d, q)).codeChangedAgoMs).toBe(0);

    c.accounts.set("attacker.testnet", account("hashC"));
    const fresh = await collectSignals(d, { ...q, recipient: "attacker.testnet" });
    expect(fresh.isContract).toBe(true);
    expect(fresh.codeChangedAgoMs).toBeLessThan(DAY_MS);
  });

  it("reports a missing account", async () => {
    const s = await collectSignals(deps(chain()), {
      agent: "ed25519:buyer",
      token: "usdc.testnet",
      amount: USDC,
      recipient: "ghost.testnet",
    });
    expect(s.exists).toBe(false);
  });
});
