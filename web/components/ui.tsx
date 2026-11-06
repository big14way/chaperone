"use client";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import type { Tone } from "@/lib/reasons";
import { Icon, StatusMark } from "./glyphs";

/** Floating card: translucent white, 16px radius, long soft shadow. */
export function Card({ children, className = "", flat = false }: { children: ReactNode; className?: string; flat?: boolean }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface ${flat ? "" : "shadow-card"} ${className}`}>
      {children}
    </div>
  );
}

export function SectionHead({ index, title, lead, aside }: { index: string; title: ReactNode; lead?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl">
        <div className="eyebrow">{index}</div>
        <h2 className="title mt-4 text-[32px] sm:text-[40px]">{title}</h2>
        {lead && <p className="mt-4 text-[17px] leading-[1.55] text-muted sm:text-[18px]">{lead}</p>}
      </div>
      {aside}
    </div>
  );
}

type Variant = "lime" | "white" | "ink" | "danger" | "ghost";
const V: Record<Variant, string> = {
  lime: "bg-lime text-lime-ink border border-lime hover:brightness-95",
  white: "bg-surface text-ink border border-line hover:border-line-strong hover:bg-sunken",
  ink: "bg-ink text-canvas border border-ink hover:opacity-85",
  danger: "bg-bad text-white border border-bad hover:opacity-90",
  ghost: "text-muted border border-transparent hover:text-ink",
};
const SIZE = { sm: "px-3 py-1.5 text-[13px]", md: "px-4 py-2.5 text-[14px]", lg: "px-5 py-3 text-[15px]" };

export function Button({
  variant = "white",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-normal leading-5 whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-40 ${V[variant]} ${SIZE[size]} ${className}`}
    />
  );
}

export function LinkButton({ variant = "white", size = "md", className = "", ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: keyof typeof SIZE }) {
  return <a {...rest} className={`inline-flex items-center justify-center gap-2 rounded-md font-normal leading-5 whitespace-nowrap transition ${V[variant]} ${SIZE[size]} ${className}`} />;
}

/** Underlined text link with an arrow, as used under section copy. */
export function ArrowLink({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="group inline-flex items-center gap-2 text-[15px] font-normal text-ink"
    >
      <span className="border-b border-line-strong pb-0.5 transition group-hover:border-ink">{children}</span>
      <Icon name={external ? "external" : "arrow"} size={16} className="transition group-hover:translate-x-0.5" />
    </a>
  );
}

export function CheckItem({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[14px] leading-5">
      <StatusMark tone={tone} />
      <span className={tone === "neutral" ? "text-muted" : "text-ink"}>{children}</span>
    </li>
  );
}

export function Meter({ value, max }: { value: bigint; max: bigint }) {
  const pct = max > 0n ? Math.min(100, Number((value * 1000n) / max) / 10) : 0;
  const bar = pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-ink";
  return (
    <div className="h-[6px] w-full overflow-hidden rounded-full bg-chip" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${bar} transition-[width] duration-700`} style={{ width: `${Math.max(pct, value > 0n ? 1.5 : 0)}%` }} />
    </div>
  );
}

export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const c = { good: "bg-good-bg text-good", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", neutral: "bg-chip text-ink-2" }[tone];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-normal tracking-[0.06em] uppercase ${c}`}>{children}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-chip/70 ${className}`} />;
}
