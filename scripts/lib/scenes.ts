// Extra dry-run scenes: two agents with separate caps, the warn -> owner approval path, and the
// kill switch.
import { chaperonePay } from "../../agent/src/tools.ts";
import { fromUnits, toUnits } from "../../agent/src/near.ts";
import type { DemoContext } from "./context.ts";
import { narrate } from "./narrate.ts";
import { banner, bold, green, info, printDecision, red, step } from "./print.ts";

function result(ok: boolean, good: string, bad: string) {
  step(ok ? green(bold(`Result: ${good}`)) : red(bold(`Result: UNEXPECTED. ${bad}`)));
  return ok;
}

export async function swarmDemo(ctx: DemoContext): Promise<boolean> {
  if (!ctx.researcher) return true;
  banner("SWARM: two agents share one vault, each with its own caps");
  const tools = ctx.toolContext(ctx.researcher, narrate(ctx));
  step("researcher (max 2 USDC per payment, 5 per day) buys a 2 USDC data sample");
  const small = await chaperonePay(tools, { recipient: ctx.vendor, amount_usdc: "2", memo: "sample" });
  step("researcher tries 3 USDC: above its own per-payment cap, though the buyer's cap would allow it");
  const big = await chaperonePay(tools, { recipient: ctx.vendor, amount_usdc: "3", memo: "sample-2" });
  step("agents and their budgets today");
  for (const a of await ctx.vault.agents()) {
    info(
      `${a.label.padEnd(11)} spent ${fromUnits(a.spent_today).padStart(5)} / ${fromUnits(a.daily_cap)} USDC, ` +
        `per-payment cap ${fromUnits(a.per_tx_cap)} USDC, key ${a.public_key.slice(0, 20)}...`,
    );
  }
  return result(
    small.decision === "allow" && big.decision === "block" && big.reasons.includes("PER_TX_CAP"),
    "the researcher is held to its own limits.",
    `small=${small.decision} big=${big.decision}`,
  );
}

export async function warnDemo(ctx: DemoContext): Promise<boolean> {
  if (!ctx.owner) return true;
  banner("WARN: an unusual amount waits for the owner");
  const before = await ctx.ftBalance(ctx.vendor);
  step("buyer pays the vendor 10 USDC, well above its 7-day average");
  const r = await chaperonePay(ctx.toolContext(ctx.buyer, narrate(ctx)), {
    recipient: ctx.vendor,
    amount_usdc: "10",
    memo: "LDL-1043",
  });
  const pending = await ctx.vault.pending();
  info(`pending requests: ${pending.map((p) => `#${p.id} ${p.agent_label} ${fromUnits(p.amount)} USDC -> ${p.recipient}`).join("; ") || "none"}`);
  step("owner reviews it and approves with a full-access key (approve attaches 1 yoctoNEAR)");
  const { value: entry, txHash } = await ctx.owner.approve(r.request_id);
  printDecision(entry, ctx.explorer(txHash));
  const received = (await ctx.ftBalance(ctx.vendor)) - before;
  return result(
    r.decision === "warn" && entry.outcome === "approved" && entry.transfer === "settled" && received === toUnits("10"),
    "nothing moved until the owner said yes; then the vault paid.",
    `request=${r.decision} approval=${entry.outcome}/${entry.transfer}`,
  );
}

export async function killSwitchDemo(ctx: DemoContext): Promise<boolean> {
  if (!ctx.owner) return true;
  banner("KILL SWITCH: revoke_all");
  step("owner calls revoke_all: policy version bumps, parked requests are cancelled, agent keys are deleted");
  const { value: revoked } = await ctx.owner.revokeAll();
  info(`agents revoked: ${revoked}`);
  step("buyer tries to pay 1 USDC with its old key");
  let refused = "";
  try {
    await chaperonePay(ctx.toolContext(ctx.buyer, narrate(ctx)), { recipient: ctx.vendor, amount_usdc: "1" });
  } catch (e) {
    refused = (e as Error).message.split("\n")[0]!.slice(0, 160);
    info(`network refused the transaction: ${refused}`);
  }
  const infoView = await ctx.vault.info();
  return result(
    refused !== "" && infoView.agents === 0,
    "the agent's key no longer exists; it cannot even sign.",
    `agents=${infoView.agents} refused=${refused || "no"}`,
  );
}
