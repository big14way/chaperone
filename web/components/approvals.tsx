"use client";
import { explorerAccount } from "@/lib/config";
import { ago, amount, tokenName, until } from "@/lib/format";
import { reasons } from "@/lib/reasons";
import type { AgentView, Policy, SpendRequest } from "@/lib/types";
import { AgentAvatar, Button, Card, Check, SectionHead } from "./ui";

export type Act = (label: string, method: string, args: Record<string, unknown>) => Promise<void>;

export interface OwnerProps {
  isOwner: boolean;
  connected: boolean;
  busy: string | null;
  act: Act;
}

export function Approvals({
  pending,
  agents,
  policy,
  ...owner
}: OwnerProps & { pending: SpendRequest[]; agents: AgentView[]; policy: Policy }) {
  return (
    <section id="approvals">
      <SectionHead
        index="01 · Needs you"
        title={pending.length ? `${pending.length} payment${pending.length > 1 ? "s" : ""} waiting for approval` : "Nothing waiting for you"}
      />
      {pending.length === 0 ? (
        <Card className="flex items-center gap-4 p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-good-bg text-good">
            <svg width="18" height="18" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M2.5 6.2l2.3 2.3 4.7-4.9" />
            </svg>
          </span>
          <p className="text-sm text-muted">
            When the risk checker flags a payment as unusual, the vault holds it here instead of paying. Nothing moves until you decide.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {pending.map((p) => (
            <Request key={p.id} req={p} agent={agents.find((a) => a.public_key === p.agent_pk)} policy={policy} {...owner} />
          ))}
        </div>
      )}
    </section>
  );
}

function Request({ req, agent, policy, isOwner, connected, busy, act }: OwnerProps & { req: SpendRequest; agent?: AgentView; policy: Policy }) {
  const amt = BigInt(req.amount);
  const perTx = BigInt(agent?.per_tx_cap ?? policy.per_tx_cap);
  const remaining = agent ? BigInt(agent.remaining_today) : null;
  const flagged = reasons(req.reasons.filter((c) => c !== "RISK_WARN"));
  const approveLabel = `Approve #${req.id}`;
  const rejectLabel = `Reject #${req.id}`;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-warn-bg/60 px-5 py-2.5">
        <span className="flex items-center gap-2 text-[13px] font-medium text-warn">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-warn" />
          Held for review · risk score {req.score}/100
        </span>
        <span className="tnum text-xs text-muted">
          request #{req.id} · {ago(req.created_ms)} · expires {until(req.expires_ms)}
        </span>
      </div>

      <div className="grid gap-6 p-5 md:grid-cols-[1fr_280px]">
        <div>
          <div className="flex items-center gap-3">
            <AgentAvatar label={req.agent_label} />
            <div className="text-[15px] leading-snug">
              <span className="font-medium">{req.agent_label}</span> <span className="text-muted">wants to pay</span>
              <div>
                <a className="font-mono text-[13px] underline decoration-line-strong underline-offset-4 hover:decoration-ink" href={explorerAccount(req.recipient)} target="_blank" rel="noreferrer">
                  {req.recipient}
                </a>
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-baseline gap-2">
            <span className="tnum text-4xl font-medium tracking-tight">{amount(amt)}</span>
            <span className="text-lg text-muted">{tokenName(req.token)}</span>
            {req.memo && <span className="ml-2 rounded-md bg-sunken px-2 py-0.5 font-mono text-xs text-muted">{req.memo}</span>}
          </div>

          <ul className="mt-5 space-y-2">
            {flagged.map((r) => (
              <Check key={r.code} tone={r.tone}>
                {r.text}
              </Check>
            ))}
            <Check tone={amt <= perTx ? "good" : "bad"}>
              Within the {amount(perTx)} {tokenName(req.token)} per-payment cap
            </Check>
            {remaining !== null && (
              <Check tone={amt <= remaining ? "good" : "bad"}>
                Fits today&apos;s remaining budget ({amount(remaining)} left)
              </Check>
            )}
          </ul>
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-xl bg-sunken p-4">
          <p className="text-[13px] leading-relaxed text-muted">
            Approving pays the recipient from the vault and counts toward {req.agent_label}&apos;s daily budget. Rejecting closes the request; the agent can ask again.
          </p>
          <div className="space-y-2">
            <Button size="lg" className="w-full" disabled={!isOwner || !!busy} onClick={() => act(approveLabel, "approve", { request_id: req.id })}>
              {busy === approveLabel ? "Confirm in your wallet…" : `Approve and pay ${amount(amt)} ${tokenName(req.token)}`}
            </Button>
            <Button size="lg" variant="secondary" className="w-full" disabled={!isOwner || !!busy} onClick={() => act(rejectLabel, "reject", { request_id: req.id })}>
              {busy === rejectLabel ? "Confirm in your wallet…" : "Reject"}
            </Button>
            {!isOwner && (
              <p className="pt-1 text-center text-xs text-muted">{connected ? "Only the vault owner can decide." : "Connect the owner wallet to decide."}</p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
