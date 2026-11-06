// Swaps through NEAR Intents (1Click API) under the same policy as payments. Before a swap is quoted,
// the request must fit the agent's caps, use allowed assets, and send the output back to the vault (an
// injected "swap and send it to X" is refused). The 1Click quote is then checked for value loss.
// Intents has no testnet, so the demo uses `dry: true` quotes on mainnet assets: nothing is deposited.
export const ONECLICK_API = "https://1click.chaindefuser.com/v0";

export interface SwapPolicy {
  vault: string;
  perTxCapUnits: bigint;
  remainingTodayUnits: bigint;
  allowedAssets: string[];
  warnLossBps: number;
  blockLossBps: number;
}

export interface SwapRequest {
  fromAsset: string;
  toAsset: string;
  amountUnits: bigint;
  recipient: string;
}

export type SwapDecision = { verdict: "allow" | "warn" | "block"; reasons: string[] };

/** Checks that need no quote. Any reason here blocks. */
export function precheckSwap(p: SwapPolicy, r: SwapRequest): string[] {
  const reasons: string[] = [];
  if (r.recipient !== p.vault) reasons.push("SWAP_OUTPUT_NOT_TO_VAULT");
  if (!p.allowedAssets.includes(r.fromAsset)) reasons.push("FROM_ASSET_NOT_ALLOWED");
  if (!p.allowedAssets.includes(r.toAsset)) reasons.push("TO_ASSET_NOT_ALLOWED");
  if (r.amountUnits > p.perTxCapUnits) reasons.push("PER_TX_CAP");
  if (r.amountUnits > p.remainingTodayUnits) reasons.push("DAILY_CAP");
  return reasons;
}

/** Value lost between input and output, in basis points of the input's USD value. */
export function lossBps(amountInUsd: number, amountOutUsd: number): number {
  if (!(amountInUsd > 0)) return 10_000;
  return Math.round(((amountInUsd - amountOutUsd) / amountInUsd) * 10_000);
}

export function judgeQuote(p: SwapPolicy, inUsd: number, outUsd: number): SwapDecision {
  const bps = lossBps(inUsd, outUsd);
  if (bps >= p.blockLossBps) return { verdict: "block", reasons: [`QUOTE_LOSS_${bps}_BPS`] };
  if (bps >= p.warnLossBps) return { verdict: "warn", reasons: [`QUOTE_LOSS_${bps}_BPS`] };
  return { verdict: "allow", reasons: [`QUOTE_LOSS_${bps}_BPS`] };
}

export interface DryQuote {
  amountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountInUsd: number;
  amountOutUsd: number;
  timeEstimate: number;
}

export async function dryQuote(r: SwapRequest, refundTo: string): Promise<DryQuote> {
  const res = await fetch(`${ONECLICK_API}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: r.fromAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: r.toAsset,
      amount: r.amountUnits.toString(),
      refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: r.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    }),
  });
  const body = (await res.json()) as { quote?: Record<string, string>; message?: string };
  if (!res.ok || !body.quote) throw new Error(`1Click quote failed: HTTP ${res.status} ${body.message ?? ""}`);
  const q = body.quote;
  return {
    amountIn: q.amountIn!,
    amountOut: q.amountOut!,
    amountOutFormatted: q.amountOutFormatted!,
    amountInUsd: Number(q.amountInUsd),
    amountOutUsd: Number(q.amountOutUsd),
    timeEstimate: Number(q.timeEstimate),
  };
}
