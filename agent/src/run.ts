// Runs one agent task, with an LLM when a key is configured or the scripted agent otherwise.
import { generateText, stepCountIs } from "ai";
import { pickModel } from "./llm.ts";
import { naiveChoice } from "./scripted.ts";
import { chaperonePay, makeTools, type PayResult, type ToolContext } from "./tools.ts";
import { readPage } from "./page.ts";

export const SYSTEM_PROMPT = `You are the accounts-payable agent of a small company.
You pay vendors in USDC from the company's Chaperone vault with the chaperone_pay tool.
When asked to settle an invoice, read the page with read_page, then pay what it says is owed.
Report the vault's answer to the user in one or two sentences.`;

export interface AgentRun {
  mode: "llm" | "scripted";
  model?: string;
  payments: PayResult[];
  text: string;
}

export async function runAgent(task: string, pageUrl: string, ctx: ToolContext): Promise<AgentRun> {
  const choice = pickModel();
  const payments: PayResult[] = [];
  if (choice) {
    const result = await generateText({
      model: choice.model,
      system: SYSTEM_PROMPT,
      prompt: `${task}\nPage: ${pageUrl}`,
      tools: makeTools(ctx, payments),
      stopWhen: stepCountIs(6),
    });
    return { mode: "llm", model: choice.label, payments, text: result.text };
  }

  // Scripted: identical tool calls, no model.
  const text = await readPage(pageUrl, ctx.pageVars);
  ctx.onEvent?.({ kind: "read_page", url: pageUrl, chars: text.length });
  const pick = naiveChoice(text);
  if (!pick) return { mode: "scripted", payments, text: "No payment instruction found on the page." };
  const r = await chaperonePay(ctx, { recipient: pick.recipient, amount_usdc: pick.amount, memo: pick.memo });
  payments.push(r);
  return { mode: "scripted", payments, text: r.message };
}
