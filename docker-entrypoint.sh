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
	# Handle the login failure explicitly rather than letting `set -e` kill the
	# script silently. A stale client secret makes this return 401 in ~400ms, so
	# the container exits(1) almost instantly and the orchestrator quietly keeps
	# the previous task running — the site then serves an old build, at HTTP 200,
	# indefinitely. That is exactly how staging and production both sat on a
	# 2026-07-19 build for a week: the secret had been rotated for CI and never
	# copied to the Dokploy apps. Name the cause on the way out.
	if ! INFISICAL_TOKEN=$(infisical login \
		--method=universal-auth \
		--client-id="$INFISICAL_MACHINE_CLIENT_ID" \
		--client-secret="$INFISICAL_MACHINE_CLIENT_SECRET" \
		--domain="$INFISICAL_API_URL" \
		--plain --silent 2>/tmp/infisical-login.err); then
		echo "docker-entrypoint: FATAL — Infisical machine-identity login failed; the container cannot start." >&2
		sed 's/^/docker-entrypoint:   /' /tmp/infisical-login.err >&2 || true
		echo "docker-entrypoint: if this is 'Invalid credentials', the Universal Auth client secret for this identity has been rotated." >&2
		echo "docker-entrypoint: generate a fresh one in Infisical and update INFISICAL_MACHINE_CLIENT_SECRET on this Dokploy app." >&2
		exit 1
	fi
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
