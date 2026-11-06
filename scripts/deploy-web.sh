#!/usr/bin/env bash
# Build the dashboard as a static export and deploy it to Vercel (project: getchaperone).
# Also deploys the hosted checker at /api (needs VAULT_ID, NEAR_NETWORK, CHECKER_SECRET_KEY set on the
# Vercel project: vercel env add). Needs the Vercel CLI logged in (vercel login). Stop `pnpm web` first: next build and next dev share web/.next.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${VERCEL_PROJECT:-getchaperone}"
STAGE=".chaperone/vercel"
(cd web && rm -rf .next out && pnpm build)
mkdir -p "$STAGE"
rsync -a --delete --exclude .vercel --exclude .vercelignore --exclude ".env*" --exclude api --exclude vercel.json web/out/ "$STAGE/"
printf '.env*\n.gitignore\n' > "$STAGE/.vercelignore"  # never upload CLI tokens
# Hosted checker: the same Fastify app as `pnpm checker`, bundled into one serverless function.
mkdir -p "$STAGE/api"
node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild checker/src/serverless.ts --bundle --platform=node \
  --target=node20 --format=esm --outfile="$STAGE/api/checker.mjs" --log-level=warning \
  "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
cat > "$STAGE/vercel.json" <<'JSON'
{ "rewrites": [{ "source": "/api/:path*", "destination": "/api/checker?path=:path*" }] }
JSON
cd "$STAGE"
[ -d .vercel ] || vercel link --yes --project "$PROJECT"
vercel deploy --prod --yes
