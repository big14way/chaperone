"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity } from "@/components/activity";
import { Approvals, type Act } from "@/components/approvals";
import { Agents, PolicySection } from "@/components/controls";
import { Icon, Wordmark } from "@/components/glyphs";
import { Showcase } from "@/components/showcase";
import { Button, LinkButton, Skeleton } from "@/components/ui";
import { NETWORK, VAULT_ID, explorerAccount, explorerTx } from "@/lib/config";
import { ago, amount, tokenName } from "@/lib/format";
import { kindOf } from "@/lib/reasons";
import { loadVault } from "@/lib/rpc";
import type { VaultSnapshot } from "@/lib/types";
import { WalletProvider, useWallet } from "@/lib/wallet";

type Notice = { kind: "ok" | "error" | "info"; text: string; tx?: string };

export default function Page() {
  return (
    <WalletProvider>
      <Dashboard />
    </WalletProvider>
  );
}

function Dashboard() {
  const wallet = useWallet();
  const [snap, setSnap] = useState<VaultSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnap(await loadVault());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const hashes = q.get("transactionHashes");
    const err = q.get("errorCode");
    if (hashes) setNotice({ kind: "ok", text: "Transaction sent.", tx: hashes.split(",").at(-1) });
    else if (err) setNotice({ kind: "error", text: `The wallet returned ${err}.` });
    if (hashes || err) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const isOwner = !!snap && wallet.accountId === snap.info.owner;
  const connected = !!wallet.accountId;

  const act: Act = useCallback(
    async (label, method, args) => {
      setBusy(label);
      setNotice({ kind: "info", text: `${label}: confirm in your wallet.` });
      try {
        const tx = await wallet.call(method, args);
        setNotice({ kind: "ok", text: `${label}: done.`, tx: tx ?? undefined });
        await refresh();
      } catch (e) {
        setNotice({ kind: "error", text: `${label}: ${(e as Error).message}` });
      } finally {
        setBusy(null);
      }
    },
    [wallet, refresh],
  );
  const owner = { isOwner, connected, busy, act };

  return (
    <div className="min-h-screen">
      <TopBar ownerId={snap?.info.owner} pending={snap?.pending.length ?? 0} />
      <Hero snap={snap} isOwner={isOwner} connected={connected} />

      {loadError && (
        <div className="mx-auto mt-8 max-w-6xl px-4 sm:px-6">
          <div className="rounded-md border border-bad/30 bg-bad-bg px-4 py-3 text-[14px] text-bad">Could not read the vault ({loadError}). Retrying.</div>
        </div>
      )}

      {!snap ? (
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <>
          <Showcase agent={snap.agents[0]} owner={snap.info.owner} policy={snap.policy} log={snap.log} />
          <Approvals pending={snap.pending} agents={snap.agents} policy={snap.policy} {...owner} />
          <Activity log={snap.log} total={snap.info.log_len} policy={snap.policy} />
          <Agents agents={snap.agents} policy={snap.policy} owner={snap.info.owner} {...owner} />
          <PolicySection policy={snap.policy} version={snap.info.policy_version} agents={snap.agents.length} tee={snap.tee} checkerPk={snap.info.checker_pk} {...owner} />
        </>
      )}

      <Footer fetchedAt={snap?.fetchedAt} />
      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- hero

function Hero({ snap, isOwner, connected }: { snap: VaultSnapshot | null; isOwner: boolean; connected: boolean }) {
  const pending = snap?.pending.length ?? 0;
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div className="grid-lines grid-fade pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28">
        <a
          href={explorerAccount(VAULT_ID)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 font-mono text-[12px] text-muted transition hover:text-ink"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-good" />
          {VAULT_ID} · live on NEAR {NETWORK}
          <Icon name="external" size={13} />
        </a>
        <h1 className="display mx-auto mt-8 max-w-4xl text-[40px] sm:text-[74px]">
          Give agents money,
          <br />
          not the keys
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-[17px] leading-[1.55] text-ink-2 sm:text-[18px]">
          A policy vault for AI agents on NEAR. Agents can only ask. Your rules decide, unusual payments wait for you, and every decision is
          on the record.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          {pending > 0 ? (
            <LinkButton variant="lime" href="#approvals">
              Review {pending} waiting request{pending > 1 ? "s" : ""}
            </LinkButton>
          ) : (
            <LinkButton variant="lime" href="#activity">
              View the audit trail
            </LinkButton>
          )}
          <LinkButton variant="white" href={explorerAccount(VAULT_ID)} target="_blank" rel="noreferrer">
            View contract
          </LinkButton>
        </div>
        {snap && !connected && <p className="mt-5 text-[13px] text-muted">Read-only. Anyone can audit this vault; only the owner can act.</p>}
        {snap && connected && !isOwner && <p className="mt-5 text-[13px] text-warn">This wallet is not the vault owner, so actions are disabled.</p>}

        <Stats snap={snap} />
      </div>
    </header>
  );
}

function Stats({ snap }: { snap: VaultSnapshot | null }) {
  const cells = snap
    ? (() => {
        const [token, balance] = Object.entries(snap.balances)[0] ?? ["", "0"];
        const t = tokenName(token);
        const spent = snap.agents.reduce((s, a) => s + BigInt(a.spent_today), 0n);
        const blocked = snap.log.filter((e) => kindOf(e) === "blocked");
        const blockedAmt = blocked.reduce((s, e) => s + BigInt(e.amount), 0n);
        const paid = snap.log.filter((e) => kindOf(e) === "paid").reduce((s, e) => s + BigInt(e.amount), 0n);
        return [
          { k: "Vault balance", v: amount(balance), u: t, sub: `${snap.info.agents} agents may ask to spend it` },
          { k: "Paid out", v: amount(paid), u: t, sub: `${amount(spent)} ${t} so far today` },
          { k: "Blocked", v: String(blocked.length), u: blocked.length === 1 ? "attempt" : "attempts", sub: `${amount(blockedAmt)} ${t} asked for, none sent` },
          { k: "Waiting for you", v: String(snap.pending.length), u: snap.pending.length === 1 ? "request" : "requests", sub: snap.pending.length ? "expires in 24 h" : "all clear" },
        ];
      })()
    : null;
  return (
    <div className="mx-auto mt-16 grid max-w-5xl grid-cols-2 border-t border-l border-line bg-surface/70 text-left backdrop-blur lg:grid-cols-4">
      {(cells ?? [0, 1, 2, 3]).map((c, i) => (
        <div key={i} className="border-r border-b border-line p-5 sm:p-6">
          {typeof c === "number" ? (
            <>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-4 h-8 w-20" />
            </>
          ) : (
            <>
              <div className="eyebrow-sm">{c.k}</div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="tnum text-[32px] leading-none font-light tracking-[-0.03em]">{c.v}</span>
                <span className="text-[14px] text-muted">{c.u}</span>
              </div>
              <div className="mt-2 text-[13px] text-muted">{c.sub}</div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- top bar

function TopBar({ ownerId, pending }: { ownerId?: string; pending: number }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("chaperone-theme", next ? "dark" : "light");
    } catch {
      // storage unavailable: theme still applies for this visit
    }
  };
  const isOwner = !!ownerId && wallet.accountId === ownerId;

  return (
    <div className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto grid h-[60px] max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-8">
        <a href="#" aria-label="Chaperone home">
          <Wordmark />
        </a>
        <nav className="hidden items-center gap-7 text-[15px] lg:flex">
          {[
            ["A", "Approvals", "#approvals"],
            ["L", "Audit trail", "#activity"],
            ["G", "Agents", "#agents"],
            ["P", "Policy", "#policy"],
          ].map(([k, label, href]) => (
            <a key={href} href={href} className="group flex items-center gap-1.5">
              <span className="font-mono text-[13px] text-muted">[{k}]</span>
              <span className="border-b border-transparent transition group-hover:border-ink">{label}</span>
              {k === "A" && pending > 0 && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-warn" />}
            </a>
          ))}
        </nav>
        <div className="flex items-center justify-end gap-2" ref={ref}>
          {wallet.accountId ? (
            <>
              <span className="hidden items-center gap-2 rounded-md border border-line bg-surface py-1.5 pr-1.5 pl-3 text-[13px] sm:flex">
                <span className={`h-1.5 w-1.5 rounded-full ${isOwner ? "bg-good" : "bg-warn"}`} />
                <span className="max-w-[200px] truncate">{wallet.accountId}</span>
                {isOwner && <span className="rounded bg-chip px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] uppercase">owner</span>}
              </span>
              <Button size="sm" variant="ghost" onClick={wallet.signOut}>
                Sign out
              </Button>
            </>
          ) : (
            <div className="relative">
              <Button variant="lime" disabled={!wallet.ready} onClick={() => setOpen((v) => !v)}>
                Connect wallet
              </Button>
              {open && (
                <div className="absolute top-full right-0 mt-2 w-72 rounded-2xl border border-line bg-surface p-2 shadow-card">
                  <div className="eyebrow-sm px-3 pt-2 pb-2">Sign in as the owner</div>
                  {wallet.options.map((o) => (
                    <button
                      key={o.id}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] hover:bg-sunken"
                      onClick={() => (setOpen(false), wallet.signIn(o.id))}
                    >
                      {o.iconUrl ? <img src={o.iconUrl} alt="" className="h-7 w-7 rounded-lg" /> : <span className="h-7 w-7 rounded-lg bg-chip" />}
                      {o.name}
                    </button>
                  ))}
                  <p className="px-3 pt-2 pb-2 text-[12px] leading-relaxed text-muted">Owner actions attach 1 yoctoNEAR, so your wallet asks you to confirm each one.</p>
                </div>
              )}
            </div>
          )}
          <button onClick={toggleTheme} className="flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-sunken" aria-label="Toggle dark mode">
            <Icon name={dark ? "sun" : "moon"} size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- footer & toast

function Footer({ fetchedAt }: { fetchedAt?: number }) {
  return (
    <footer className="relative overflow-hidden">
      <div className="grid-lines pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative mx-auto max-w-6xl px-4 py-24 text-center sm:px-6 sm:py-32">
        <h2 className="display text-[48px] sm:text-[80px]">Stay in control</h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <LinkButton variant="lime" href="#policy">
            Review the rules
          </LinkButton>
          <LinkButton variant="white" href={explorerAccount(VAULT_ID)} target="_blank" rel="noreferrer">
            Audit on NearBlocks
          </LinkButton>
        </div>
      </div>
      <div className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-line px-4 py-8 sm:px-6">
        <Wordmark />
        <div className="flex flex-wrap gap-6 font-mono text-[13px] text-muted">
          <span>Agents hold function-call keys: request_spend only</span>
          {fetchedAt && <span className="tnum">Synced {ago(fetchedAt)}</span>}
        </div>
      </div>
    </footer>
  );
}

function Toast({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  useEffect(() => {
    if (notice.kind === "info") return;
    const t = setTimeout(onClose, notice.kind === "error" ? 12000 : 8000);
    return () => clearTimeout(t);
  }, [notice, onClose]);
  const dot = { ok: "bg-good", error: "bg-bad", info: "bg-warn blink" }[notice.kind];
  return (
    <div className="fixed right-4 bottom-4 left-4 z-40 sm:left-auto sm:w-[380px]" role="status">
      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-[14px] shadow-card">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0 flex-1">
          <p className="break-words">{notice.text}</p>
          {notice.tx && (
            <a className="mt-1 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink" href={explorerTx(notice.tx)} target="_blank" rel="noreferrer">
              View transaction <Icon name="external" size={13} />
            </a>
          )}
        </div>
        <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Dismiss">
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
