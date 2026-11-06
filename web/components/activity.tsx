"use client";
import { Fragment, useMemo, useState } from "react";
import { explorerAccount } from "@/lib/config";
import { ago, amount, stamp, tokenName } from "@/lib/format";
import { kindOf, reasons, type Kind } from "@/lib/reasons";
import type { LogEntry, Policy } from "@/lib/types";
import { AgentGlyph, RecipientBadge } from "./glyphs";
import { Tag } from "./ui";

const FILTERS: Array<{ key: "all" | Kind; label: string }> = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "blocked", label: "Blocked" },
  { key: "held", label: "Held" },
];
const TONE = { paid: "good", blocked: "bad", held: "warn", closed: "neutral", failed: "bad" } as const;
const LABEL = { paid: "Paid", blocked: "Blocked", held: "Held", closed: "Closed", failed: "Failed" } as const;

export function Activity({ log, total, policy }: { log: LogEntry[]; total: number; policy: Policy }) {
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [open, setOpen] = useState<number | null>(null);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: log.length };
    for (const e of log) c[kindOf(e)] = (c[kindOf(e)] ?? 0) + 1;
    return c;
  }, [log]);
  const blocklisted = useMemo(() => new Set(log.filter((e) => e.reasons.includes("BLOCKLISTED")).map((e) => e.recipient)), [log]);
  const rows = filter === "all" ? log : log.filter((e) => kindOf(e) === filter);
  const recipientKind = (r: string) => (blocklisted.has(r) ? "blocked" : policy.allow_recipients.includes(r) ? "allowlisted" : "unknown");

  return (
    <section id="activity" className="scroll-mt-20 border-b border-line py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
          <div className="max-w-xl">
            <div className="eyebrow">02 · Audit trail</div>
            <h2 className="title mt-5 text-[40px] sm:text-[56px]">Every decision, on the record.</h2>
            <p className="mt-6 text-[17px] leading-[1.6] text-muted sm:text-[18px]">
              Read straight from the vault contract. Each line says what the agent asked for, what the vault decided, and why.
            </p>
          </div>
          <div className="flex gap-1 self-end rounded-lg border border-line bg-surface p-1" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-3 py-1.5 text-[13px] transition ${filter === f.key ? "bg-ink text-canvas" : "text-muted hover:text-ink"}`}
              >
                {f.label} <span className="tnum opacity-60">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-12 overflow-x-auto border border-line bg-surface shadow-card">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[13px] text-muted">
                <th className="px-5 py-3 font-light">Recipient</th>
                <th className="px-3 py-3 font-light">Agent</th>
                <th className="px-3 py-3 font-light">Decision</th>
                <th className="px-3 py-3 text-right font-light">Amount</th>
                <th className="px-5 py-3 font-light">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-[15px] text-muted">
                    Nothing here yet.
                  </td>
                </tr>
              )}
              {rows.map((e) => {
                const kind = kindOf(e);
                const rs = reasons(e.reasons);
                const lead = kind === "paid" ? (rs.find((r) => r.code === "OWNER_APPROVED") ?? rs.find((r) => r.tone === "good") ?? rs[0]) : (rs.find((r) => r.tone === "bad" || r.tone === "warn") ?? rs[0]);
                const isOpen = open === e.seq;
                const kindR = recipientKind(e.recipient);
                return (
                  <Fragment key={e.seq}>
                    <tr
                      className={`cursor-pointer border-b border-line transition hover:bg-sunken/60 ${isOpen ? "bg-sunken/60" : ""}`}
                      onClick={() => setOpen(isOpen ? null : e.seq)}
                      aria-expanded={isOpen}
                    >
                      <td className="px-5 py-5">
                        <div className="flex items-center gap-3">
                          <RecipientBadge kind={kindR} size={44} />
                          <div className="min-w-0">
                            <div className="truncate text-[16px] font-normal">{e.recipient.replace(/\.(testnet|near)$/, "")}</div>
                            <div className="text-[13px] text-muted">{kindR === "allowlisted" ? "Allowlisted vendor" : kindR === "blocked" ? "Blocklisted" : "Unknown account"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-5">
                        <div className="flex items-center gap-3">
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-chip">
                            <AgentGlyph label={e.agent_label} size={26} />
                          </span>
                          <div>
                            <div className="text-[16px] font-normal capitalize">{e.agent_label}</div>
                            <div className="text-[13px] text-muted">via function-call key</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-5">
                        <Tag tone={TONE[kind]}>{LABEL[kind]}</Tag>
                        {lead && (
                          <div className={`mt-1.5 max-w-[240px] text-[13px] leading-5 ${lead.tone === "bad" ? "text-bad" : lead.tone === "warn" ? "text-warn" : lead.tone === "good" ? "text-good" : "text-muted"}`}>
                            {lead.text}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-5 text-right whitespace-nowrap">
                        <span className={`tnum text-[16px] font-normal ${kind === "blocked" ? "text-muted line-through decoration-1" : ""}`}>{amount(e.amount)}</span>
                        <span className="ml-1 text-[13px] text-muted">{tokenName(e.token)}</span>
                      </td>
                      <td className="px-5 py-5 text-[15px] whitespace-nowrap" title={new Date(e.ts_ms).toISOString()}>
                        {stamp(e.ts_ms)}
                        <div className="text-[13px] text-muted">{ago(e.ts_ms)}</div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line bg-sunken/60">
                        <td colSpan={5} className="px-5 pt-1 pb-6">
                          <div className="grid gap-8 pl-14 md:grid-cols-[260px_1fr]">
                            <dl className="grid grid-cols-[100px_1fr] content-start gap-y-2 text-[13px]">
                              <dt className="text-muted">Risk score</dt>
                              <dd className="tnum">{e.score === null ? "verdict rejected" : `${e.score} / 100 · ${e.risk}`}</dd>
                              <dt className="text-muted">Recipient</dt>
                              <dd>
                                <a className="font-mono break-all hover:underline" href={explorerAccount(e.recipient)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                                  {e.recipient}
                                </a>
                              </dd>
                              <dt className="text-muted">Transfer</dt>
                              <dd>{e.transfer ?? "none"}</dd>
                              <dt className="text-muted">Request</dt>
                              <dd className="font-mono">#{e.request_id}</dd>
                              {e.memo && (
                                <>
                                  <dt className="text-muted">Memo</dt>
                                  <dd className="font-mono">{e.memo}</dd>
                                </>
                              )}
                            </dl>
                            <div>
                              <div className="eyebrow-sm">All reasons</div>
                              <ul className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
                                {rs.map((r) => (
                                  <li key={r.code} className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                                    <span className={r.tone === "bad" ? "text-bad" : r.tone === "warn" ? "text-warn" : r.tone === "good" ? "text-good" : "text-muted"}>{r.text}</span>
                                    <code className="shrink-0 font-mono text-[10px] text-muted">{r.code}</code>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {total > log.length && <p className="mt-4 text-[13px] text-muted">Showing the latest {log.length} of {total} decisions.</p>}
      </div>
    </section>
  );
}
