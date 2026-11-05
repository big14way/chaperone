// Agent tools: read_page and chaperone_pay. chaperone_pay is the only way the agent can move money.
import { tool } from "ai";
import { z } from "zod";
import type { VerdictResponse } from "../../checker/src/server.ts";
import type { LogEntry } from "../../checker/src/types.ts";
import { fromUnits, toUnits, type AgentKey } from "./near.ts";
import { readPage } from "./page.ts";

export interface ToolContext {
  agent: AgentKey;
  token: string;
  checkerUrl: string;
  pageVars: Record<string, string>;
  /** Called on every tool event so demos can narrate. */
  onEvent?: (e: AgentEvent) => void;
}

export type AgentEvent =
  | { kind: "read_page"; url: string; chars: number }
  | { kind: "pay_request"; recipient: string; amount: string; memo?: string }
  | { kind: "verdict"; verdict: VerdictResponse }
  | { kind: "decision"; entry: LogEntry; txHash: string };

export interface PayResult {
  recipient: string;
  amount_usdc: string;
  checker: { verdict: string; score: number; reasons: string[] };
  decision: LogEntry["outcome"];
  reasons: string[];
  transfer: LogEntry["transfer"];
  request_id: number;
  tx_hash: string;
  message: string;
}

export async function getVerdict(
  checkerUrl: string,
  body: { agent: string; token: string; amount: string; recipient: string },
): Promise<VerdictResponse> {
  const res = await fetch(new URL("/verdict", checkerUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`checker: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as VerdictResponse;
}

function describe(entry: LogEntry): string {
  switch (entry.outcome) {
    case "allow":
      return entry.transfer === "failed"
        ? `Approved by policy but the token transfer failed (request ${entry.request_id}).`
        : `Paid. The vault sent ${fromUnits(entry.amount)} USDC to ${entry.recipient} (request ${entry.request_id}).`;
    case "warn":
      return `Parked for the owner's approval (request ${entry.request_id}). Do not retry; tell the user.`;
    case "block":
      return `Refused by the vault: ${entry.reasons.join(", ")}. Do not retry; tell the user.`;
    default:
      return `Vault outcome: ${entry.outcome}.`;
  }
}

/** Ask the checker for a signed verdict, then submit request_spend with the agent's key. */
export async function chaperonePay(
  ctx: ToolContext,
  input: { recipient: string; amount_usdc: string; memo?: string },
): Promise<PayResult> {
  const amount = toUnits(input.amount_usdc);
  ctx.onEvent?.({ kind: "pay_request", recipient: input.recipient, amount: input.amount_usdc, memo: input.memo });
  const verdict = await getVerdict(ctx.checkerUrl, {
    agent: ctx.agent.publicKey,
    token: ctx.token,
    amount: amount.toString(),
    recipient: input.recipient,
  });
  ctx.onEvent?.({ kind: "verdict", verdict });
  // Even a BLOCK verdict is submitted: the vault is the enforcement point and the refusal is
  // recorded on chain. The client-side wrapper is not trusted to refuse.
  const { entry, txHash } = await ctx.agent.requestSpend({
    token: ctx.token,
    amount,
    recipient: input.recipient,
    memo: input.memo,
    verdict: {
      verdict: verdict.verdict,
      score: verdict.score,
      reasons: verdict.reasons,
      nonce: verdict.nonce,
      expires_ms: verdict.expires_ms,
      signature: verdict.signature,
    },
  });
  ctx.onEvent?.({ kind: "decision", entry, txHash });
  return {
    recipient: input.recipient,
    amount_usdc: input.amount_usdc,
    checker: { verdict: verdict.verdict, score: verdict.score, reasons: verdict.reasons },
    decision: entry.outcome,
    reasons: entry.reasons,
    transfer: entry.transfer,
    request_id: entry.request_id,
    tx_hash: txHash,
    message: describe(entry),
  };
}

export function makeTools(ctx: ToolContext, sink: PayResult[]) {
  return {
    read_page: tool({
      description: "Fetch a web page (or a fixture: URL) and return its text.",
      inputSchema: z.object({ url: z.string().describe("http(s) URL or fixture:<name>") }),
      execute: async ({ url }) => {
        const text = await readPage(url, ctx.pageVars);
        ctx.onEvent?.({ kind: "read_page", url, chars: text.length });
        return text;
      },
    }),
    chaperone_pay: tool({
      description:
        "Pay a NEAR account in USDC from the Chaperone vault. The vault checks the counterparty and the owner's policy; it may pay, refuse, or park the request for the owner.",
      inputSchema: z.object({
        recipient: z.string().describe("NEAR account id to pay"),
        amount_usdc: z.string().describe("Amount in USDC, decimal string, e.g. 25 or 25.50"),
        memo: z.string().max(200).optional().describe("Invoice number or reason"),
      }),
      execute: async (input) => {
        const r = await chaperonePay(ctx, input);
        sink.push(r);
        return r;
      },
    }),
  };
}
