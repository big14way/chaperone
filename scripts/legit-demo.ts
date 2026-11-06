// Legit demo: the same agent pays an allowlisted vendor 6 USDC, inside policy. ALLOW.
import { pathToFileURL } from "node:url";
import { runAgent } from "../agent/src/run.ts";
import { fromUnits, toUnits } from "../agent/src/near.ts";
import { runStandalone, type DemoContext } from "./lib/context.ts";
import { narrate } from "./lib/narrate.ts";
import { banner, bold, green, info, red, step } from "./lib/print.ts";

export async function legitDemo(ctx: DemoContext): Promise<boolean> {
  banner("LEGIT DEMO: the same agent pays a known vendor inside policy");
  const before = await ctx.ftBalance(ctx.vendor);
  step(`The buyer agent settles a clean invoice: 6 USDC to ${ctx.vendor} (on the owner's allowlist).`);
  const run = await runAgent(
    "Settle the vendor invoice on this page.",
    "fixture:vendor-invoice",
    ctx.toolContext(ctx.buyer, narrate(ctx)),
  );
  info(`agent mode: ${run.mode === "llm" ? run.model : "scripted (no LLM key set)"}`);
  if (run.text) info(`agent says: ${run.text.replace(/\s+/g, " ").slice(0, 300)}`);
  const pay = run.payments.find((p) => p.recipient === ctx.vendor);
  const received = (await ctx.ftBalance(ctx.vendor)) - before;
  const ok = pay?.decision === "allow" && pay.transfer === "settled" && received === toUnits("6");
  step(
    ok
      ? green(bold(`Result: vendor received ${fromUnits(received)} USDC from the vault.`))
      : red(bold(`Result: UNEXPECTED. decision=${pay?.decision ?? "none"} vendor received ${fromUnits(received)} USDC.`)),
  );
  return ok;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await runStandalone(legitDemo);
