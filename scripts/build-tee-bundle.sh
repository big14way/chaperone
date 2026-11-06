#!/usr/bin/env bash
# Bundle the TEE checker (checker/src/tee-server.ts) into deploy/tee/checker-tee.mjs for the image.
set -euo pipefail
cd "$(dirname "$0")/.."
node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild checker/src/tee-server.ts --bundle --platform=node \
  --target=node22 --format=esm --outfile=deploy/tee/checker-tee.mjs --log-level=warning \
  "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
