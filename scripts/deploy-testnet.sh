#!/usr/bin/env bash
# Deploy and initialise the Chaperone vault on NEAR testnet with cargo-near.
#
# Needs (in .env or the environment):
#   VAULT_ID            testnet account that will hold the contract and the USDC; its full-access
#                       key must be in the legacy keychain (~/.near-credentials/testnet/$VAULT_ID.json)
#   OWNER_ID            a different account: the owner (approves warn requests, edits policy)
#   CHECKER_PUBLIC_KEY  from `pnpm keygen`
#   VENDOR_ID           the allowlisted vendor
# Optional: USDC_ID (defaults to Circle testnet USDC), DAILY_CAP_USDC (100), PER_TX_CAP_USDC (50),
#           TIMELOCK_MS (86400000)
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi

: "${VAULT_ID:?set VAULT_ID}"
: "${OWNER_ID:?set OWNER_ID}"
: "${CHECKER_PUBLIC_KEY:?set CHECKER_PUBLIC_KEY (pnpm keygen)}"
: "${VENDOR_ID:?set VENDOR_ID}"
export USDC_ID="${USDC_ID:-3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af}"
export VAULT_ID OWNER_ID CHECKER_PUBLIC_KEY VENDOR_ID

ARGS=$(node -e '
const usdc = (n) => (BigInt(n) * 1000000n).toString();
const e = process.env;
process.stdout.write(JSON.stringify({
  owner: e.OWNER_ID,
  checker_pk: e.CHECKER_PUBLIC_KEY,
  policy: {
    daily_cap: usdc(e.DAILY_CAP_USDC || "100"),
    per_tx_cap: usdc(e.PER_TX_CAP_USDC || "50"),
    allow_recipients: [e.VENDOR_ID],
    allow_tokens: [e.USDC_ID],
    new_recipient_timelock_ms: Number(e.TIMELOCK_MS || 86400000),
    warn_requires_owner: true,
  },
}));')

echo "init args: $ARGS"
cd contracts/chaperone
cargo near deploy build-non-reproducible-wasm "$VAULT_ID" \
  with-init-call new json-args "$ARGS" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send
