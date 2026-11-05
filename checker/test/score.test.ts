import { describe, expect, it } from "vitest";
import { assess, band, DAY_MS, type Signals } from "../src/score.ts";

const USDC = 1_000_000n;

function sig(over: Partial<Signals> = {}): Signals {
  return {
    recipient: "vendor.testnet",
    amount: 25n * USDC,
    exists: true,
    allowlisted: true,
    blocklisted: null,
    ageMs: 30 * DAY_MS,
    ageSource: "key-nonce",
    txCount: 50,
    isContract: false,
    codeChangedAgoMs: null,
    priorSettled: 0,
    priorBlocked: 0,
    mean7d: null,
    dailyCap: 100n * USDC,
    ...over,
  };
}

describe("bands", () => {
  it("allow < 30 <= warn <= 70 < block", () => {
    expect(band(0)).toBe("allow");
    expect(band(29)).toBe("allow");
    expect(band(30)).toBe("warn");
    expect(band(70)).toBe("warn");
    expect(band(71)).toBe("block");
  });
});

describe("assess", () => {
  it("allows an allowlisted vendor with no history", () => {
    expect(assess(sig())).toEqual({ verdict: "allow", score: 0, reasons: ["ALLOWLISTED", "NO_SPEND_HISTORY"] });
  });

  it("hard-blocks the injected attacker: blocklisted, brand new, large amount", () => {
    const a = assess(
      sig({
        recipient: "attacker.testnet",
        amount: 500n * USDC,
        allowlisted: false,
        blocklisted: { reason: "PAYMENT_REDIRECT_SCAM" },
        ageMs: 60_000,
        txCount: 0,
      }),
    );
    expect(a.verdict).toBe("block");
    expect(a.score).toBe(100);
    expect(a.reasons).toEqual(
      expect.arrayContaining(["BLOCKLISTED", "NEW_ACCOUNT_LARGE_AMOUNT", "NEW_ACCOUNT", "LOW_ACTIVITY"]),
    );
  });

  it("hard-blocks a new account asking for more than 10% of the daily cap", () => {
    const a = assess(sig({ allowlisted: false, ageMs: DAY_MS - 1, amount: 11n * USDC }));
    expect(a.verdict).toBe("block");
    expect(a.reasons[0]).toBe("NEW_ACCOUNT_LARGE_AMOUNT");
  });

  it("warns (not blocks) on a new unknown account asking for a small amount", () => {
    const a = assess(sig({ allowlisted: false, ageMs: 3_600_000, txCount: 1, amount: 5n * USDC }));
    expect(a.verdict).toBe("warn");
    expect(a.score).toBe(60);
  });

  it("hard-blocks a contract whose code changed in the last 24 h, and an unknown account", () => {
    expect(assess(sig({ isContract: true, codeChangedAgoMs: 3_600_000 })).reasons[0]).toBe("CODE_CHANGED_24H");
    expect(assess(sig({ exists: false })).reasons[0]).toBe("ACCOUNT_NOT_FOUND");
  });

  it("warns on an amount spike against the 7-day mean", () => {
    const a = assess(sig({ amount: 45n * USDC, mean7d: 25n * USDC, priorSettled: 1 }));
    expect(a).toEqual({ verdict: "warn", score: 30, reasons: ["ALLOWLISTED", "KNOWN_COUNTERPARTY", "AMOUNT_SPIKE"] });
    expect(assess(sig({ amount: 100n * USDC, mean7d: 25n * USDC })).score).toBe(60);
  });

  it("keeps reason codes within the contract's limits", () => {
    const a = assess(
      sig({
        exists: false,
        allowlisted: false,
        blocklisted: { reason: "X" },
        ageMs: 1,
        txCount: 0,
        isContract: true,
        codeChangedAgoMs: 1,
        priorBlocked: 2,
        mean7d: 1n,
        amount: 500n * USDC,
      }),
    );
    expect(a.reasons.length).toBeLessThanOrEqual(16);
    for (const r of a.reasons) expect(r).toMatch(/^[A-Z0-9_]{1,48}$/);
  });
});
