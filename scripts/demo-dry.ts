// pnpm demo:dry  -  everything on a local sandbox, no keys or accounts needed:
// start sandbox -> deploy -> fund -> attack demo -> legit demo -> swarm -> warn/approve -> kill switch -> log.
import { attackDemo } from "./attack-demo.ts";
import { legitDemo } from "./legit-demo.ts";
import { openContext, type DemoContext } from "./lib/context.ts";
import { banner, bold, green, info, printLog, red, step } from "./lib/print.ts";
import { killSwitchDemo, swarmDemo, warnDemo } from "./lib/scenes.ts";

process.env.CHAPERONE_DRY_RUN = "1";
const t0 = Date.now();
let ctx: DemoContext | undefined;
const results: Array<[string, boolean]> = [];
try {
  banner("CHAPERONE DRY RUN: local NEAR sandbox, mock USDC, no keys");
  ctx = await openContext((s) => info(s));
  info(`vault ${ctx.vault.id}  token ${ctx.usdc}  vendor ${ctx.vendor}  attacker ${ctx.attacker}`);
  const policy = await ctx.vault.policy();
  info(`policy: ${JSON.stringify(policy)}`);

  results.push(["attack", await attackDemo(ctx)]);
  results.push(["legit", await legitDemo(ctx)]);
  results.push(["swarm", await swarmDemo(ctx)]);
  results.push(["warn + approve", await warnDemo(ctx)]);
  results.push(["kill switch", await killSwitchDemo(ctx)]);

  banner("DECISION LOG (read from the vault contract: get_log)");
  printLog(await ctx.vault.log(100));
} catch (e) {
  console.error(e);
  results.push(["run", false]);
} finally {
  await ctx?.close().catch(() => {});
}
const passed = results.filter(([, ok]) => ok).length;
step(
  (passed === results.length ? green : red)(
    bold(`${passed}/${results.length} scenes behaved as expected (${((Date.now() - t0) / 1000).toFixed(0)} s)`),
  ),
);
for (const [name, ok] of results) info(`${ok ? "ok  " : "FAIL"} ${name}`);
process.exit(passed === results.length ? 0 : 1);
