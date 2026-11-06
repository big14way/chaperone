// pnpm demo:warn  -  the buyer asks for 10 USDC, well above its 7-day average of 6, so the checker
// rates it WARN and the vault parks it. Nothing moves until the owner approves it in the web app
// (pnpm web) or rejects it. On the sandbox it is approved here with the owner key instead.
import { pathToFileURL } from "node:url";
import { chaperonePay } from "../agent/src/tools.ts";
import { fromUnits } from "../agent/src/near.ts";
import { runStandalone, type DemoContext } from "./lib/context.ts";
import { narrate } from "./lib/narrate.ts";
import { banner, bold, green, info, red, step } from "./lib/print.ts";
import { warnDemo } from "./lib/scenes.ts";

export async function parkWarn(ctx: DemoContext): Promise<boolean> {
  if (ctx.network === "sandbox") return warnDemo(ctx);
  banner("WARN: an unusual amount waits for the owner");
  step("buyer pays the vendor 10 USDC, well above its 7-day average");
  const r = await chaperonePay(ctx.toolContext(ctx.buyer, narrate(ctx)), {
    recipient: ctx.vendor,
    amount_usdc: "10",
    memo: "LDL-1043",
  });
  const pending = await ctx.vault.pending();
  for (const p of pending) info(`pending #${p.id}: ${p.agent_label} ${fromUnits(p.amount)} USDC -> ${p.recipient}`);
  const ok = r.decision === "warn";
  step(
    ok
      ? green(bold(`Result: request #${r.request_id} is parked. Approve or reject it as the owner in the web app (pnpm web).`))
      : red(bold(`Result: UNEXPECTED. decision=${r.decision} reasons=${r.reasons.join(",")}`)),
  );
  return ok;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await runStandalone(parkWarn);
