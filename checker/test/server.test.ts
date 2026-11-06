import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/config.ts";
import { buildServer, createChecker } from "../src/server.ts";
import { DAY_MS } from "../src/score.ts";
import { generateCheckerKey, verifyVerdict } from "../src/verdict.ts";
import { account, fakeRpc, type FakeChain } from "./fake-rpc.ts";

const NOW = 1_800_000_000_000;
const AGENT = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";

function setup() {
  const c: FakeChain = {
    height: 10_000,
    nowMs: NOW,
    blocks: new Map([[9_999, NOW - 1_000]]),
    accounts: new Map([["attacker.sandbox", account()]]),
    keys: new Map([["attacker.sandbox", [{ public_key: "ed25519:a", access_key: { nonce: 9_999_000_000, permission: "FullAccess" } }]]]),
    policy: {
      daily_cap: "100000000",
      per_tx_cap: "50000000",
      allow_recipients: ["vendor.sandbox"],
      allow_tokens: ["usdc.sandbox"],
      new_recipient_timelock_ms: DAY_MS,
      warn_requires_owner: true,
    },
    log: [],
  };
  const key = generateCheckerKey();
  const checker = createChecker(
    {
      network: "sandbox",
      rpcUrl: "fake://",
      vault: "vault.sandbox",
      checkerSecretKey: key.secretKey,
      blocklistPath: resolve(REPO_ROOT, "fixtures/blocklist.json"),
      verdictTtlMs: 120_000,
      host: "127.0.0.1",
      port: 0,
    },
    { rpc: fakeRpc(c) },
  );
  return { app: buildServer(checker), key };
}

describe("POST /verdict", () => {
  it("returns a signed BLOCK for the blocklisted attacker", async () => {
    const { app, key } = setup();
    const body = { agent: AGENT, token: "usdc.sandbox", amount: "500000000", recipient: "attacker.sandbox" };
    const res = await app.inject({ method: "POST", url: "/verdict", payload: body });
    expect(res.statusCode).toBe(200);
    const v = res.json();
    expect(v.verdict).toBe("block");
    expect(v.reasons).toContain("BLOCKLISTED");
    expect(v.expires_ms).toBe(NOW + 120_000);
    expect(v.checker_pk).toBe(key.publicKey);
    const ok = verifyVerdict(
      key.publicKey,
      { vault: "vault.sandbox", ...body, verdict: v.verdict, score: v.score, reasons: v.reasons, nonce: v.nonce, expires_ms: v.expires_ms },
      v.signature,
    );
    expect(ok).toBe(true);
  });

  it("rejects malformed requests", async () => {
    const { app } = setup();
    const bad = [
      { agent: "nope", token: "usdc.sandbox", amount: "1", recipient: "vendor.sandbox" },
      { agent: AGENT, token: "usdc.sandbox", amount: "-1", recipient: "vendor.sandbox" },
      { agent: AGENT, token: "usdc.sandbox", amount: "1", recipient: "Bad Account" },
      { agent: AGENT, token: "usdc.sandbox", amount: "1" },
    ];
    for (const payload of bad) {
      const res = await app.inject({ method: "POST", url: "/verdict", payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it("serves /health with the checker public key", async () => {
    const { app, key } = setup();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toMatchObject({ ok: true, vault: "vault.sandbox", checker_pk: key.publicKey });
    expect(typeof res.json().blocklist).toBe("string");
  });
});
