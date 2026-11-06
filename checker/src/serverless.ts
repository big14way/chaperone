// Vercel / serverless entry for the hosted checker: the same Fastify app as `pnpm checker`,
// mounted under /api (GET /api/health, POST /api/verdict). Bundled by scripts/deploy-web.sh.
// Env: VAULT_ID, CHECKER_SECRET_KEY, NEAR_NETWORK (testnet), optional NEARBLOCKS_API_KEY, SUPABASE_*.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import blocklist from "../../fixtures/blocklist.json" with { type: "json" };
import { combineBlocklists, memoryBlocklist, supabaseBlocklist, type BlocklistEntry } from "./blocklist.ts";
import { configFromEnv } from "./config.ts";
import { buildServer, createChecker } from "./server.ts";

let ready: Promise<FastifyInstance> | null = null;

async function boot(): Promise<FastifyInstance> {
  const config = { ...configFromEnv(), codeCachePath: "/tmp/chaperone-code-hashes.json" };
  const lists = [memoryBlocklist((blocklist as { entries: BlocklistEntry[] }).entries, "bundled:fixtures/blocklist.json")];
  if (config.supabaseUrl && config.supabaseAnonKey) lists.push(supabaseBlocklist(config.supabaseUrl, config.supabaseAnonKey));
  const app = buildServer(createChecker(config, { blocklist: combineBlocklists(lists) }));
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= boot();
  const app = await ready;
  // Vercel rewrites /api/<path> to /api/checker?path=<path>; plain servers pass /api/<path>.
  const u = new URL(req.url ?? "/", "http://x");
  const routed = u.searchParams.get("path");
  req.url = routed !== null ? `/${routed}` : u.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  app.server.emit("request", req, res);
}
