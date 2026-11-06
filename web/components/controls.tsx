"use client";
import { useEffect, useState, type ReactNode } from "react";
import { amount, fromUnits, shortKey, toUnits, tokenName } from "@/lib/format";
import type { AgentView, Policy } from "@/lib/types";
import type { OwnerProps } from "./approvals";
import { AgentGlyph, Icon } from "./glyphs";
import { Button, Card, CheckItem, Meter } from "./ui";

// ---------------------------------------------------------------- agents

export function Agents({ agents, policy, owner, isOwner, busy, act }: OwnerProps & { agents: AgentView[]; policy: Policy; owner: string }) {
  const token = tokenName(policy.allow_tokens[0] ?? "");
  return (
    <section id="agents" className="scroll-mt-20 border-b border-line py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div>
            <div className="eyebrow">03 · Agents</div>
            <h2 className="title mt-5 text-[40px] sm:text-[56px]">
              {agents.length ? `${agents.length} agents, one vault,` : "No agents."}
              {agents.length > 0 && (
                <>
                  <br />
                  separate limits.
                </>
              )}
            </h2>
          </div>
          <p className="text-[17px] leading-[1.6] text-muted sm:text-[18px]">
            A swarm can share a treasury without sharing a budget. Each agent has its own daily cap and per-payment cap, and you can cut any
            one of them off without touching the rest.
          </p>
        </div>

        {agents.length === 0 ? (
          <Card className="mt-12 p-7 text-[15px] text-muted">Every agent key has been revoked. Add one from the owner account with add_agent.</Card>
        ) : (
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {agents.map((a) => {
              const spent = BigInt(a.spent_today);
              const cap = BigInt(a.daily_cap);
              const label = `Revoke ${a.label}`;
              return (
                <Card key={a.public_key} className="flex flex-col p-7">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <AgentGlyph label={a.label} size={30} />
                      <span className="text-[19px] leading-7 font-light capitalize">{a.label}</span>
                    </div>
                    <div className="text-right">
                      <div className="eyebrow-sm">Owner</div>
                      <div className="mt-0.5 max-w-[150px] truncate text-[12px] text-ink-2">{owner}</div>
                    </div>
                  </div>

                  <div className="mt-6 flex items-baseline justify-between text-[14px]">
                    <span>Budget</span>
                    <span className="tnum font-mono text-[14px]">
                      {amount(spent)} of {amount(cap)} {token} today
                    </span>
                  </div>
                  <div className="mt-2">
                    <Meter value={spent} max={cap} />
                  </div>

                  <ul className="mt-5 space-y-2.5">
                    <CheckItem tone="good">
                      Max {amount(a.per_tx_cap)} {token} per payment
                    </CheckItem>
                    <CheckItem tone="good">
                      {policy.allow_recipients.length} approved recipient{policy.allow_recipients.length === 1 ? "" : "s"}
                    </CheckItem>
                    <CheckItem tone="good">{policy.warn_requires_owner ? "Approval required for unusual payments" : "Unusual payments pass within caps"}</CheckItem>
                    {a.pending_request !== null && <CheckItem tone="warn">Request #{a.pending_request} is waiting for you</CheckItem>}
                  </ul>

                  <div className="mt-6 border-t border-line pt-5">
                    <div className="eyebrow-sm">Key &amp; permissions</div>
                    <dl className="mt-3 space-y-2.5 text-[13px]">
                      <KeyRow icon="key" k="Function-call key" v={shortKey(a.public_key)} />
                      <KeyRow icon="bolt" k="Method" v="request_spend" />
                      <KeyRow icon="vault" k="Can attach deposit" v="no" />
                    </dl>
                  </div>

                  <div className="mt-auto flex justify-end pt-6">
                    <Button size="sm" variant="white" disabled={!isOwner || !!busy} onClick={() => act(label, "revoke_agent", { public_key: a.public_key })}>
                      {busy === label ? "Confirm in your wallet…" : `Revoke ${a.label}`}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function KeyRow({ icon, k, v }: { icon: "key" | "bolt" | "vault"; k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2.5">
        <Icon name={icon} size={16} className="text-muted" />
        {k}
      </dt>
      <dd className="font-mono text-[12px] text-muted">{v}</dd>
    </div>
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

const waitText = (ms: number) => (ms === 0 ? "No waiting period" : ms >= 3_600_000 ? `${+(ms / 3_600_000).toFixed(2)} hours` : `${Math.round(ms / 60_000)} minutes`);

export function PolicySection({ policy, version, agents, isOwner, connected, busy, act }: OwnerProps & { policy: Policy; version: number; agents: number }) {
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

  const input = "w-full rounded-md border border-line bg-surface px-3 py-2.5 font-mono text-[14px] font-light outline-none transition focus:border-ink";

  return (
    <section id="policy" className="scroll-mt-20 border-b border-line py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl items-start gap-12 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
        <Card className="order-2 p-7 lg:order-1">
          {!editing ? (
            <>
              <div className="flex items-center justify-between">
                <div className="eyebrow-sm">Policy · v{version}</div>
                <Button size="sm" variant="white" disabled={!isOwner} onClick={() => setEditing(true)}>
                  Edit rules
                </Button>
              </div>
              <dl className="mt-4">
                <Rule k="Daily budget per agent" v={`${amount(policy.daily_cap)} ${token}`} />
                <Rule k="Max per payment" v={`${amount(policy.per_tx_cap)} ${token}`} />
                <Rule k="New recipients wait" v={waitText(policy.new_recipient_timelock_ms)} />
                <Rule k="Unusual payments" v={policy.warn_requires_owner ? "Wait for your approval" : "Pay within caps"} />
                <Rule k="Tokens" v={policy.allow_tokens.map(tokenName).join(", ")} />
                <div className="py-4">
                  <dt className="text-[14px]">Approved recipients</dt>
                  <dd className="mt-3 flex flex-wrap gap-2">
                    {policy.allow_recipients.length ? (
                      policy.allow_recipients.map((r) => (
                        <span key={r} className="rounded-md border border-line bg-sunken px-2.5 py-1 font-mono text-[12px] break-all">
                          {r}
                        </span>
                      ))
                    ) : (
                      <span className="text-[14px] text-muted">None. Every recipient waits out the timelock.</span>
                    )}
                  </dd>
                </div>
              </dl>
              {!isOwner && <p className="mt-2 text-[13px] text-muted">{connected ? "Only the owner can change the rules." : "Connect the owner wallet to change the rules."}</p>}
            </>
          ) : (
            <div className="space-y-5">
              <div className="eyebrow-sm">Edit policy</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Daily budget per agent (${token})`}>
                  <input className={input} value={draft.daily} onChange={(e) => set("daily", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label={`Max per payment (${token})`}>
                  <input className={input} value={draft.perTx} onChange={(e) => set("perTx", e.target.value)} inputMode="decimal" />
                </Field>
              </div>
              <Field label="Approved recipients, one per line" hint="Paid without the new-recipient waiting period.">
                <textarea className={`${input} h-20`} value={draft.recipients} onChange={(e) => set("recipients", e.target.value)} />
              </Field>
              <Field label="New-recipient waiting period (hours)" hint="0 turns it off.">
                <input className={input} value={draft.timelockH} onChange={(e) => set("timelockH", e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Allowed tokens (NEP-141 contracts), one per line">
                <textarea className={`${input} h-16 text-[12px]`} value={draft.tokens} onChange={(e) => set("tokens", e.target.value)} />
              </Field>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-sunken px-4 py-3 text-[14px]">
                <span>
                  Unusual payments wait for my approval
                  <span className="block text-[13px] text-muted">Recommended. Off means flagged payments go through within caps.</span>
                </span>
                <input type="checkbox" className="h-4 w-4 accent-[var(--ink)]" checked={draft.warnOwner} onChange={(e) => set("warnOwner", e.target.checked)} />
              </label>
              {error && <p className="rounded-md bg-bad-bg px-3 py-2 text-[14px] text-bad">{error}</p>}
              <div className="flex justify-end gap-2 border-t border-line pt-5">
                <Button variant="ghost" disabled={!!busy} onClick={() => (setEditing(false), setError(null))}>
                  Cancel
                </Button>
                <Button variant="lime" disabled={!isOwner || !!busy} onClick={save}>
                  {busy === "Save policy" ? "Confirm in your wallet…" : "Save rules"}
                </Button>
              </div>
            </div>
          )}
        </Card>

        <div className="order-1 lg:order-2 lg:pt-6">
          <div className="eyebrow">04 · Policy</div>
          <h2 className="title mt-5 text-[40px] sm:text-[56px]">Rules can only say no.</h2>
          <p className="mt-6 text-[17px] leading-[1.6] text-muted sm:text-[18px]">
            Every payment must pass every rule. A rule can block a payment, never change its amount or where it goes. The contract enforces
            them, so a compromised agent cannot talk its way around them.
          </p>
          <KillSwitch agents={agents} isOwner={isOwner} connected={connected} busy={busy} act={act} />
        </div>
      </div>
    </section>
  );
}

function Rule({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-4 text-[14px]">
      <dt>{k}</dt>
      <dd className="tnum text-right font-mono text-[14px]">{v}</dd>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

function KillSwitch({ agents, isOwner, busy, act }: OwnerProps & { agents: number }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="mt-10 rounded-2xl border border-bad/25 bg-bad-bg/40 p-6">
      <div className="eyebrow !text-bad">Kill switch</div>
      <p className="mt-3 text-[15px] leading-6 text-ink-2">
        One transaction deletes every agent key and cancels every waiting request. Agents cannot even sign afterwards. Funds stay in the vault.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {armed ? (
          <>
            <Button variant="danger" disabled={!!busy} onClick={() => (setArmed(false), act("Revoke all", "revoke_all", {}))}>
              Yes, revoke all {agents} agents
            </Button>
            <Button variant="ghost" onClick={() => setArmed(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="white" className="!text-bad" disabled={!isOwner || !!busy || agents === 0} onClick={() => setArmed(true)}>
            {busy === "Revoke all" ? "Confirm in your wallet…" : "Revoke all agents"}
          </Button>
        )}
      </div>
    </div>
  );
}
