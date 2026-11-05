// Verdict signing. The message format is the contract's `verdict_message` (contracts/chaperone/src/lib.rs);
// both sides pin the same literal in their tests.
import nacl from "tweetnacl";
import bs58 from "bs58";

export type VerdictLabel = "allow" | "warn" | "block";

export interface VerdictFields {
  vault: string;
  agent: string;
  token: string;
  amount: string;
  recipient: string;
  verdict: VerdictLabel;
  score: number;
  reasons: string[];
  nonce: string;
  expires_ms: number;
}

/** What `request_spend` takes as its `verdict` argument. */
export interface SignedVerdict {
  verdict: VerdictLabel;
  score: number;
  reasons: string[];
  nonce: string;
  expires_ms: number;
  /** base64 ed25519 signature over `verdictMessage(...)`. */
  signature: string;
}

export function verdictMessage(f: VerdictFields): string {
  return [
    "chaperone-verdict:v1",
    `vault=${f.vault}`,
    `agent=${f.agent}`,
    `token=${f.token}`,
    `amount=${BigInt(f.amount).toString()}`,
    `recipient=${f.recipient}`,
    `verdict=${f.verdict}`,
    `score=${f.score}`,
    `reasons=${f.reasons.join(",")}`,
    `nonce=${f.nonce}`,
    `expires_ms=${f.expires_ms}`,
  ].join("\n");
}

export interface CheckerKey {
  /** NEAR format: ed25519:<base58 of 64-byte secret key>. */
  secretKey: string;
  /** NEAR format: ed25519:<base58 of 32-byte public key>. */
  publicKey: string;
  pair: nacl.SignKeyPair;
}

export function nearPublicKey(pk: Uint8Array): string {
  return `ed25519:${bs58.encode(pk)}`;
}

export function checkerKeyFromSecret(secret: string): CheckerKey {
  const raw = secret.startsWith("ed25519:") ? secret.slice("ed25519:".length) : secret;
  const bytes = bs58.decode(raw);
  let pair: nacl.SignKeyPair;
  if (bytes.length === 64) pair = nacl.sign.keyPair.fromSecretKey(bytes);
  else if (bytes.length === 32) pair = nacl.sign.keyPair.fromSeed(bytes);
  else throw new Error(`checker secret key must be 32 or 64 bytes, got ${bytes.length}`);
  return {
    secretKey: `ed25519:${bs58.encode(pair.secretKey)}`,
    publicKey: nearPublicKey(pair.publicKey),
    pair,
  };
}

export function generateCheckerKey(): CheckerKey {
  const pair = nacl.sign.keyPair();
  return checkerKeyFromSecret(`ed25519:${bs58.encode(pair.secretKey)}`);
}

export function signVerdict(key: CheckerKey, f: VerdictFields): SignedVerdict {
  const msg = new TextEncoder().encode(verdictMessage(f));
  const sig = nacl.sign.detached(msg, key.pair.secretKey);
  return {
    verdict: f.verdict,
    score: f.score,
    reasons: f.reasons,
    nonce: f.nonce,
    expires_ms: f.expires_ms,
    signature: Buffer.from(sig).toString("base64"),
  };
}

export function verifyVerdict(publicKey: string, f: VerdictFields, signatureB64: string): boolean {
  const pk = bs58.decode(publicKey.replace(/^ed25519:/, ""));
  const msg = new TextEncoder().encode(verdictMessage(f));
  return nacl.sign.detached.verify(msg, Buffer.from(signatureB64, "base64"), pk);
}
