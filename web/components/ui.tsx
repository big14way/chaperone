"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Tone } from "@/lib/reasons";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>{children}</div>;
}

export function SectionHead({ index, title, aside }: { index: string; title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <div className="label">{index}</div>
        <h2 className="mt-1 text-xl font-medium tracking-tight">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const V: Record<Variant, string> = {
  primary: "bg-ink text-canvas hover:opacity-85",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
  danger: "bg-bad text-white hover:opacity-90",
  ghost: "text-muted hover:text-ink hover:bg-sunken",
};
const S = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-11 px-5 text-[15px]" };

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof S }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-35 ${V[variant]} ${S[size]} ${className}`}
    />
  );
}

const TONE_TEXT: Record<Tone, string> = { good: "text-good", warn: "text-warn", bad: "text-bad", neutral: "text-muted" };

export function Check({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-snug">
      <ToneIcon tone={tone} />
      <span className={tone === "neutral" ? "text-muted" : "text-ink-2"}>{children}</span>
    </li>
  );
}

export function ToneIcon({ tone, size = 18 }: { tone: Tone; size?: number }) {
  const bg = { good: "bg-good-bg", warn: "bg-warn-bg", bad: "bg-bad-bg", neutral: "bg-sunken" }[tone];
  return (
    <span className={`mt-px inline-flex shrink-0 items-center justify-center rounded-full ${bg} ${TONE_TEXT[tone]}`} style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {tone === "good" && <path d="M2.5 6.2l2.3 2.3 4.7-4.9" />}
        {tone === "bad" && <path d="M3 3l6 6M9 3l-6 6" />}
        {tone === "warn" && <path d="M6 2.5v4.2M6 9.2v.1" />}
        {tone === "neutral" && <path d="M3 6h6" />}
      </svg>
    </span>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const c = { good: "bg-good-bg text-good", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", neutral: "bg-sunken text-muted" }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}

/** Deterministic glyph avatar for an agent label. */
export function AgentAvatar({ label, size = 36 }: { label: string; size?: number }) {
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-mono text-sm font-semibold text-white"
      style={{ width: size, height: size, background: `oklch(0.52 0.13 ${h})` }}
      aria-hidden
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Meter({ value, max, tone = "neutral" }: { value: bigint; max: bigint; tone?: Tone }) {
  const pct = max > 0n ? Math.min(100, Number((value * 1000n) / max) / 10) : 0;
  const bar = pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : tone === "good" ? "bg-good" : "bg-ink";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${bar} transition-[width] duration-500`} style={{ width: `${Math.max(pct, value > 0n ? 2 : 0)}%` }} />
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-sunken ${className}`} />;
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 2.5l8 3.2v6.1c0 4.6-3.3 8.4-8 9.7-4.7-1.3-8-5.1-8-9.7V5.7l8-3.2z" fill="currentColor" />
        <circle cx="12" cy="11" r="3.2" fill="var(--canvas)" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">chaperone</span>
    </span>
  );
}
