// Chaperone's own visual assets: logo mark, generated agent glyphs, recipient icons.
import type { Tone } from "@/lib/reasons";

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#000" stroke="var(--line-strong)" strokeWidth="0.5" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#e4f222" strokeWidth="2" />
      <circle cx="16" cy="16" r="3.2" fill="#e4f222" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-[19px] font-normal tracking-[-0.02em]">chaperone</span>
    </span>
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A ring of dots unique to each agent label, drawn in ink. */
export function AgentGlyph({ label, size = 28 }: { label: string; size?: number }) {
  const h = hash(label);
  const n = 7 + (h % 4);
  const dots = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const big = (h >> i) & 1;
    return { x: 16 + Math.cos(a) * 11, y: 16 + Math.sin(a) * 11, r: big ? 2.3 : 1.5 };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="var(--ink)" />
      ))}
      <circle cx="16" cy="16" r={2 + (h % 3) * 0.6} fill="var(--ink)" />
    </svg>
  );
}

/** Agent glyph inside a soft circle, for tables and headers. */
export function AgentBadge({ label, size = 40 }: { label: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-chip" style={{ width: size, height: size }}>
      <AgentGlyph label={label} size={size * 0.62} />
    </span>
  );
}

type IconName = "store" | "person" | "shield" | "contract" | "vault" | "key" | "check" | "x" | "alert" | "dash" | "arrow" | "external" | "moon" | "sun" | "bolt" | "clock";

const PATHS: Record<IconName, string> = {
  store: "M4 9.5 5.5 5h13L20 9.5M4 9.5h16M4 9.5c0 1.4 1.1 2.5 2.7 2.5S9.3 10.9 9.3 9.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.2 2.5 2.6 2.5 1.6 0 2.7-1.1 2.7-2.5M5.5 12v7h13v-7M10 19v-4h4v4",
  person: "M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6.5 7.5c.8-3 3.4-5 6.5-5s5.7 2 6.5 5",
  shield: "M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 8.9-4.1-1.3-7-4.7-7-8.9V6l7-2.5ZM9.5 9.5l5 5m0-5-5 5",
  contract: "M7 3.5h7l4 4V20.5H7zM14 3.5V7.5h4M9.5 12h6M9.5 15h6",
  vault: "M4 5.5h16v13H4zM14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM12 9.5V8m0 8v-1.5M4 18.5v1.5m16-1.5v1.5",
  key: "M14.5 9.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM13.5 12.5 20 19m-3-3 1.5-1.5M15 14l1.5-1.5",
  check: "m5 12.5 4.5 4.5L19 7.5",
  x: "m6.5 6.5 11 11m0-11-11 11",
  alert: "M12 7v6.5m0 3.5v.01",
  dash: "M7 12h10",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  external: "M8 16 16 8m-6 0h6v6",
  moon: "M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z",
  sun: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  bolt: "M13 3 5.5 13.5H12L11 21l7.5-10.5H12L13 3Z",
  clock: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 7.5V12l3 2",
};

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Recipient avatar: beige circle with an icon for what we know about the account. */
export function RecipientBadge({ kind, size = 40 }: { kind: "allowlisted" | "blocked" | "unknown" | "contract"; size?: number }) {
  const name: IconName = kind === "allowlisted" ? "store" : kind === "blocked" ? "shield" : kind === "contract" ? "contract" : "person";
  const tone = kind === "blocked" ? "bg-bad-bg text-bad" : "bg-chip text-ink";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${tone}`} style={{ width: size, height: size }}>
      <Icon name={name} size={size * 0.48} />
    </span>
  );
}

/** Small round status mark used in checklists and the audit trail. */
export function StatusMark({ tone, size = 20 }: { tone: Tone; size?: number }) {
  const map = {
    good: { c: "bg-good-bg text-good", i: "check" as const },
    warn: { c: "bg-warn-bg text-warn", i: "alert" as const },
    bad: { c: "bg-bad-bg text-bad", i: "x" as const },
    neutral: { c: "bg-chip text-muted", i: "dash" as const },
  }[tone];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${map.c}`} style={{ width: size, height: size }} aria-hidden>
      <Icon name={map.i} size={size * 0.62} />
    </span>
  );
}
