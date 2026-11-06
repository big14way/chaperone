import { describe, expect, it } from "vitest";
import { reportDataFor } from "../src/tee-report-data.ts";

describe("TEE report data", () => {
  it("matches the Rust verifier byte for byte (crates/chaperone-tee)", () => {
    const rd = reportDataFor("chaperone.testnet", new Uint8Array(32).fill(1));
    expect(rd.length).toBe(64);
    expect(rd.subarray(0, 32).toString("hex")).toBe("f63aac1c25490c2b399152a79709a3c8e5a3233edbb8ff84468f97fdd519284b");
    expect(rd.subarray(32).every((b) => b === 0)).toBe(true);
  });
});
