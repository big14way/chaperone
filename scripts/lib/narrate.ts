// Turns agent tool events into demo output.
import type { AgentEvent } from "../../agent/src/tools.ts";
import type { DemoContext } from "./context.ts";
import { info, printDecision, printVerdict } from "./print.ts";

export function narrate(ctx: DemoContext) {
  return (e: AgentEvent) => {
    switch (e.kind) {
      case "read_page":
        info(`agent -> read_page(${e.url}) returned ${e.chars} chars`);
        break;
      case "pay_request":
        info(`agent -> chaperone_pay(recipient=${e.recipient}, amount=${e.amount} USDC${e.memo ? `, memo=${e.memo}` : ""})`);
        break;
      case "verdict":
        printVerdict(e.verdict);
        break;
      case "decision":
        printDecision(e.entry, ctx.explorer(e.txHash));
        break;
    }
  };
}
