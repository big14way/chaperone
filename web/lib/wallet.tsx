"use client";
// NEAR Wallet Selector (core only; the stock modal bundles its own React). The owner signs in here;
// every owner method attaches 1 yoctoNEAR, which only a full-access key can do, so the wallet
// always asks for confirmation.
import { actionCreators, setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { NETWORK, ONE_YOCTO, OWNER_GAS, VAULT_ID } from "./config";

export interface WalletOption {
  id: string;
  name: string;
  iconUrl?: string;
}

interface WalletCtx {
  ready: boolean;
  accountId: string | null;
  options: WalletOption[];
  signIn(walletId: string): Promise<void>;
  signOut(): Promise<void>;
  /** Owner call on the vault. Resolves to the tx hash, or null when the wallet redirected away. */
  call(method: string, args: Record<string, unknown>): Promise<string | null>;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [options, setOptions] = useState<WalletOption[]>([]);

  useEffect(() => {
    let sub: { unsubscribe(): void } | undefined;
    let cancelled = false;
    setupWalletSelector({ network: NETWORK, modules: [setupMyNearWallet(), setupIntearWallet()] }).then((s) => {
      if (cancelled) return;
      setSelector(s);
      const sync = () => {
        const state = s.store.getState();
        setAccountId(state.accounts.find((a) => a.active)?.accountId ?? null);
        setOptions(state.modules.map((m) => ({ id: m.id, name: m.metadata.name, iconUrl: m.metadata.iconUrl })));
      };
      sync();
      sub = s.store.observable.subscribe(sync);
    });
    return () => {
      cancelled = true;
      sub?.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (walletId: string) => {
      if (!selector) return;
      const wallet = await selector.wallet(walletId);
      await wallet.signIn({ contractId: VAULT_ID, methodNames: [] } as never);
    },
    [selector],
  );

  const signOut = useCallback(async () => {
    if (!selector) return;
    await (await selector.wallet()).signOut();
    setAccountId(null);
  }, [selector]);

  const call = useCallback(
    async (method: string, args: Record<string, unknown>) => {
      if (!selector) throw new Error("wallet not ready");
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId: VAULT_ID,
        actions: [actionCreators.functionCall(method, args, OWNER_GAS, ONE_YOCTO)],
      });
      if (!outcome) return null;
      const failure = (outcome.status as { Failure?: unknown }).Failure;
      if (failure) throw new Error(describeFailure(failure));
      return outcome.transaction_outcome?.id ?? outcome.transaction?.hash ?? null;
    },
    [selector],
  );

  return <Ctx.Provider value={{ ready: !!selector, accountId, options, signIn, signOut, call }}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

function describeFailure(f: unknown): string {
  const s = JSON.stringify(f);
  const m = /"ExecutionError":"([^"]+)"/.exec(s) ?? /Smart contract panicked: ([^"\\]+)/.exec(s);
  return m?.[1] ?? s.slice(0, 200);
}
