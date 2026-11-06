// Blocklist of known-bad recipients: the shared on-chain registry (contracts/registry), a JSON file,
// or a Supabase table when configured.
import { readFileSync, existsSync } from "node:fs";

export interface BlocklistEntry {
  account_id: string;
  reason: string;
  evidence?: string;
  reported_at?: string;
  reporter?: string;
}

export interface Blocklist {
  readonly source: string;
  lookup(accountId: string): Promise<BlocklistEntry | null>;
}

export function fileBlocklist(path: string): Blocklist {
  const entries: BlocklistEntry[] = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as { entries: BlocklistEntry[] }).entries
    : [];
  const byId = new Map(entries.map((e) => [e.account_id.toLowerCase(), e]));
  return {
    source: `file:${path}`,
    async lookup(accountId) {
      return byId.get(accountId.toLowerCase()) ?? null;
    },
  };
}

/** In-memory list, e.g. the demo JSON bundled into a serverless function. */
export function memoryBlocklist(entries: BlocklistEntry[], source = "memory"): Blocklist {
  const byId = new Map(entries.map((e) => [e.account_id.toLowerCase(), e]));
  return { source, async lookup(accountId) { return byId.get(accountId.toLowerCase()) ?? null; } };
}

const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

type ViewFn = (contractId: string, method: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * The shared registry contract (`get_flag`). One flag there blocks the account for every vault
 * whose checker reads it. A failed read throws, so the checker fails closed.
 */
export function registryBlocklist(view: ViewFn, registryId: string): Blocklist {
  return {
    source: `near:${registryId}`,
    async lookup(accountId) {
      // Not a valid NEAR account id: the vault rejects the spend anyway, and the view would panic.
      if (!ACCOUNT_ID.test(accountId)) return null;
      const f = (await view(registryId, "get_flag", { account_id: accountId })) as
        | { account_id: string; reason: string; evidence: string; reporter: string; reported_ms: number }
        | null;
      return f ? { account_id: f.account_id, reason: f.reason, evidence: f.evidence, reporter: f.reporter, reported_at: new Date(f.reported_ms).toISOString() } : null;
    },
  };
}

/** Supabase (PostgREST) table `blocklist(account_id text primary key, reason text, evidence text, reported_at timestamptz)`. */
export function supabaseBlocklist(url: string, anonKey: string, table = "blocklist"): Blocklist {
  return {
    source: `supabase:${new URL(url).host}/${table}`,
    async lookup(accountId) {
      const q = new URL(`/rest/v1/${table}`, url);
      q.searchParams.set("select", "account_id,reason,evidence,reported_at");
      q.searchParams.set("account_id", `eq.${accountId.toLowerCase()}`);
      const res = await fetch(q, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } });
      if (!res.ok) throw new Error(`blocklist lookup failed: HTTP ${res.status}`);
      const rows = (await res.json()) as BlocklistEntry[];
      return rows[0] ?? null;
    },
  };
}

export function combineBlocklists(lists: Blocklist[]): Blocklist {
  return {
    source: lists.map((l) => l.source).join("+"),
    async lookup(accountId) {
      for (const l of lists) {
        const hit = await l.lookup(accountId);
        if (hit) return hit;
      }
      return null;
    },
  };
}
