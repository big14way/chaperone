// Report data the TEE checker puts in its TDX quote. Mirrors chaperone_tee::report_data_for (Rust).
import { createHash } from "node:crypto";

export const REPORT_DATA_DOMAIN = "chaperone-checker-v1:";

/** sha256(domain || vault || ":" || raw 32-byte public key) || 32 zero bytes. */
export function reportDataFor(vault: string, publicKey: Uint8Array): Buffer {
  const h = createHash("sha256").update(REPORT_DATA_DOMAIN).update(vault).update(":").update(publicKey).digest();
  return Buffer.concat([h, Buffer.alloc(32)]);
}
