// Thin wrappers over near-api-js 7 for the vault: views, the agent's function-call key, the owner.
import { Account, JsonRpcProvider, KeyPair, getTransactionLastResult, type KeyPairString } from "near-api-js";
import type { AgentView, LogEntry, Policy, SpendRequest, VaultInfo } from "../../checker/src/types.ts";
import type { SignedVerdict } from "../../checker/src/verdict.ts";

export const TGAS = 1_000_000_000_000n;
export const ONE_YOCTO = 1n;
export const USDC_DECIMALS = 6;

export function toUnits(amount: string, decimals = USDC_DECIMALS): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) throw new Error(`not a positive decimal amount: ${amount}`);
  const frac = (m[2] ?? "").padEnd(decimals, "0");
  if (frac.length > decimals) throw new Error(`too many decimals in ${amount}`);
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export function fromUnits(units: bigint | string, decimals = USDC_DECIMALS): string {
  const v = BigInt(units);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function makeProvider(url: string): JsonRpcProvider {
  return new JsonRpcProvider({ url });
}

/** Read-only view of a Chaperone vault. */
export class Vault {
  constructor(
    readonly provider: JsonRpcProvider,
    readonly id: string,
  ) {}

  async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.provider.callFunction({ contractId: this.id, method, args })) as unknown as T;
  }

  info() {
    return this.view<VaultInfo>("get_info");
  }
  policy() {
    return this.view<Policy>("get_policy");
  }
  agents() {
    return this.view<AgentView[]>("get_agents");
  }
  pending() {
    return this.view<SpendRequest[]>("get_pending");
  }
  log(limit = 50, fromIndex?: number) {
    return this.view<LogEntry[]>("get_log", { limit, from_index: fromIndex });
  }
}

export interface SpendResult {
  entry: LogEntry;
  txHash: string;
}

/**
 * An agent: a function-call access key on the vault account that may only call
 * `request_spend`. It cannot attach a deposit, so it can never call `ft_transfer` itself.
 */
export class AgentKey {
  readonly account: Account;
  readonly publicKey: string;

  constructor(
    readonly vault: Vault,
    readonly label: string,
    privateKey: KeyPairString,
  ) {
    this.account = new Account(vault.id, vault.provider, privateKey);
    this.publicKey = KeyPair.fromString(privateKey).getPublicKey().toString();
  }

  async requestSpend(args: {
    token: string;
    amount: bigint;
    recipient: string;
    memo?: string;
    verdict: SignedVerdict;
  }): Promise<SpendResult> {
    const outcome = await this.account.callFunctionRaw({
      contractId: this.vault.id,
      methodName: "request_spend",
      args: {
        token: args.token,
        amount: args.amount.toString(),
        recipient: args.recipient,
        memo: args.memo ?? null,
        verdict: args.verdict,
      },
      gas: 100n * TGAS,
    });
    return { entry: getTransactionLastResult(outcome) as LogEntry, txHash: outcome.transaction_outcome.id };
  }
}

/** The vault owner: a separate account with a full-access key. Owner calls attach 1 yoctoNEAR. */
export class Owner {
  constructor(
    readonly account: Account,
    readonly vault: Vault,
  ) {}

  private async call<T>(methodName: string, args: Record<string, unknown>): Promise<{ value: T; txHash: string }> {
    const outcome = await this.account.callFunctionRaw({
      contractId: this.vault.id,
      methodName,
      args,
      gas: 150n * TGAS,
      deposit: ONE_YOCTO,
    });
    return { value: getTransactionLastResult(outcome) as T, txHash: outcome.transaction_outcome.id };
  }

  addAgent(publicKey: string, label: string, caps: { dailyCap?: bigint; perTxCap?: bigint; allowance?: bigint } = {}) {
    return this.call<null>("add_agent", {
      public_key: publicKey,
      label,
      daily_cap: caps.dailyCap?.toString() ?? null,
      per_tx_cap: caps.perTxCap?.toString() ?? null,
      allowance: caps.allowance?.toString() ?? null,
    });
  }
  approve(requestId: number) {
    return this.call<LogEntry>("approve", { request_id: requestId });
  }
  reject(requestId: number) {
    return this.call<LogEntry>("reject", { request_id: requestId });
  }
  revokeAll() {
    return this.call<number>("revoke_all", {});
  }
  setPolicy(policy: Policy) {
    return this.call<Policy>("set_policy", { policy });
  }
}
