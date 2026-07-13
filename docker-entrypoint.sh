#!/bin/sh
# Bootstraps runtime secrets from Infisical before starting the app, so
# Dokploy only needs to hold the Infisical machine-identity credentials
# instead of every individual secret (e.g. CLERK_SECRET_KEY).
#
# Required in the container environment (set in Dokploy):
#   INFISICAL_MACHINE_CLIENT_ID
#   INFISICAL_MACHINE_CLIENT_SECRET
#
# Optional overrides (sensible defaults baked in below):
#   INFISICAL_PROJECT_ID   (defaults to the Tavli workspace id)
#   INFISICAL_ENV          (defaults to "prod")
#   INFISICAL_API_URL      (defaults to the self-hosted Infisical domain)
#
# If the machine-identity credentials aren't set, falls back to starting
# the app with whatever environment variables were injected directly —
# this keeps the image compatible with the previous "set everything
# manually in Dokploy" workflow.
set -eu

INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-da9416bf-a247-4f41-b4c0-14b22f0aaff0}"
INFISICAL_ENV="${INFISICAL_ENV:-prod}"
INFISICAL_API_URL="${INFISICAL_API_URL:-https://infisical.gggfox.com}"

if [ -n "${INFISICAL_MACHINE_CLIENT_ID:-}" ] && [ -n "${INFISICAL_MACHINE_CLIENT_SECRET:-}" ]; then
	INFISICAL_TOKEN=$(infisical login \
		--method=universal-auth \
		--client-id="$INFISICAL_MACHINE_CLIENT_ID" \
		--client-secret="$INFISICAL_MACHINE_CLIENT_SECRET" \
		--domain="$INFISICAL_API_URL" \
		--plain --silent)
	export INFISICAL_TOKEN

	exec infisical run \
		--token="$INFISICAL_TOKEN" \
		--projectId="$INFISICAL_PROJECT_ID" \
		--env="$INFISICAL_ENV" \
		--domain="$INFISICAL_API_URL" \
		--silent \
		-- "$@"
fi

echo "docker-entrypoint: INFISICAL_MACHINE_CLIENT_ID/SECRET not set — starting without Infisical." >&2
exec "$@"
