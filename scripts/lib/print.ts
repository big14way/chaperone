// Console output for the demos. Plain text, optional colour (disabled by NO_COLOR or non-TTY).
import type { VerdictResponse } from "../../checker/src/server.ts";
import type { LogEntry } from "../../checker/src/types.ts";
import { fromUnits } from "../../agent/src/near.ts";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const red = paint(31);
export const green = paint(32);
export const yellow = paint(33);
export const dim = paint(2);
export const bold = paint(1);

export function banner(title: string) {
  console.log(`\n${bold("=".repeat(72))}\n${bold(title)}\n${bold("=".repeat(72))}`);
}

export function step(text: string) {
  console.log(`\n${bold(">")} ${text}`);
}

export function info(text: string) {
  console.log(`  ${text}`);
}

function colorOutcome(o: string): string {
  if (o === "allow" || o === "approved") return green(o.toUpperCase());
  if (o === "warn") return yellow(o.toUpperCase());
  return red(o.toUpperCase());
}

export function printVerdict(v: VerdictResponse) {
  info(`checker verdict: ${colorOutcome(v.verdict)} score=${v.score} reasons=[${v.reasons.join(", ")}]`);
  const s = v.signals;
  const age = s.ageMs === null ? "unknown" : `${(s.ageMs / 3_600_000).toFixed(1)} h (${s.ageSource})`;
  info(
    dim(
      `signals: exists=${s.exists} allowlisted=${s.allowlisted} blocklisted=${s.blocklisted ? s.blocklisted.reason : "no"} ` +
        `age=${age} tx_count=${s.txCount ?? "?"} contract=${s.isContract} prior_settled=${s.priorSettled} ` +
        `7d_mean=${s.mean7d === null ? "none" : fromUnits(s.mean7d)} USDC`,
    ),
  );
}

export function printDecision(e: LogEntry, link: string) {
  const transfer = e.transfer ? ` transfer=${e.transfer}` : "";
  info(
    `vault decision: ${colorOutcome(e.outcome)}${transfer} request=${e.request_id} agent=${e.agent_label} ` +
      `${fromUnits(e.amount)} USDC -> ${e.recipient}`,
  );
  info(`reason codes: ${e.reasons.length ? e.reasons.join(", ") : "(none)"}`);
  info(dim(`tx: ${link}`));
}

export function printLog(entries: LogEntry[]) {
  const rows = entries.map((e) => [
    String(e.seq),
    e.agent_label,
    e.outcome.toUpperCase(),
    `${fromUnits(e.amount)}`,
    e.recipient,
    e.transfer ?? "-",
    e.reasons.join(","),
  ]);
  const head = ["seq", "agent", "outcome", "USDC", "recipient", "transfer", "reasons"];
  const widths = head.map((h, i) => Math.min(i === 6 ? 200 : 24, Math.max(h.length, ...rows.map((r) => r[i]!.length))));
  const fmt = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join("  ");
  console.log(bold(fmt(head)));
  for (const r of rows) console.log(fmt(r));
}
