"use client";
import { ago, amount, shortKey, tokenName } from "@/lib/format";
import { headline } from "@/lib/reasons";
import type { AgentView, LogEntry, Policy } from "@/lib/types";
import { AgentGlyph, Icon } from "./glyphs";
import { Meter } from "./ui";

/** The live agent card with callouts: who the agent is, what it may do, and what it did. */
export function Showcase({ agent, owner, policy, log }: { agent?: AgentView; owner: string; policy: Policy; log: LogEntry[] }) {
  if (!agent) return null;
  const token = tokenName(policy.allow_tokens[0] ?? "");
  const last = log.find((e) => e.agent_pk === agent.public_key);
  const spent = BigInt(agent.spent_today);
  const cap = BigInt(agent.daily_cap);

  return (
    <section className="border-b border-line py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="title text-[32px] sm:text-[40px]">Every agent gets a leash, not a key</h2>
          <p className="mt-4 text-[17px] leading-[1.55] text-muted sm:text-[18px]">
            Each agent has a name, an owner, a daily budget and a key that can only ask. The vault checks every request against your rules and
            writes the answer on-chain.
          </p>
        </div>

        <div className="mt-16 grid items-center gap-10 lg:grid-cols-[1fr_380px_1fr] lg:gap-0">
          <div className="hidden flex-col justify-around gap-40 self-stretch py-10 lg:flex">
            <Callout side="left" title="Identity" body="A named agent with its own key, answerable to one owner account." />
            <Callout side="left" title="Capabilities" body="A function-call key: it can call request_spend and nothing else. No deposits, no other contracts." />
          </div>

          <div className="rise relative mx-auto w-full max-w-[380px] rounded-2xl border border-white/60 bg-glass p-7 shadow-card backdrop-blur dark:border-line">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <AgentGlyph label={agent.label} size={30} />
                <span className="text-[19px] leading-7 font-light capitalize">{agent.label}</span>
              </div>
              <div className="text-right">
                <div className="eyebrow-sm">Owner</div>
                <div className="mt-0.5 max-w-[140px] truncate text-[12px] text-ink-2">{owner}</div>
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

            <ul className="mt-5 space-y-3 text-[13px]">
              <Li>Max {amount(agent.per_tx_cap)} {token} per payment</Li>
              <Li>
                {policy.allow_recipients.length} approved recipient{policy.allow_recipients.length === 1 ? "" : "s"}
              </Li>
              <Li>{policy.warn_requires_owner ? "Approval required for unusual payments" : "Unusual payments pass within caps"}</Li>
            </ul>

            <div className="mt-6 border-t border-line pt-5">
              <div className="eyebrow-sm">Key &amp; permissions</div>
              <dl className="mt-3 space-y-2.5 text-[13px]">
                <Row icon="key" k="Function-call key" v={shortKey(agent.public_key)} />
                <Row icon="bolt" k="Method" v="request_spend" />
                <Row icon="vault" k="Receiver" v="vault only" />
              </dl>
            </div>

            <div className="mt-6 border-t border-line pt-5">
              <div className="eyebrow-sm">Audit trail</div>
              {last ? (
                <div className="mt-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <span className="blink mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
                    <div>
                      <div className="text-[13px] leading-5">{headline(last).replace(/ to [a-z0-9._-]+(\.testnet|\.near)/, "")}</div>
                      <div className="text-[12px] text-muted">{last.recipient}</div>
                    </div>
                  </div>
                  <span className="shrink-0 text-[12px] text-muted">{ago(last.ts_ms)}</span>
                </div>
              ) : (
                <div className="mt-3 text-[13px] text-muted">No requests yet</div>
              )}
            </div>
          </div>

          <div className="hidden flex-col justify-around gap-40 self-stretch py-10 lg:flex">
            <Callout side="right" title="Policy" body="Budget, per-payment cap, recipient allowlist and a human approver before money moves." />
            <Callout side="right" title="Audit trail" body="Every request, allowed or refused, is recorded in the contract with its reasons." />
          </div>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:hidden">
          {[
            ["Identity", "A named agent with its own key, answerable to one owner account."],
            ["Policy", "Budget, per-payment cap, recipient allowlist and a human approver before money moves."],
            ["Capabilities", "A function-call key: request_spend only. No deposits, no other contracts."],
            ["Audit trail", "Every request, allowed or refused, is recorded in the contract with its reasons."],
          ].map(([t, b]) => (
            <div key={t}>
              <div className="eyebrow text-ink">{t}</div>
              <p className="mt-2 text-[14px] leading-5 text-muted">{b}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Callout({ side, title, body }: { side: "left" | "right"; title: string; body: string }) {
  const left = side === "left";
  return (
    <div className={`flex items-start gap-4 ${left ? "flex-row text-right" : "flex-row-reverse text-left"}`}>
      <div className="max-w-[240px] flex-1">
        <div className="eyebrow !text-ink">{title}</div>
        <p className="mt-2 text-[14px] leading-5 text-muted">{body}</p>
      </div>
      <span className="mt-2 flex w-14 items-center">
        {left ? (
          <>
            <span className="h-px flex-1 bg-line-strong" />
            <span className="h-[7px] w-[7px] rounded-full border border-line-strong bg-canvas" />
          </>
        ) : (
          <>
            <span className="h-[7px] w-[7px] rounded-full border border-line-strong bg-canvas" />
            <span className="h-px flex-1 bg-line-strong" />
          </>
        )}
      </span>
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-good-bg text-good">
        <Icon name="check" size={12} />
      </span>
      {children}
    </li>
  );
}

function Row({ icon, k, v }: { icon: "key" | "bolt" | "vault"; k: string; v: string }) {
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
