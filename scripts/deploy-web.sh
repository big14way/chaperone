#!/usr/bin/env bash
# Build the dashboard as a static export and deploy it to Vercel (project: getchaperone).
# Needs the Vercel CLI logged in (vercel login). Stop `pnpm web` first: next build and next dev share web/.next.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${VERCEL_PROJECT:-getchaperone}"
STAGE=".chaperone/vercel"
(cd web && rm -rf .next out && pnpm build)
mkdir -p "$STAGE"
rsync -a --delete --exclude .vercel --exclude .vercelignore --exclude ".env*" web/out/ "$STAGE/"
printf '.env*\n.gitignore\n' > "$STAGE/.vercelignore"  # never upload CLI tokens
cd "$STAGE"
[ -d .vercel ] || vercel link --yes --project "$PROJECT"
vercel deploy --prod --yes
