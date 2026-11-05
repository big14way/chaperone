// pnpm log  -  print a deployed vault's policy, agents, pending requests and decision log.
import { DEFAULT_RPC, type Network } from "../checker/src/config.ts";
import { Vault, fromUnits, makeProvider } from "../agent/src/near.ts";
import { loadDotEnv } from "./lib/context.ts";
import { banner, info, printLog } from "./lib/print.ts";

loadDotEnv();
const network = (process.env.NEAR_NETWORK || "testnet") as Network;
const vaultId = process.env.VAULT_ID;
if (!vaultId) {
  console.error("set VAULT_ID (and NEAR_NETWORK / NEAR_RPC_URL) in .env; for a local run use pnpm demo:dry");
  process.exit(1);
}
const vault = new Vault(makeProvider(process.env.NEAR_RPC_URL || DEFAULT_RPC[network]), vaultId);
const [infoView, policy, agents, pending, log] = await Promise.all([
  vault.info(),
  vault.policy(),
  vault.agents(),
  vault.pending(),
  vault.log(Number(process.env.LOG_LIMIT || 50)),
]);
banner(`vault ${vaultId} on ${network}`);
info(`owner ${infoView.owner}  checker ${infoView.checker_pk}  policy version ${infoView.policy_version}`);
info(`policy ${JSON.stringify(policy)}`);
for (const a of agents) {
  info(`agent ${a.label}: spent ${fromUnits(a.spent_today)} / ${fromUnits(a.daily_cap)} today, per-tx ${fromUnits(a.per_tx_cap)}, key ${a.public_key}`);
}
for (const p of pending) {
  info(`pending #${p.id}: ${p.agent_label} ${fromUnits(p.amount)} -> ${p.recipient} score ${p.score} [${p.reasons.join(",")}]`);
}
banner("decision log");
printLog(log);
