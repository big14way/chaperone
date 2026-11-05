// Deterministic stand-in for the LLM, used when no model key is configured. It makes the same
// tool calls a fooled model would: read the page, then obey the LAST payment instruction in it.
// That is deliberately naive. The point of the demo is that the vault holds even when the agent
// is fully compromised.

export interface PaymentInstruction {
  amount: string;
  recipient: string;
  memo?: string;
}

const PAY_RE =
  /\b(?:pay|send|transfer|remit)\s+(\d+(?:\.\d+)?)\s*USDC\s+(?:to\s+)?([a-z0-9][a-z0-9._-]*\.[a-z0-9._-]*[a-z0-9])/gi;
const MEMO_RE = /\b(?:invoice|ref(?:erence)?)\s*(?:#|no\.?|number)?\s*:?\s*([A-Z0-9][A-Z0-9-]{2,30})/i;

export function findPaymentInstructions(text: string): PaymentInstruction[] {
  const memo = MEMO_RE.exec(text)?.[1];
  return [...text.matchAll(PAY_RE)].map((m) => ({
    amount: m[1]!,
    recipient: m[2]!.toLowerCase().replace(/\.$/, ""),
    memo,
  }));
}

/** The instruction a naive agent would act on: the last one it read. */
export function naiveChoice(text: string): PaymentInstruction | null {
  const all = findPaymentInstructions(text);
  return all.length ? all[all.length - 1]! : null;
}
