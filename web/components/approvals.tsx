"use client";
import { explorerAccount } from "@/lib/config";
import { ago, amount, tokenName, until } from "@/lib/format";
import { reasons } from "@/lib/reasons";
import type { AgentView, Policy, SpendRequest } from "@/lib/types";
import { AgentBadge, Icon, RecipientBadge } from "./glyphs";
import { ArrowLink, Button, Card, CheckItem } from "./ui";

export type Act = (label: string, method: string, args: Record<string, unknown>) => Promise<void>;

export interface OwnerProps {
  isOwner: boolean;
  connected: boolean;
  busy: string | null;
  act: Act;
}

export function Approvals({ pending, agents, policy, ...owner }: OwnerProps & { pending: SpendRequest[]; agents: AgentView[]; policy: Policy }) {
  return (
    <section id="approvals" className="scroll-mt-20 border-b border-line py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
        <div>
          <div className="eyebrow">01 · Approvals</div>
          <h2 className="title mt-5 text-[40px] sm:text-[56px]">
            {pending.length ? (
              <>
                Nothing moves
                <br />
                until you say so.
              </>
            ) : (
              <>
                All clear.
                <br />
                Nothing is waiting.
              </>
            )}
          </h2>
          <p className="mt-6 max-w-md text-[17px] leading-[1.6] text-muted sm:text-[18px]">
            When the risk checker finds a payment unusual, the vault parks it instead of paying. You see why, then approve or reject with your
            wallet. Requests expire after 24 hours.
          </p>
          <div className="mt-8">
            <ArrowLink href="#activity">See every decision</ArrowLink>
          </div>
        </div>

        <div className="space-y-6">
          {pending.length === 0 ? (
            <Card className="p-7">
              <div className="flex items-center gap-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-good-bg text-good">
                  <Icon name="check" size={20} />
                </span>
                <div>
                  <div className="text-[17px] font-light">No requests waiting</div>
                  <div className="text-[14px] text-muted">Agents are paying inside your rules.</div>
                </div>
              </div>
            </Card>
          ) : (
            pending.map((p) => <Request key={p.id} req={p} agent={agents.find((a) => a.public_key === p.agent_pk)} policy={policy} {...owner} />)
          )}
        </div>
      </div>
    </section>
  );
}

function Request({ req, agent, policy, isOwner, connected, busy, act }: OwnerProps & { req: SpendRequest; agent?: AgentView; policy: Policy }) {
  const amt = BigInt(req.amount);
  const token = tokenName(req.token);
  const perTx = BigInt(agent?.per_tx_cap ?? policy.per_tx_cap);
  const remaining = agent ? BigInt(agent.remaining_today) : null;
  const flagged = reasons(req.reasons.filter((c) => c !== "RISK_WARN"));
  const approveLabel = `Approve #${req.id}`;
  const rejectLabel = `Reject #${req.id}`;
  const allowlisted = policy.allow_recipients.includes(req.recipient);

  return (
    <Card className="rise overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-7 py-4">
        <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-warn uppercase">
          <span className="blink h-1.5 w-1.5 rounded-full bg-warn" />
          Waiting for you
        </span>
        <span className="tnum text-[12px] text-muted">
          #{req.id} · {ago(req.created_ms)} · expires {until(req.expires_ms)}
        </span>
      </div>

      <div className="p-7">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AgentBadge label={req.agent_label} />
            <div>
              <div className="text-[16px] font-normal capitalize">{req.agent_label}</div>
              <div className="text-[13px] text-muted">wants to pay</div>
            </div>
          </div>
          <div className="text-right">
            <div className="tnum text-[40px] leading-none font-light tracking-[-0.03em]">{amount(amt)}</div>
            <div className="mt-1 text-[13px] text-muted">{token}</div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-xl bg-sunken px-4 py-3">
          <RecipientBadge kind={allowlisted ? "allowlisted" : "unknown"} size={36} />
          <div className="min-w-0 flex-1">
            <a className="block truncate font-mono text-[13px] text-ink hover:underline" href={explorerAccount(req.recipient)} target="_blank" rel="noreferrer">
              {req.recipient}
            </a>
            <div className="text-[12px] text-muted">{allowlisted ? "On your allowlist" : "Not on your allowlist"}</div>
          </div>
          {req.memo && <span className="font-mono text-[11px] text-muted">{req.memo}</span>}
        </div>

        <div className="mt-6">
          <div className="eyebrow-sm">Why it was held · risk {req.score}/100</div>
          <ul className="mt-3 space-y-2.5">
            {flagged.map((r) => (
              <CheckItem key={r.code} tone={r.tone}>
                {r.text}
              </CheckItem>
            ))}
            <CheckItem tone={amt <= perTx ? "good" : "bad"}>
              Within the {amount(perTx)} {token} per-payment cap
            </CheckItem>
            {remaining !== null && (
              <CheckItem tone={amt <= remaining ? "good" : "bad"}>
                Fits today&apos;s remaining budget of {amount(remaining)} {token}
              </CheckItem>
            )}
          </ul>
        </div>

        <div className="mt-7 grid grid-cols-[1fr_auto] gap-2.5">
          <Button variant="lime" size="lg" disabled={!isOwner || !!busy} onClick={() => act(approveLabel, "approve", { request_id: req.id })}>
            {busy === approveLabel ? "Confirm in your wallet…" : `Approve and pay ${amount(amt)} ${token}`}
          </Button>
          <Button variant="white" size="lg" disabled={!isOwner || !!busy} onClick={() => act(rejectLabel, "reject", { request_id: req.id })}>
            {busy === rejectLabel ? "Confirm…" : "Reject"}
          </Button>
        </div>
        {!isOwner && (
          <p className="mt-3 text-center text-[13px] text-muted">{connected ? "Only the vault owner can decide." : "Connect the owner wallet to decide."}</p>
        )}
      </div>
    </Card>
  );
}
