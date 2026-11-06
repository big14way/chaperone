import { describe, expect, it } from "vitest";
import { registryBlocklist } from "../src/blocklist.ts";

describe("registry blocklist", () => {
  const flag = { account_id: "drainer.testnet", reason: "PAYMENT_REDIRECT_SCAM", evidence: "tx 9xQ", reporter: "owner.testnet", reported_ms: 1_762_400_000_000 };
  const calls: unknown[] = [];
  const list = registryBlocklist(async (contract, method, args) => {
    calls.push([contract, method, args]);
    return args.account_id === flag.account_id ? flag : null;
  }, "registry.testnet");

  it("reads get_flag on the registry and maps the flag", async () => {
    const hit = await list.lookup("drainer.testnet");
    expect(calls[0]).toEqual(["registry.testnet", "get_flag", { account_id: "drainer.testnet" }]);
    expect(hit).toMatchObject({ reason: "PAYMENT_REDIRECT_SCAM", reporter: "owner.testnet", reported_at: new Date(flag.reported_ms).toISOString() });
    expect(await list.lookup("vendor.testnet")).toBeNull();
    expect(list.source).toBe("near:registry.testnet");
  });

  it("skips ids that are not NEAR accounts instead of failing the view", async () => {
    const before = calls.length;
    expect(await list.lookup("Not An Account")).toBeNull();
    expect(calls.length).toBe(before);
  });

  it("fails closed when the registry cannot be read", async () => {
    const down = registryBlocklist(async () => { throw new Error("RPC down"); }, "registry.testnet");
    await expect(down.lookup("vendor.testnet")).rejects.toThrow("RPC down");
  });
});
