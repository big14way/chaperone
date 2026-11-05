import { createPublicKey, verify } from "node:crypto";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { checkerKeyFromSecret, generateCheckerKey, signVerdict, verdictMessage, verifyVerdict } from "../src/verdict.ts";

const FIELDS = {
  vault: "vault.test.near",
  agent: "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp",
  token: "usdc.test.near",
  amount: "25000000",
  recipient: "vendor.test.near",
  verdict: "allow" as const,
  score: 12,
  reasons: ["ALLOWLISTED", "KNOWN_COUNTERPARTY"],
  nonce: "n-1",
  expires_ms: 1_700_000_000_000,
};

describe("verdict message", () => {
  it("matches the contract's verdict_message byte for byte", () => {
    // Same literal as `verdict_message_is_stable` in contracts/chaperone/src/lib.rs.
    expect(verdictMessage(FIELDS)).toBe(
      "chaperone-verdict:v1\nvault=vault.test.near\nagent=ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp\ntoken=usdc.test.near\namount=25000000\nrecipient=vendor.test.near\nverdict=allow\nscore=12\nreasons=ALLOWLISTED,KNOWN_COUNTERPARTY\nnonce=n-1\nexpires_ms=1700000000000",
    );
  });

  it("normalises the amount", () => {
    expect(verdictMessage({ ...FIELDS, amount: "0025000000" })).toContain("\namount=25000000\n");
  });
});

describe("checker key and signature", () => {
  it("round-trips NEAR key strings (64-byte secret and 32-byte seed)", () => {
    const k = generateCheckerKey();
    expect(k.secretKey).toMatch(/^ed25519:/);
    expect(checkerKeyFromSecret(k.secretKey).publicKey).toBe(k.publicKey);
    const seed = `ed25519:${bs58.encode(k.pair.secretKey.slice(0, 32))}`;
    expect(checkerKeyFromSecret(seed).publicKey).toBe(k.publicKey);
  });

  it("produces a standard ed25519 signature (verified by node:crypto as well)", () => {
    const k = generateCheckerKey();
    const signed = signVerdict(k, FIELDS);
    expect(Buffer.from(signed.signature, "base64")).toHaveLength(64);
    expect(verifyVerdict(k.publicKey, FIELDS, signed.signature)).toBe(true);

    const raw = Buffer.from(k.pair.publicKey);
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
    const pub = createPublicKey({ key: spki, format: "der", type: "spki" });
    const ok = verify(null, Buffer.from(verdictMessage(FIELDS)), pub, Buffer.from(signed.signature, "base64"));
    expect(ok).toBe(true);
  });

  it("does not verify for a different amount or recipient", () => {
    const k = generateCheckerKey();
    const signed = signVerdict(k, FIELDS);
    expect(verifyVerdict(k.publicKey, { ...FIELDS, amount: "500000000" }, signed.signature)).toBe(false);
    expect(verifyVerdict(k.publicKey, { ...FIELDS, recipient: "attacker.test.near" }, signed.signature)).toBe(false);
  });
});
