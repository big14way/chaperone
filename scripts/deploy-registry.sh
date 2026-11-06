#!/usr/bin/env bash
# Deploy and initialise the shared blocklist registry on NEAR testnet with cargo-near.
#
# Needs (in .env or the environment):
#   REGISTRY_ID  testnet account for the contract; its full-access key must be in the legacy
#                keychain (~/.near-credentials/testnet/$REGISTRY_ID.json); `pnpm accounts:testnet` makes one
#   OWNER_ID     the registry owner (adds and removes trusted reporters; is a reporter itself)
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${REGISTRY_ID:?set REGISTRY_ID}"
: "${OWNER_ID:?set OWNER_ID}"
cd contracts/registry
cargo near deploy build-non-reproducible-wasm "$REGISTRY_ID" \
  with-init-call new json-args "{\"owner\":\"$OWNER_ID\"}" \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send
