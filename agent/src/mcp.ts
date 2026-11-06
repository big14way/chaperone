// Chaperone MCP server: gives any MCP-capable agent (Claude, Cursor, NEAR AI agents...) a wallet whose
// only power is to ask. The agent holds a function-call key that can call request_spend on the vault and
// nothing else; every payment goes through the checker and the vault's rules.
//
//   pnpm mcp      (stdio)   env: VAULT_ID, AGENT_PRIVATE_KEY, optional CHECKER_URL, USDC_ID, NEAR_RPC_URL
//
// Tools: chaperone_budget (read-only), chaperone_check (verdict only, no transaction), chaperone_pay.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { KeyPairString } from "near-api-js";
import { z } from "zod";
import { DEFAULT_RPC } from "../../checker/src/config.ts";
import { AgentKey, Vault, fromUnits, makeProvider, toUnits } from "./near.ts";
import { chaperonePay, getVerdict, type ToolContext } from "./tools.ts";

const TESTNET_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const need = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`missing env ${n}`);
  return v;
};

const vault = new Vault(makeProvider(process.env.NEAR_RPC_URL || DEFAULT_RPC.testnet), need("VAULT_ID"));
const agent = new AgentKey(vault, process.env.AGENT_LABEL || "mcp-agent", need("AGENT_PRIVATE_KEY") as KeyPairString);
const token = process.env.USDC_ID || TESTNET_USDC;
const ctx: ToolContext = { agent, token, checkerUrl: process.env.CHECKER_URL || "https://getchaperone.vercel.app/api", pageVars: {} };
const text = (t: string, data?: unknown) => ({ content: [{ type: "text" as const, text: data === undefined ? t : `${t}\n${JSON.stringify(data, null, 2)}` }] });

const server = new McpServer({ name: "chaperone", version: "0.1.0" });

server.registerTool(
  "chaperone_budget",
  { description: "What this agent may still spend today, its per-payment cap, and the vault's approved recipients. Read-only." },
  async () => {
    const [agents, policy] = await Promise.all([vault.agents(), vault.policy()]);
    const me = agents.find((a) => a.public_key === agent.publicKey);
    if (!me) return text("This key is not a registered agent on the vault (it may have been revoked).");
    return text(`Remaining today: ${fromUnits(me.remaining_today)} USDC of ${fromUnits(me.daily_cap)}. Max per payment: ${fromUnits(me.per_tx_cap)} USDC.`, {
      approved_recipients: policy.allow_recipients,
      new_recipient_wait_hours: policy.new_recipient_timelock_ms / 3_600_000,
      unusual_payments_wait_for_owner: policy.warn_requires_owner,
    });
  },
);

server.registerTool(
  "chaperone_check",
  {
    description: "Ask the risk checker about a recipient before paying. Returns allow, warn or block with reasons. Sends no transaction.",
    inputSchema: { recipient: z.string().min(2).max(64), amount_usdc: z.string().regex(/^\d+(\.\d{1,6})?$/) },
  },
  async ({ recipient, amount_usdc }) => {
    const v = await getVerdict(ctx.checkerUrl, { agent: agent.publicKey, token, amount: toUnits(amount_usdc).toString(), recipient });
    return text(`Checker says ${v.verdict.toUpperCase()} (risk ${v.score}/100).`, { reasons: v.reasons });
  },
);

server.registerTool(
  "chaperone_pay",
  {
    description:
      "Pay a recipient in USDC from the Chaperone vault. The vault decides: it pays inside the owner's rules, holds unusual payments for the owner, or refuses. Never retry a refused or held payment.",
    inputSchema: {
      recipient: z.string().min(2).max(64),
      amount_usdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
      memo: z.string().max(64).optional(),
    },
  },
  async (input) => {
    const r = await chaperonePay(ctx, input);
    return text(r.message, { decision: r.decision, reasons: r.reasons, request_id: r.request_id, tx_hash: r.tx_hash });
  },
);

await server.connect(new StdioServerTransport());
