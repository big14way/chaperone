// pnpm registry <command>  -  the shared blocklist registry (contracts/registry) on testnet.
//
//   pnpm registry list                                  every flag
//   pnpm registry check <account>                       is this account flagged?
//   pnpm registry report <account> <REASON> <evidence>  flag it (signs as OWNER_ID, a trusted reporter)
//   pnpm registry clear <account>                       remove a flag you filed
//   pnpm registry add-reporter <account>                owner: trust another vault owner or checker operator
//
// Every checker reads this registry, so a flag here blocks the account for every vault.
import { Account } from "near-api-js";
import { DEFAULT_REGISTRY, DEFAULT_RPC } from "../checker/src/config.ts";
import { ONE_YOCTO, TGAS, Vault, makeProvider } from "../agent/src/near.ts";
import { keyFor, loadDotEnv } from "./lib/context.ts";
import { banner, bold, dim, green, info, red, step } from "./lib/print.ts";

loadDotEnv();
const registryId: string = process.env.REGISTRY_ID || process.env.BLOCKLIST_REGISTRY || DEFAULT_REGISTRY.testnet || "";
if (!registryId) throw new Error("set REGISTRY_ID in .env");
const provider = makeProvider(process.env.NEAR_RPC_URL || DEFAULT_RPC.testnet);
const registry = new Vault(provider, registryId);

interface Flag {
  account_id: string;
  reason: string;
  evidence: string;
  reporter: string;
  reported_ms: number;
}

function show(f: Flag) {
  info(`${red(f.account_id)}  ${bold(f.reason)}  ${dim(`by ${f.reporter}, ${new Date(f.reported_ms).toISOString().slice(0, 10)}`)}`);
  info(`  ${f.evidence}`);
}

async function call(method: string, args: Record<string, unknown>) {
  const ownerId = process.env.OWNER_ID;
  const key = ownerId && keyFor(ownerId, "OWNER_PRIVATE_KEY");
  if (!ownerId || !key) throw new Error("need OWNER_ID and its key (.env or ~/.near-credentials)");
  const out = await new Account(ownerId, provider, key).callFunctionRaw({ contractId: registryId, methodName: method, args, deposit: ONE_YOCTO, gas: 30n * TGAS });
  info(`tx ${out.transaction_outcome.id}`);
}

const [cmd, account, reason, ...evidence] = process.argv.slice(2);
switch (cmd) {
  case "list": {
    const flags = await registry.view<Flag[]>("get_flags", { limit: 100 });
    const reporters = await registry.view<string[]>("get_reporters");
    banner(`${registryId}: ${flags.length} flagged, ${reporters.length} trusted reporter${reporters.length === 1 ? "" : "s"}`);
    flags.forEach(show);
    break;
  }
  case "check": {
    if (!account) throw new Error("usage: pnpm registry check <account>");
    const f = await registry.view<Flag | null>("get_flag", { account_id: account });
    if (f) show(f);
    else info(green(`${account} is not flagged`));
    break;
  }
  case "report":
    if (!account || !reason || !evidence.length) throw new Error("usage: pnpm registry report <account> <REASON_CODE> <evidence...>");
    step(`flag ${account} as ${reason}`);
    await call("report", { account_id: account, reason, evidence: evidence.join(" ") });
    show((await registry.view<Flag>("get_flag", { account_id: account }))!);
    break;
  case "clear":
    if (!account) throw new Error("usage: pnpm registry clear <account>");
    step(`clear ${account}`);
    await call("clear", { account_id: account });
    break;
  case "add-reporter":
    if (!account) throw new Error("usage: pnpm registry add-reporter <account>");
    step(`trust ${account} as a reporter`);
    await call("add_reporter", { account_id: account });
    break;
  default:
    console.log(bold("usage: pnpm registry list | check <account> | report <account> <REASON> <evidence> | clear <account> | add-reporter <account>"));
    process.exit(cmd ? 1 : 0);
}
