"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Outcome } from "@/lib/types";

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-stone-500 dark:text-stone-400">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

type Tone = "primary" | "danger" | "ghost";
const TONES: Record<Tone, string> = {
  primary: "bg-stone-900 text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white",
  danger: "bg-red-600 text-white hover:bg-red-500",
  ghost: "border border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800",
};

export function Button({ tone = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      {...rest}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${TONES[tone]} ${className}`}
    />
  );
}

const OUTCOME: Record<Outcome, string> = {
  allow: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  approved: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  block: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  rejected: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
  cancelled: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
};

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold uppercase ${OUTCOME[outcome]}`}>{outcome}</span>;
}

export function Reason({ code }: { code: string }) {
  const bad = /BLOCK|BLOCKLISTED|SIGNATURE|CAP|TIMELOCK|EXPIRED|REUSED|NOT_|NEW_ACCOUNT|SPIKE|FAILED|CODE_CHANGED|REJECTED|REVOKED/.test(code);
  const good = /^(ALLOWLISTED|KNOWN_COUNTERPARTY|OWNER_APPROVED)$/.test(code);
  const tone = bad
    ? "text-red-700 dark:text-red-400"
    : good
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-stone-500 dark:text-stone-400";
  return <span className={`font-mono text-[11px] ${tone}`}>{code}</span>;
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="font-mono text-xs" title={title}>
      {children}
    </span>
  );
}
