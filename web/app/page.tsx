"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity } from "@/components/activity";
import { Approvals, type Act } from "@/components/approvals";
import { Agents, KillSwitch, PolicyPanel } from "@/components/controls";
import { Button, Card, Logo, Skeleton } from "@/components/ui";
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

  // Redirect wallets come back with the result in the query string.
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
      <TopBar ownerId={snap?.info.owner} />

      <header className="grid-bg border-b border-line">
        <div className="mx-auto max-w-6xl px-4 pt-10 pb-8 sm:px-6 sm:pt-14">
          <div className="label">Vault · {NETWORK}</div>
          <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-[40px] sm:leading-[1.1]">
            Your agents ask.
            <br className="hidden sm:block" /> <span className="text-muted">The policy decides.</span>
          </h1>
          <a
            href={explorerAccount(VAULT_ID)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 font-mono text-[13px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
          >
            {VAULT_ID} ↗
          </a>
          <Stats snap={snap} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {loadError && (
          <Card className="mb-6 border-bad/30 bg-bad-bg p-4 text-sm text-bad">Could not read the vault: {loadError}. Retrying every few seconds.</Card>
        )}
        {!connected && snap && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm">
            <span className="text-muted">
              Read-only view. Anyone can audit this vault; only <span className="font-mono text-ink">{snap.info.owner}</span> can act.
            </span>
          </div>
        )}
        {connected && !isOwner && snap && (
          <div className="mb-6 rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">
            Connected as {wallet.accountId}, which is not the owner of this vault. Actions are disabled.
          </div>
        )}

        {!snap ? (
          <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
            <div className="space-y-4">
              <Skeleton className="h-56" />
              <Skeleton className="h-96" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-72" />
              <Skeleton className="h-64" />
            </div>
          </div>
        ) : (
          <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
            <div className="min-w-0 space-y-10">
              <Approvals pending={snap.pending} agents={snap.agents} policy={snap.policy} {...owner} />
              <Activity log={snap.log} total={snap.info.log_len} />
            </div>
            <aside className="space-y-10">
              <Agents agents={snap.agents} policy={snap.policy} {...owner} />
              <PolicyPanel policy={snap.policy} version={snap.info.policy_version} {...owner} />
              <KillSwitch agents={snap.agents.length} {...owner} />
            </aside>
          </div>
        )}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted sm:px-6">
          <span>Agents hold function-call keys that can only call request_spend. Every decision above is read from the contract.</span>
          {snap && <span className="tnum">Updated {ago(snap.fetchedAt)}</span>}
        </div>
      </footer>

      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
    </div>
  );
}

function Stats({ snap }: { snap: VaultSnapshot | null }) {
  if (!snap)
    return (
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface p-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-3 h-8 w-24" />
          </div>
        ))}
      </div>
    );
  const [token, balance] = Object.entries(snap.balances)[0] ?? ["", "0"];
  const spent = snap.agents.reduce((s, a) => s + BigInt(a.spent_today), 0n);
  const blocked = snap.log.filter((e) => kindOf(e) === "blocked");
  const blockedAmt = blocked.reduce((s, e) => s + BigInt(e.amount), 0n);
  const tiles = [
    { k: "Vault balance", v: amount(balance), u: tokenName(token), sub: `${snap.info.agents} agents can spend from it` },
    { k: "Spent today", v: amount(spent), u: tokenName(token), sub: "across all agents" },
    { k: "Blocked", v: String(blocked.length), u: blocked.length === 1 ? "attempt" : "attempts", sub: `${amount(blockedAmt)} ${tokenName(token)} requested, 0 sent`, tone: "text-bad" },
    {
      k: "Waiting for you",
      v: String(snap.pending.length),
      u: snap.pending.length === 1 ? "request" : "requests",
      sub: snap.pending.length ? "review below" : "all clear",
      tone: snap.pending.length ? "text-warn" : "",
    },
  ];
  return (
    <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.k} className="bg-surface p-4 sm:p-5">
          <div className="label">{t.k}</div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className={`tnum text-2xl font-medium tracking-tight sm:text-[28px] ${t.tone ?? ""}`}>{t.v}</span>
            <span className="text-sm text-muted">{t.u}</span>
          </div>
          <div className="mt-1 text-xs text-muted">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function TopBar({ ownerId }: { ownerId?: string }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const isOwner = !!ownerId && wallet.accountId === ownerId;

  return (
    <div className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Logo />
          <nav className="hidden items-center gap-5 font-mono text-[13px] text-muted md:flex">
            {[
              ["A", "Approvals", "#approvals"],
              ["L", "Audit trail", "#activity"],
              ["G", "Agents", "#agents"],
              ["P", "Policy", "#policy"],
            ].map(([k, label, href]) => (
              <a key={href} href={href} className="hover:text-ink">
                <span className="opacity-60">[{k}]</span> {label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2" ref={ref}>
          <span className="hidden rounded-full border border-line-strong px-2 py-0.5 font-mono text-[11px] tracking-wider text-muted uppercase sm:inline">{NETWORK}</span>
          {wallet.accountId ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-2 rounded-lg border border-line bg-surface py-1 pr-1 pl-3 text-[13px]">
                <span className={`h-1.5 w-1.5 rounded-full ${isOwner ? "bg-good" : "bg-warn"}`} />
                <span className="max-w-[220px] truncate font-mono">{wallet.accountId}</span>
                {isOwner && <span className="rounded-md bg-good-bg px-1.5 py-0.5 text-[11px] font-medium text-good">owner</span>}
              </span>
              <Button size="sm" variant="ghost" onClick={wallet.signOut}>
                Sign out
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Button size="sm" disabled={!wallet.ready} onClick={() => setOpen((v) => !v)}>
                Connect wallet
              </Button>
              {open && (
                <div className="absolute top-full right-0 mt-2 w-72 rounded-xl border border-line bg-surface p-2 shadow-xl">
                  <div className="label px-2 pt-1 pb-2">Sign in as the owner</div>
                  {wallet.options.map((o) => (
                    <button
                      key={o.id}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-sunken"
                      onClick={() => (setOpen(false), wallet.signIn(o.id))}
                    >
                      {o.iconUrl ? <img src={o.iconUrl} alt="" className="h-6 w-6 rounded-md" /> : <span className="h-6 w-6 rounded-md bg-sunken" />}
                      {o.name}
                    </button>
                  ))}
                  <p className="px-2 pt-2 pb-1 text-xs leading-relaxed text-muted">Each owner action attaches 1 yoctoNEAR, so your wallet asks you to confirm it.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Toast({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  useEffect(() => {
    if (notice.kind === "info") return;
    const t = setTimeout(onClose, notice.kind === "error" ? 12000 : 8000);
    return () => clearTimeout(t);
  }, [notice, onClose]);
  const dot = { ok: "bg-good", error: "bg-bad", info: "bg-warn live-dot" }[notice.kind];
  return (
    <div className="fixed right-4 bottom-4 left-4 z-30 sm:left-auto sm:w-96" role="status">
      <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-sm shadow-2xl">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0 flex-1">
          <p className="break-words">{notice.text}</p>
          {notice.tx && (
            <a className="mt-1 inline-block text-[13px] text-muted underline underline-offset-4 hover:text-ink" href={explorerTx(notice.tx)} target="_blank" rel="noreferrer">
              View transaction ↗
            </a>
          )}
        </div>
        <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}
