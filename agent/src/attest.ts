// TEE attestation for the agent's model on NEAR AI Cloud. Before an agent with a wallet acts, it fetches
// the model's attestation report with a fresh nonce and checks that the Intel TDX quote's report_data
// binds that nonce and the model's signing address (report_data = signing_address padded to 32 bytes ||
// nonce). This proves the evidence was produced for this request by the attested enclave.
// Not done here: verifying Intel's DCAP signature chain on the quote and the NVIDIA GPU evidence; use
// NEAR's verifier (https://cloud.near.ai/verify) or github.com/nearai for that.
import { randomBytes } from "node:crypto";

export const NEAR_AI_API = "https://cloud-api.near.ai/v1";
const TDX_TEE_TYPE = 0x81;
const REPORT_DATA_OFFSET = 48 + 520; // quote v4: 48-byte header, report_data at TD report body offset 520

export interface ModelAttestation {
  model: string;
  tee: string;
  signingAddress: string;
  nonce: string;
  appId: string | null;
  quoteVersion: number;
  bound: boolean;
  problems: string[];
}

/** Pure check of a v4 TDX quote against the expected signing address and nonce (hex, no 0x). */
export function checkQuoteBinding(quoteHex: string, signingAddress: string, nonce: string): { version: number; bound: boolean; problems: string[] } {
  const problems: string[] = [];
  const q = Buffer.from(quoteHex, "hex");
  if (q.length < REPORT_DATA_OFFSET + 64) return { version: 0, bound: false, problems: ["quote too short"] };
  const version = q.readUInt16LE(0);
  if (version !== 4) problems.push(`unexpected quote version ${version}`);
  if (q.readUInt32LE(4) !== TDX_TEE_TYPE) problems.push("not an Intel TDX quote");
  const rd = q.subarray(REPORT_DATA_OFFSET, REPORT_DATA_OFFSET + 64);
  const addr = signingAddress.replace(/^0x/, "").toLowerCase();
  const addrSlot = rd.subarray(0, 32).toString("hex");
  if (!addrSlot.startsWith(addr) || !/^0*$/.test(addrSlot.slice(addr.length))) problems.push("report_data does not bind the signing address");
  if (rd.subarray(32, 64).toString("hex") !== nonce.toLowerCase()) problems.push("report_data does not bind our nonce");
  return { version, bound: problems.length === 0, problems };
}

export async function attestModel(model: string, opts: { apiBase?: string; apiKey?: string } = {}): Promise<ModelAttestation> {
  const nonce = randomBytes(32).toString("hex");
  const url = new URL(`${opts.apiBase ?? NEAR_AI_API}/attestation/report`);
  for (const [k, v] of Object.entries({ model, provider: "near", include_tls_fingerprint: "false", signing_algo: "ecdsa", nonce })) url.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: "application/json", "x-no-aliasing": "true" };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const res = await fetch(url, { headers });
  const body = (await res.json()) as {
    model_attestations?: Array<{ signing_address: string; request_nonce?: string; intel_quote?: string; nvidia_payload?: string; info?: { app_id?: string } }>;
    error?: { message?: string };
  };
  const a = body.model_attestations?.[0];
  if (!res.ok || !a?.intel_quote) {
    return { model, tee: "none", signingAddress: "", nonce, appId: null, quoteVersion: 0, bound: false, problems: [body.error?.message ?? `HTTP ${res.status}: no attestation`] };
  }
  const check = checkQuoteBinding(a.intel_quote, a.signing_address, nonce);
  if (a.request_nonce && a.request_nonce !== nonce) check.problems.push("request_nonce mismatch");
  return {
    model,
    tee: a.nvidia_payload ? "Intel TDX + NVIDIA GPU" : "Intel TDX",
    signingAddress: a.signing_address,
    nonce,
    appId: a.info?.app_id ?? null,
    quoteVersion: check.version,
    bound: check.problems.length === 0,
    problems: check.problems,
  };
}
