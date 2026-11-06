"use client";
import { useCallback, useEffect, useState } from "react";
import { Agents, DecisionLog, Pending, PolicyEditor, type Act } from "@/components/sections";
import { Button, Mono } from "@/components/ui";
import { NETWORK, VAULT_ID, explorerAccount, explorerTx } from "@/lib/config";
import { fromUnits, tokenName } from "@/lib/format";
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
  const [picker, setPicker] = useState(false);

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

  // Redirect wallets (MyNearWallet) come back with the result in the query string.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const hashes = q.get("transactionHashes");
    const err = q.get("errorCode");
    if (hashes) setNotice({ kind: "ok", text: "Transaction sent from the wallet.", tx: hashes.split(",").at(-1) });
    else if (err) setNotice({ kind: "error", text: `Wallet returned ${err}${q.get("errorMessage") ? `: ${decodeURIComponent(q.get("errorMessage")!)}` : ""}` });
    if (hashes || err) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const isOwner = !!snap && wallet.accountId === snap.info.owner;

  const act: Act = useCallback(
    async (label, method, args) => {
      setBusy(label);
      setNotice({ kind: "info", text: `${label}: confirm in your wallet…` });
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

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Chaperone</h1>
          <p className="text-sm text-stone-500">The agent asks, the policy decides, the owner stays in control.</p>
        </div>
        <div className="relative flex items-center gap-2">
          {wallet.accountId ? (
            <>
              <span className="text-sm">
                <Mono>{wallet.accountId}</Mono>
                {snap && (
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${isOwner ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-stone-200 dark:bg-stone-800"}`}>
                    {isOwner ? "owner" : "not the owner"}
                  </span>
                )}
              </span>
              <Button tone="ghost" onClick={wallet.signOut}>
                Sign out
              </Button>
            </>
          ) : (
            <Button disabled={!wallet.ready} onClick={() => setPicker((v) => !v)}>
              Connect owner wallet
            </Button>
          )}
          {picker && !wallet.accountId && (
            <div className="absolute top-full right-0 z-10 mt-2 w-64 rounded-lg border border-stone-200 bg-white p-2 shadow-lg dark:border-stone-700 dark:bg-stone-900">
              {wallet.options.map((o) => (
                <button
                  key={o.id}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800"
                  onClick={() => (setPicker(false), wallet.signIn(o.id).catch((e) => setNotice({ kind: "error", text: (e as Error).message })))}
                >
                  {o.iconUrl && <img src={o.iconUrl} alt="" className="h-5 w-5" />}
                  {o.name}
                </button>
              ))}
              <p className="px-2 pt-2 text-xs text-stone-500">Owner actions attach 1 yoctoNEAR, so the wallet asks you to confirm each one.</p>
            </div>
          )}
        </div>
      </header>

      <div className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:grid-cols-4 dark:border-stone-800 dark:bg-stone-900">
        <Stat label={`Vault · ${NETWORK}`}>
          <a className="font-mono underline decoration-dotted" href={explorerAccount(VAULT_ID)} target="_blank" rel="noreferrer">
            {VAULT_ID}
          </a>
        </Stat>
        <Stat label="Balance">
          {snap
            ? Object.entries(snap.balances).map(([t, b]) => (
                <div key={t} className="font-mono">
                  {fromUnits(b)} {tokenName(t)}
                </div>
              ))
            : "…"}
        </Stat>
        <Stat label="Owner">{snap ? <Mono>{snap.info.owner}</Mono> : "…"}</Stat>
        <Stat label="Policy version">{snap ? `v${snap.info.policy_version} · ${snap.info.agents} agents` : "…"}</Stat>
      </div>

      {notice && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-2 text-sm ${
            notice.kind === "error"
              ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
              : notice.kind === "ok"
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                : "bg-stone-100 dark:bg-stone-800"
          }`}
        >
          <span>
            {notice.text}{" "}
            {notice.tx && (
              <a className="underline" href={explorerTx(notice.tx)} target="_blank" rel="noreferrer">
                view transaction
              </a>
            )}
          </span>
          <button className="text-xs opacity-60 hover:opacity-100" onClick={() => setNotice(null)}>
            dismiss
          </button>
        </div>
      )}

      {!wallet.accountId && snap && (
        <p className="text-sm text-stone-500">
          Read-only view. Connect <Mono>{snap.info.owner}</Mono> to approve requests, edit the policy or revoke agents.
        </p>
      )}
      {loadError && <p className="text-sm text-red-600">Could not read the vault: {loadError}</p>}

      {snap && (
        <>
          <Pending pending={snap.pending} isOwner={isOwner} busy={busy} act={act} />
          <DecisionLog log={snap.log} total={snap.info.log_len} />
          <Agents agents={snap.agents} isOwner={isOwner} busy={busy} act={act} />
          <PolicyEditor policy={snap.policy} isOwner={isOwner} busy={busy} act={act} />
        </>
      )}
    </main>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs text-stone-500">{label}</div>
      <div>{children}</div>
    </div>
  );
}
