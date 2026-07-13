#!/usr/bin/env bash
# One-time bootstrap for staging/production CI and Dokploy Infisical integration.
#
# Required environment variables (do not commit these):
#   INFISICAL_MACHINE_CLIENT_ID
#   INFISICAL_MACHINE_CLIENT_SECRET
#   PROMOTE_TOKEN                 GitHub PAT (classic or fine-grained) with contents:write,
#                                 bypass on protected branches staging/production
#   CLERK_SECRET_KEY              SSR runtime secret (test key for staging; live for prod cutover)
#
# Optional:
#   CLERK_SECRET_KEY_PROD         If set, stored in Infisical prod instead of CLERK_SECRET_KEY
#
# Usage:
#   export INFISICAL_MACHINE_CLIENT_ID=...
#   export INFISICAL_MACHINE_CLIENT_SECRET=...
#   export PROMOTE_TOKEN=ghp_...
#   export CLERK_SECRET_KEY=sk_test_...
#   ./scripts/bootstrap-deployment-secrets.sh

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

require_var() {
	if [ -z "${!1:-}" ]; then
		echo "Missing required env var: $1" >&2
		exit 1
	fi
}

require_var INFISICAL_MACHINE_CLIENT_ID
require_var INFISICAL_MACHINE_CLIENT_SECRET
require_var PROMOTE_TOKEN
require_var CLERK_SECRET_KEY

STAGING_CLERK="$CLERK_SECRET_KEY"
PROD_CLERK="${CLERK_SECRET_KEY_PROD:-$CLERK_SECRET_KEY}"

echo "Setting Infisical staging runtime secrets..."
infisical secrets set --env=staging \
	"CLERK_SECRET_KEY=${STAGING_CLERK}" \
	--silent

echo "Setting Infisical prod runtime secrets..."
infisical secrets set --env=prod \
	"CLERK_SECRET_KEY=${PROD_CLERK}" \
	--silent

echo "Setting GitHub Actions bootstrap secrets..."
gh secret set INFISICAL_MACHINE_CLIENT_ID --body "$INFISICAL_MACHINE_CLIENT_ID"
gh secret set INFISICAL_MACHINE_CLIENT_SECRET --body "$INFISICAL_MACHINE_CLIENT_SECRET"
gh secret set PROMOTE_TOKEN --body "$PROMOTE_TOKEN"

echo "Removing migrated app secrets from GitHub (optional rollback: re-add manually)..."
for secret in CLERK_SECRET_KEY CONVEX_URL DOKPLOY_WEBHOOK_URL VITE_CLERK_PUBLISHABLE_KEY VITE_CONVEX_URL VITE_STRIPE_PUBLISHABLE_KEY; do
	gh secret delete "$secret" --yes 2>/dev/null || true
done

echo "Done. Verify Infisical machine identity can read dev, staging, and prod."
