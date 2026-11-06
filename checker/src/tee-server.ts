// Checker entry point inside an Intel TDX confidential VM (dstack, e.g. Phala Cloud).
//
// The ed25519 signing key is generated in enclave memory at boot and never written anywhere. The
// enclave then asks the dstack guest agent for a TDX quote whose report data commits to this vault
// and this key (see crates/chaperone-tee: sha256("chaperone-checker-v1:" || vault || ":" || pk) ||
// 32 zero bytes). GET /attestation returns the quote, the TCB info with its event log and the public
// key; anyone can pass them to the vault's register_checker, which verifies them on chain.
// A restart creates a new key, which must be registered again.
//
// Env: VAULT_ID, NEAR_NETWORK (testnet), optional NEAR_RPC_URL, BLOCKLIST_REGISTRY, PORT (8787).
// The blocklist is the bundled list plus the shared on-chain registry: its data is public and the
// code that reads it is pinned by the attestation.
import { DstackClient } from "@phala/dstack-sdk";
import bs58 from "bs58";
import nacl from "tweetnacl";
import blocklist from "../../fixtures/blocklist.json" with { type: "json" };
import { memoryBlocklist, type BlocklistEntry } from "./blocklist.ts";
import { configFromEnv } from "./config.ts";
import { blocklistFor, buildServer, createChecker } from "./server.ts";
import { reportDataFor } from "./tee-report-data.ts";


async function main() {
  const pair = nacl.sign.keyPair();
  const publicKey = `ed25519:${bs58.encode(pair.publicKey)}`;
  const config = {
    ...configFromEnv({ ...process.env, CHECKER_SECRET_KEY: `ed25519:${bs58.encode(pair.secretKey)}` }),
    host: "0.0.0.0",
    codeCachePath: "/tmp/chaperone-code-hashes.json",
  };
  const checker = createChecker(config, {
    blocklist: blocklistFor(config, memoryBlocklist((blocklist as { entries: BlocklistEntry[] }).entries, "bundled:fixtures/blocklist.json")),
  });

  const dstack = new DstackClient();
  const reportData = reportDataFor(config.vault, pair.publicKey);
  const [info, quote] = await Promise.all([dstack.info(), dstack.getQuote(reportData)]);
  const attestation = {
    vault: config.vault,
    public_key: publicKey,
    report_data: reportData.toString("hex"),
    quote: quote.quote,
    // The quote's event log is the one RTMR3 must replay to; the rest of the TCB info comes from the guest agent.
    tcb_info: { ...info.tcb_info, event_log: JSON.parse(quote.event_log) },
    app_id: info.app_id,
    compose_hash: info.compose_hash,
    generated_at: new Date().toISOString(),
  };

  const app = buildServer(checker);
  app.get("/attestation", async () => attestation);
  const addr = await app.listen({ host: config.host, port: config.port });
  console.log(`attested checker on ${addr}: vault ${config.vault}, key ${publicKey}, compose ${info.compose_hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
