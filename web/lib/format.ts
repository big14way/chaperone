import { KNOWN_TOKENS } from "./config";

export const USDC_DECIMALS = 6;

export function fromUnits(units: bigint | string, decimals = USDC_DECIMALS): string {
  const v = BigInt(units);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Whole/decimal string to base units; throws on anything that is not a non-negative decimal. */
export function toUnits(amount: string, decimals = USDC_DECIMALS): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) throw new Error(`"${amount}" is not an amount`);
  const frac = (m[2] ?? "").padEnd(decimals, "0");
  if (frac.length > decimals) throw new Error(`at most ${decimals} decimals`);
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export function tokenName(id: string): string {
  return KNOWN_TOKENS[id] ?? shortId(id);
}

export function shortId(id: string, keep = 10): string {
  return id.length > keep * 2 + 1 ? `${id.slice(0, keep)}…${id.slice(-4)}` : id;
}

export function shortKey(pk: string): string {
  const [, body = pk] = pk.split(":");
  return `${body.slice(0, 6)}…${body.slice(-4)}`;
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function until(ms: number, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000);
  if (s <= 0) return "expired";
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  return `in ${Math.round(m / 60)}h`;
}

export function stamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
