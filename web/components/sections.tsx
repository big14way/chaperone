"use client";
import { useEffect, useState } from "react";
import { explorerAccount } from "@/lib/config";
import { ago, fromUnits, shortKey, stamp, toUnits, tokenName, until } from "@/lib/format";
import type { AgentView, LogEntry, Policy, SpendRequest } from "@/lib/types";
import { Button, Mono, OutcomeBadge, Reason, Section } from "./ui";

export type Act = (label: string, method: string, args: Record<string, unknown>) => Promise<void>;

interface OwnerProps {
  isOwner: boolean;
  busy: string | null;
  act: Act;
}

// ---------------------------------------------------------------- pending approvals

export function Pending({ pending, isOwner, busy, act }: OwnerProps & { pending: SpendRequest[] }) {
  return (
    <Section
      title="Waiting for the owner"
      aside={<span className="text-xs text-stone-500">{pending.length} open · warn-band requests park here</span>}
    >
      {pending.length === 0 ? (
        <p className="text-sm text-stone-500">Nothing waiting. Requests the checker rates WARN appear here until you approve or reject them.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((p) => (
            <li key={p.id} className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-base">
                  <span className="font-semibold">{p.agent_label}</span> wants to pay{" "}
                  <span className="font-semibold">
                    {fromUnits(p.amount)} {tokenName(p.token)}
                  </span>{" "}
                  to{" "}
                  <a className="font-mono underline decoration-dotted" href={explorerAccount(p.recipient)} target="_blank" rel="noreferrer">
                    {p.recipient}
                  </a>
                </div>
                <span className="text-xs text-stone-500">
                  request #{p.id} · {ago(p.created_ms)} · expires {until(p.expires_ms)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-stone-500">risk score {p.score}</span>
                {p.memo && <span className="text-xs text-stone-500">memo “{p.memo}”</span>}
                {p.reasons.map((r) => (
                  <Reason key={r} code={r} />
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button disabled={!isOwner || !!busy} onClick={() => act(`Approve #${p.id}`, "approve", { request_id: p.id })}>
                  {busy === `Approve #${p.id}` ? "Waiting for wallet…" : "Approve and pay"}
                </Button>
                <Button tone="ghost" disabled={!isOwner || !!busy} onClick={() => act(`Reject #${p.id}`, "reject", { request_id: p.id })}>
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- policy editor

interface Draft {
  daily: string;
  perTx: string;
  recipients: string;
  tokens: string;
  timelockH: string;
  warnOwner: boolean;
}

const toDraft = (p: Policy): Draft => ({
  daily: fromUnits(p.daily_cap),
  perTx: fromUnits(p.per_tx_cap),
  recipients: p.allow_recipients.join("\n"),
  tokens: p.allow_tokens.join("\n"),
  timelockH: String(p.new_recipient_timelock_ms / 3_600_000),
  warnOwner: p.warn_requires_owner,
});

const lines = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function fromDraft(d: Draft): Policy {
  const daily = toUnits(d.daily);
  const perTx = toUnits(d.perTx);
  if (perTx > daily) throw new Error("per-payment cap cannot exceed the daily cap");
  const hours = Number(d.timelockH);
  if (!Number.isFinite(hours) || hours < 0) throw new Error("timelock must be a number of hours");
  const tokens = lines(d.tokens);
  if (tokens.length === 0) throw new Error("allow at least one token");
  return {
    daily_cap: daily.toString(),
    per_tx_cap: perTx.toString(),
    allow_recipients: lines(d.recipients),
    allow_tokens: tokens,
    new_recipient_timelock_ms: Math.round(hours * 3_600_000),
    warn_requires_owner: d.warnOwner,
  };
}

export function PolicyEditor({ policy, isOwner, busy, act }: OwnerProps & { policy: Policy }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(policy));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) setDraft(toDraft(policy));
  }, [policy, dirty]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
    setError(null);
  };

  const save = async () => {
    try {
      const next = fromDraft(draft);
      await act("Save policy", "set_policy", { policy: next });
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const field = "w-full rounded-md border border-stone-300 bg-transparent px-2 py-1.5 font-mono text-sm dark:border-stone-700 disabled:opacity-70";
  const label = "mb-1 block text-xs font-medium text-stone-500";
  return (
    <Section title="Policy" aside={<span className="text-xs text-stone-500">every caveat must pass · a rule can only block</span>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={label}>Daily cap per agent (USDC)</span>
          <input className={field} value={draft.daily} disabled={!isOwner} onChange={(e) => set("daily", e.target.value)} inputMode="decimal" />
        </label>
        <label>
          <span className={label}>Per-payment cap (USDC)</span>
          <input className={field} value={draft.perTx} disabled={!isOwner} onChange={(e) => set("perTx", e.target.value)} inputMode="decimal" />
        </label>
        <label>
          <span className={label}>Allowlisted recipients (skip the timelock), one per line</span>
          <textarea className={`${field} h-20`} value={draft.recipients} disabled={!isOwner} onChange={(e) => set("recipients", e.target.value)} />
        </label>
        <label>
          <span className={label}>Allowed tokens (NEP-141), one per line</span>
          <textarea className={`${field} h-20 text-xs`} value={draft.tokens} disabled={!isOwner} onChange={(e) => set("tokens", e.target.value)} />
        </label>
        <label>
          <span className={label}>New-recipient timelock (hours, 0 = off)</span>
          <input className={field} value={draft.timelockH} disabled={!isOwner} onChange={(e) => set("timelockH", e.target.value)} inputMode="decimal" />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={draft.warnOwner} disabled={!isOwner} onChange={(e) => set("warnOwner", e.target.checked)} />
          WARN requests wait for owner approval
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button disabled={!isOwner || !dirty || !!busy} onClick={save}>
          {busy === "Save policy" ? "Waiting for wallet…" : "Save policy"}
        </Button>
        {dirty && (
          <Button tone="ghost" disabled={!!busy} onClick={() => (setDraft(toDraft(policy)), setDirty(false), setError(null))}>
            Discard
          </Button>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- agents

export function Agents({ agents, isOwner, busy, act }: OwnerProps & { agents: AgentView[] }) {
  const [confirmAll, setConfirmAll] = useState(false);
  return (
    <Section
      title="Agents"
      aside={
        confirmAll ? (
          <span className="flex items-center gap-2 text-xs">
            Delete every agent key and cancel parked requests?
            <Button tone="danger" disabled={!!busy} onClick={() => (setConfirmAll(false), act("Revoke all", "revoke_all", {}))}>
              Yes, revoke all
            </Button>
            <Button tone="ghost" onClick={() => setConfirmAll(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button tone="danger" disabled={!isOwner || !!busy || agents.length === 0} onClick={() => setConfirmAll(true)}>
            Kill switch: revoke all
          </Button>
        )
      }
    >
      {agents.length === 0 ? (
        <p className="text-sm text-stone-500">No agents. Every agent key has been revoked.</p>
      ) : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-800">
          {agents.map((a) => {
            const spent = BigInt(a.spent_today);
            const cap = BigInt(a.daily_cap);
            const pct = cap > 0n ? Number((spent * 100n) / cap) : 0;
            return (
              <li key={a.public_key} className="flex flex-wrap items-center gap-4 py-3">
                <div className="min-w-32">
                  <div className="font-semibold">{a.label}</div>
                  <Mono title={a.public_key}>{shortKey(a.public_key)}</Mono>
                </div>
                <div className="min-w-48 flex-1">
                  <div className="flex justify-between text-xs text-stone-500">
                    <span>
                      spent today {fromUnits(a.spent_today)} / {fromUnits(a.daily_cap)} USDC
                    </span>
                    <span>max {fromUnits(a.per_tx_cap)} per payment</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-stone-200 dark:bg-stone-800">
                    <div className="h-1.5 rounded bg-stone-800 dark:bg-stone-200" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
                <div className="text-xs text-stone-500">
                  key: function-call · <span className="font-mono">request_spend</span> only
                  {a.pending_request !== null && <span className="ml-2 text-amber-600">request #{a.pending_request} waiting</span>}
                </div>
                <Button tone="ghost" disabled={!isOwner || !!busy} onClick={() => act(`Revoke ${a.label}`, "revoke_agent", { public_key: a.public_key })}>
                  Revoke
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- decision log

export function DecisionLog({ log, total }: { log: LogEntry[]; total: number }) {
  return (
    <Section title="Decision log" aside={<span className="text-xs text-stone-500">on-chain, newest first · {total} entries</span>}>
      {log.length === 0 ? (
        <p className="text-sm text-stone-500">No decisions yet.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-500">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">when</th>
                <th className="px-2 py-2 font-medium">agent</th>
                <th className="px-2 py-2 font-medium">decision</th>
                <th className="px-2 py-2 text-right font-medium">amount</th>
                <th className="px-2 py-2 font-medium">recipient</th>
                <th className="px-2 py-2 font-medium">transfer</th>
                <th className="px-4 py-2 font-medium">reasons</th>
              </tr>
            </thead>
            <tbody>
              {log.map((e) => (
                <tr key={e.seq} className="border-t border-stone-100 align-top dark:border-stone-800">
                  <td className="px-4 py-2 font-mono text-xs text-stone-500">{e.seq}</td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap text-stone-500" title={new Date(e.ts_ms).toISOString()}>
                    {stamp(e.ts_ms)}
                  </td>
                  <td className="px-2 py-2">{e.agent_label}</td>
                  <td className="px-2 py-2">
                    <OutcomeBadge outcome={e.outcome} />
                    {e.score !== null && <span className="ml-1.5 text-xs text-stone-500">{e.score}</span>}
                  </td>
                  <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                    {fromUnits(e.amount)} <span className="text-xs text-stone-500">{tokenName(e.token)}</span>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">{e.recipient}</td>
                  <td className="px-2 py-2 text-xs">
                    {e.transfer === "failed" ? <span className="text-red-600">failed</span> : (e.transfer ?? "–")}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex max-w-md flex-wrap gap-x-2">
                      {e.reasons.map((r) => (
                        <Reason key={r} code={r} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
