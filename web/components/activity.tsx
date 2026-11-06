"use client";
import { useMemo, useState } from "react";
import { explorerAccount } from "@/lib/config";
import { ago, amount, stamp, tokenName } from "@/lib/format";
import { headline, kindOf, reasons, type Kind } from "@/lib/reasons";
import type { LogEntry } from "@/lib/types";
import { AgentAvatar, Card, Pill, SectionHead, ToneIcon } from "./ui";

const FILTERS: Array<{ key: "all" | Kind; label: string }> = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "blocked", label: "Blocked" },
  { key: "held", label: "Held" },
];

const KIND_TONE = { paid: "good", blocked: "bad", held: "warn", closed: "neutral", failed: "bad" } as const;
const KIND_LABEL = { paid: "Paid", blocked: "Blocked", held: "Held", closed: "Closed", failed: "Failed" } as const;

export function Activity({ log, total }: { log: LogEntry[]; total: number }) {
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [open, setOpen] = useState<number | null>(null);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: log.length };
    for (const e of log) c[kindOf(e)] = (c[kindOf(e)] ?? 0) + 1;
    return c;
  }, [log]);
  const rows = filter === "all" ? log : log.filter((e) => kindOf(e) === filter);

  return (
    <section id="activity">
      <SectionHead
        index="02 · Audit trail"
        title="Every decision, on-chain"
        aside={
          <div className="flex gap-1 rounded-lg bg-sunken p-1" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-2.5 py-1 text-[13px] transition ${filter === f.key ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {f.label} <span className="tnum text-muted">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted">No {filter === "all" ? "" : FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} decisions yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((e) => {
              const kind = kindOf(e);
              const rs = reasons(e.reasons);
              const top = rs.filter((r) => r.tone === "bad" || r.tone === "warn").slice(0, 3);
              const isOpen = open === e.seq;
              return (
                <li key={e.seq}>
                  <button className="grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 px-5 py-4 text-left hover:bg-sunken/50" onClick={() => setOpen(isOpen ? null : e.seq)} aria-expanded={isOpen}>
                    <ToneIcon tone={KIND_TONE[kind]} size={28} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] font-medium">{headline(e)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                        <span className="flex items-center gap-1.5">
                          <AgentAvatar label={e.agent_label} size={16} />
                          {e.agent_label}
                        </span>
                        {(top.length ? top : rs.slice(0, 1)).map((r) => (
                          <span key={r.code} className={r.tone === "bad" ? "text-bad" : r.tone === "warn" ? "text-warn" : r.tone === "good" ? "text-good" : ""}>
                            {r.text}
                          </span>
                        ))}
                        {rs.length > top.length && top.length > 0 && <span>+{rs.length - top.length} more</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`tnum font-mono text-[15px] ${kind === "blocked" || kind === "failed" ? "text-muted line-through decoration-1" : ""}`}>
                        {amount(e.amount)} <span className="text-xs text-muted no-underline">{tokenName(e.token)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted" title={new Date(e.ts_ms).toISOString()}>
                        {ago(e.ts_ms)}
                      </div>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="grid gap-6 border-t border-line bg-sunken/40 px-5 py-4 text-[13px] sm:grid-cols-[230px_1fr] sm:pl-[60px]">
                      <dl className="grid content-start grid-cols-[90px_1fr] gap-x-2 gap-y-2">
                        <dt className="text-muted">Outcome</dt>
                        <dd>
                          <Pill tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</Pill>
                        </dd>
                        <dt className="text-muted">Risk score</dt>
                        <dd className="tnum">{e.score === null ? "verdict rejected" : `${e.score}/100 (${e.risk})`}</dd>
                        <dt className="text-muted">Recipient</dt>
                        <dd>
                          <a className="font-mono break-all underline decoration-line-strong underline-offset-4" href={explorerAccount(e.recipient)} target="_blank" rel="noreferrer">
                            {e.recipient}
                          </a>
                        </dd>
                        <dt className="text-muted">When</dt>
                        <dd>{stamp(e.ts_ms)}</dd>
                        <dt className="text-muted">Request · log</dt>
                        <dd className="font-mono">
                          #{e.request_id} · #{e.seq}
                        </dd>
                        {e.memo && (
                          <>
                            <dt className="text-muted">Memo</dt>
                            <dd className="font-mono">{e.memo}</dd>
                          </>
                        )}
                      </dl>
                      <div>
                        <div className="label mb-2">Why</div>
                        <ul className="space-y-1.5">
                          {rs.map((r) => (
                            <li key={r.code} className="flex items-baseline justify-between gap-3">
                              <span className={r.tone === "bad" ? "text-bad" : r.tone === "warn" ? "text-warn" : r.tone === "good" ? "text-good" : "text-muted"}>{r.text}</span>
                              <code className="shrink-0 text-[11px] text-muted">{r.code}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {total > log.length && <p className="border-t border-line px-5 py-3 text-xs text-muted">Showing the latest {log.length} of {total} decisions.</p>}
      </Card>
    </section>
  );
}
