"use client";
import { useEffect, useState } from "react";
import { amount, fromUnits, shortKey, toUnits, tokenName } from "@/lib/format";
import type { AgentView, Policy } from "@/lib/types";
import type { OwnerProps } from "./approvals";
import { AgentAvatar, Button, Card, Check, Meter, SectionHead } from "./ui";

// ---------------------------------------------------------------- agents

export function Agents({ agents, policy, isOwner, busy, act }: OwnerProps & { agents: AgentView[]; policy: Policy }) {
  const token = tokenName(policy.allow_tokens[0] ?? "");
  return (
    <section id="agents">
      <SectionHead index="03 · Agents" title={agents.length ? `${agents.length} agent${agents.length > 1 ? "s" : ""} can ask to spend` : "No agents"} />
      {agents.length === 0 ? (
        <Card className="p-5 text-sm text-muted">Every agent key has been revoked. Add an agent with add_agent from the owner account.</Card>
      ) : (
        <div className="space-y-3">
          {agents.map((a) => {
            const spent = BigInt(a.spent_today);
            const cap = BigInt(a.daily_cap);
            return (
              <Card key={a.public_key} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <AgentAvatar label={a.label} size={40} />
                    <div>
                      <div className="text-[17px] font-medium tracking-tight">{a.label}</div>
                      <div className="font-mono text-xs text-muted" title={a.public_key}>
                        key {shortKey(a.public_key)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="label">Scope</div>
                    <div className="mt-0.5 font-mono text-xs">request_spend only</div>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-baseline justify-between text-sm">
                    <span className="text-muted">Budget today</span>
                    <span className="tnum font-mono">
                      {fromUnits(spent)} <span className="text-muted">of</span> {fromUnits(cap)} {token}
                    </span>
                  </div>
                  <Meter value={spent} max={cap} />
                </div>

                <ul className="mt-5 space-y-2">
                  <Check tone="good">Max {fromUnits(a.per_tx_cap)} {token} per payment</Check>
                  <Check tone="good">
                    Pays {policy.allow_recipients.length} allowlisted recipient{policy.allow_recipients.length === 1 ? "" : "s"} directly
                  </Check>
                  <Check tone="good">{policy.warn_requires_owner ? "Unusual payments wait for your approval" : "Unusual payments go through within caps"}</Check>
                  <Check tone="good">Cannot attach deposits or call any other contract</Check>
                  {a.pending_request !== null && <Check tone="warn">Request #{a.pending_request} is waiting for you</Check>}
                </ul>

                <div className="mt-5 flex justify-end border-t border-line pt-4">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!isOwner || !!busy}
                    onClick={() => act(`Revoke ${a.label}`, "revoke_agent", { public_key: a.public_key })}
                  >
                    {busy === `Revoke ${a.label}` ? "Confirm in your wallet…" : `Revoke ${a.label}`}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- policy

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
  if (daily === 0n) throw new Error("The daily budget must be above zero.");
  if (perTx > daily) throw new Error("The per-payment cap cannot be higher than the daily budget.");
  const hours = Number(d.timelockH);
  if (!Number.isFinite(hours) || hours < 0) throw new Error("The waiting period must be a number of hours.");
  const tokens = lines(d.tokens);
  if (tokens.length === 0) throw new Error("Allow at least one token.");
  return {
    daily_cap: daily.toString(),
    per_tx_cap: perTx.toString(),
    allow_recipients: lines(d.recipients),
    allow_tokens: tokens,
    new_recipient_timelock_ms: Math.round(hours * 3_600_000),
    warn_requires_owner: d.warnOwner,
  };
}

const hoursText = (ms: number) => (ms === 0 ? "No waiting period" : `${ms / 3_600_000 >= 1 ? +(ms / 3_600_000).toFixed(2) : +(ms / 60_000).toFixed(0)} ${ms >= 3_600_000 ? "h" : "min"}`);

export function PolicyPanel({ policy, version, isOwner, busy, act }: OwnerProps & { policy: Policy; version: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(policy));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) setDraft(toDraft(policy));
  }, [policy, editing]);

  const token = tokenName(policy.allow_tokens[0] ?? "");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => (setDraft((d) => ({ ...d, [k]: v })), setError(null));

  const save = async () => {
    let next: Policy;
    try {
      next = fromDraft(draft);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    await act("Save policy", "set_policy", { policy: next });
    setEditing(false);
  };

  const input =
    "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 font-mono text-sm outline-none transition focus:border-ink focus:ring-2 focus:ring-ink/10";

  return (
    <section id="policy">
      <SectionHead
        index="04 · Policy"
        title="Rules every payment must pass"
        aside={
          !editing && (
            <Button size="sm" variant="secondary" disabled={!isOwner} onClick={() => setEditing(true)}>
              Edit rules
            </Button>
          )
        }
      />
      <Card className="p-5">
        {!editing ? (
          <>
            <dl className="divide-y divide-line">
              <Rule k="Daily budget per agent" v={`${amount(policy.daily_cap)} ${token}`} />
              <Rule k="Max per payment" v={`${amount(policy.per_tx_cap)} ${token}`} />
              <div className="py-3 text-sm">
                <dt className="text-muted">Allowlisted recipients</dt>
                <dd className="mt-2 flex flex-wrap gap-1.5">
                  {policy.allow_recipients.length ? (
                    policy.allow_recipients.map((r) => (
                      <span key={r} className="rounded-md bg-sunken px-2 py-1 font-mono text-[12px] break-all">
                        {r}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted">None. Every recipient waits out the timelock.</span>
                  )}
                </dd>
              </div>
              <Rule k="New recipients wait" v={hoursText(policy.new_recipient_timelock_ms)} />
              <Rule k="Unusual payments" v={policy.warn_requires_owner ? "Wait for your approval" : "Pay within caps"} />
              <Rule k="Tokens" v={policy.allow_tokens.map(tokenName).join(", ")} />
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              All rules must pass. A rule can only block a payment; it never changes the amount or recipient. Policy version v{version}.
            </p>
          </>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Daily budget per agent (${token})`}>
                <input className={input} value={draft.daily} onChange={(e) => set("daily", e.target.value)} inputMode="decimal" />
              </Field>
              <Field label={`Max per payment (${token})`}>
                <input className={input} value={draft.perTx} onChange={(e) => set("perTx", e.target.value)} inputMode="decimal" />
              </Field>
            </div>
            <Field label="Allowlisted recipients, one per line" hint="Paid without the new-recipient waiting period.">
              <textarea className={`${input} h-20 py-2`} value={draft.recipients} onChange={(e) => set("recipients", e.target.value)} />
            </Field>
            <Field label="New-recipient waiting period (hours)" hint="0 turns it off.">
              <input className={input} value={draft.timelockH} onChange={(e) => set("timelockH", e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Allowed tokens (NEP-141 contracts), one per line">
              <textarea className={`${input} h-16 py-2 text-xs`} value={draft.tokens} onChange={(e) => set("tokens", e.target.value)} />
            </Field>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg bg-sunken px-4 py-3 text-sm">
              <span>
                Unusual payments wait for my approval
                <span className="block text-xs text-muted">Recommended. Off means warn-band payments go through within caps.</span>
              </span>
              <input type="checkbox" className="h-4 w-4 accent-[var(--ink)]" checked={draft.warnOwner} onChange={(e) => set("warnOwner", e.target.checked)} />
            </label>
            {error && <p className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button variant="ghost" disabled={!!busy} onClick={() => (setEditing(false), setError(null))}>
                Cancel
              </Button>
              <Button disabled={!isOwner || !!busy} onClick={save}>
                {busy === "Save policy" ? "Confirm in your wallet…" : "Save rules"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

function Rule({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-sm first:pt-0 last:pb-0">
      <dt className="text-muted">{k}</dt>
      <dd className="tnum text-right font-medium">{v}</dd>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- kill switch

export function KillSwitch({ agents, isOwner, busy, act }: OwnerProps & { agents: number }) {
  const [armed, setArmed] = useState(false);
  return (
    <Card className="border-bad/30 p-5">
      <div className="label text-bad">Kill switch</div>
      <p className="mt-2 text-sm text-ink-2">
        Delete every agent key and cancel every waiting request in one transaction. Agents cannot even sign afterwards. Funds stay in the vault.
      </p>
      <div className="mt-4">
        {armed ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={!!busy} onClick={() => (setArmed(false), act("Revoke all", "revoke_all", {}))}>
              Yes, revoke all {agents} agents
            </Button>
            <Button variant="ghost" onClick={() => setArmed(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" className="text-bad" disabled={!isOwner || !!busy || agents === 0} onClick={() => setArmed(true)}>
            {busy === "Revoke all" ? "Confirm in your wallet…" : "Revoke all agents"}
          </Button>
        )}
      </div>
    </Card>
  );
}
