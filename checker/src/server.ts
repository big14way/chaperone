// Counterparty checker service: POST /verdict -> signals -> score -> ed25519-signed verdict.
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { combineBlocklists, fileBlocklist, registryBlocklist, supabaseBlocklist, type Blocklist } from "./blocklist.ts";
import { CodeCache } from "./codecache.ts";
import { type CheckerConfig } from "./config.ts";
import { NearBlocks, defaultNearBlocksUrl } from "./nearblocks.ts";
import { Rpc } from "./rpc.ts";
import { assess, type Assessment, type Signals } from "./score.ts";
import { collectSignals, type SignalDeps } from "./signals.ts";
import { checkerKeyFromSecret, signVerdict, type CheckerKey, type SignedVerdict } from "./verdict.ts";

export interface VerdictRequest {
  /** Agent public key (ed25519:...), the key that will sign request_spend. */
  agent: string;
  token: string;
  /** Token base units, decimal string. */
  amount: string;
  recipient: string;
}

export interface VerdictResponse extends SignedVerdict {
  vault: string;
  checker_pk: string;
  signals: Omit<Signals, "amount" | "mean7d" | "dailyCap"> & {
    amount: string;
    mean7d: string | null;
    dailyCap: string;
  };
}

export interface Checker {
  key: CheckerKey;
  config: CheckerConfig;
  deps: SignalDeps;
  check(req: VerdictRequest): Promise<VerdictResponse>;
}

/** The local list (file or bundled), then the shared on-chain registry, then Supabase when configured. */
export function blocklistFor(config: CheckerConfig, local: Blocklist, rpc = new Rpc(config.rpcUrl)): Blocklist {
  const lists: Blocklist[] = [local];
  if (config.blocklistRegistry) lists.push(registryBlocklist((c, m, a) => rpc.view(c, m, a), config.blocklistRegistry));
  if (config.supabaseUrl && config.supabaseAnonKey) lists.push(supabaseBlocklist(config.supabaseUrl, config.supabaseAnonKey));
  return combineBlocklists(lists);
}

export function createChecker(config: CheckerConfig, overrides: Partial<SignalDeps> = {}): Checker {
  const key = checkerKeyFromSecret(config.checkerSecretKey);
  const rpc = overrides.rpc ?? new Rpc(config.rpcUrl);
  const deps: SignalDeps = {
    rpc,
    vault: config.vault,
    blocklist: blocklistFor(config, fileBlocklist(config.blocklistPath), rpc),
    codeCache: new CodeCache(config.codeCachePath),
    nearblocks:
      config.nearblocksApiKey && config.network !== "sandbox"
        ? new NearBlocks(config.nearblocksUrl ?? defaultNearBlocksUrl(config.network), config.nearblocksApiKey)
        : undefined,
    ...overrides,
  };

  async function check(req: VerdictRequest): Promise<VerdictResponse> {
    const amount = BigInt(req.amount);
    const signals = await collectSignals(deps, {
      agent: req.agent,
      token: req.token,
      amount,
      recipient: req.recipient,
    });
    const a: Assessment = assess(signals);
    // Expiry is measured in chain time, so sandbox fast-forwards and clock skew do not matter.
    const chainNow = await deps.rpc.block();
    const signed = signVerdict(key, {
      vault: config.vault,
      agent: req.agent,
      token: req.token,
      amount: req.amount,
      recipient: req.recipient,
      verdict: a.verdict,
      score: a.score,
      reasons: a.reasons,
      nonce: randomUUID(),
      expires_ms: chainNow.timestampMs + config.verdictTtlMs,
    });
    return {
      ...signed,
      vault: config.vault,
      checker_pk: key.publicKey,
      signals: {
        ...signals,
        amount: signals.amount.toString(),
        mean7d: signals.mean7d?.toString() ?? null,
        dailyCap: signals.dailyCap.toString(),
      },
    };
  }

  return { key, config, deps, check };
}

const ACCOUNT_RE = "^(([a-z\\d]+[-_])*[a-z\\d]+\\.)*([a-z\\d]+[-_])*[a-z\\d]+$";

export function buildServer(checker: Checker): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({
    ok: true,
    network: checker.config.network,
    vault: checker.config.vault,
    checker_pk: checker.key.publicKey,
    blocklist: checker.deps.blocklist.source,
  }));

  app.post<{ Body: VerdictRequest }>(
    "/verdict",
    {
      schema: {
        body: {
          type: "object",
          required: ["agent", "token", "amount", "recipient"],
          additionalProperties: false,
          properties: {
            agent: { type: "string", pattern: "^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$" },
            token: { type: "string", minLength: 2, maxLength: 64, pattern: ACCOUNT_RE },
            amount: { type: "string", pattern: "^[0-9]{1,30}$" },
            recipient: { type: "string", minLength: 2, maxLength: 64, pattern: ACCOUNT_RE },
          },
        },
      },
    },
    async (req) => checker.check(req.body),
  );

  return app;
}
