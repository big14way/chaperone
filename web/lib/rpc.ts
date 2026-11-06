// Read-only access to the vault over public JSON-RPC. No keys, no wallet.
import { RPC_URL, VAULT_ID } from "./config";
import type { AgentView, LogEntry, Policy, SpendRequest, VaultInfo, VaultSnapshot } from "./types";

function b64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "chaperone",
      method: "query",
      params: { request_type: "call_function", finality: "optimistic", account_id: contractId, method_name: method, args_base64: b64(JSON.stringify(args)) },
    }),
  });
  const body = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: { cause?: { name?: string }; message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.cause?.name ?? body.error.message ?? "RPC error"}`);
  if (body.result?.error) throw new Error(`${method}: ${body.result.error}`);
  const bytes = new Uint8Array(body.result?.result ?? []);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export async function loadVault(vault = VAULT_ID): Promise<VaultSnapshot> {
  const [info, policy, agents, pending, log] = await Promise.all([
    view<VaultInfo>(vault, "get_info"),
    view<Policy>(vault, "get_policy"),
    view<AgentView[]>(vault, "get_agents"),
    view<SpendRequest[]>(vault, "get_pending"),
    view<LogEntry[]>(vault, "get_log", { limit: 100 }),
  ]);
  const balances: Record<string, string> = {};
  await Promise.all(
    policy.allow_tokens.map(async (t) => {
      try {
        balances[t] = await view<string>(t, "ft_balance_of", { account_id: vault });
      } catch {
        balances[t] = "0";
      }
    }),
  );
  return { info, policy, agents, pending, log: [...log].reverse(), balances, fetchedAt: Date.now() };
}
