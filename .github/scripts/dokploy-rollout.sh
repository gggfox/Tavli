#!/usr/bin/env bash
#
# Tell Dokploy which image to run, then deploy it.
#
# Preferred path (Dokploy API). Pins the application to the *immutable*
# per-commit reference `ghcr.io/<owner>/tavli:<sha>` via
# `application.saveDockerProvider`, then triggers `application.deploy`. Because
# the reference is different on every deploy, Docker can never satisfy the pull
# from a locally cached layer — a stale rollout becomes impossible rather than
# merely unlikely.
#
# Fallback path (legacy webhook). Curls $DOKPLOY_WEBHOOK_URL, which asks Dokploy
# to redeploy whatever image it is already configured with — a *mutable*
# `:staging` / `:production` tag. Dokploy answers 200 whether or not it then
# actually replaces the container, so this path cannot distinguish "rolled out"
# from "reused the cached image". That is exactly how staging and production
# both served a 2026-07-19 build for a week while every workflow step was green
# (documentation/postmortems/2026-07-26-stale-dokploy-rollout.md). Kept only so
# this workflow still deploys for an environment whose Infisical project has not
# been given the API credentials yet.
#
# Injected by `infisical run` (per environment):
#   Preferred  DOKPLOY_API_URL, DOKPLOY_API_KEY, DOKPLOY_APPLICATION_ID
#   Fallback   DOKPLOY_WEBHOOK_URL
# Passed by the workflow:
#   IMAGE_REF     immutable ghcr.io reference to roll out
#   DEPLOY_TITLE  label shown in Dokploy's deployment history
set -euo pipefail

: "${IMAGE_REF:?IMAGE_REF is required}"
DEPLOY_TITLE="${DEPLOY_TITLE:-$IMAGE_REF}"

# `curl --config` keeps the key out of the process table (and therefore out of
# anything that shells out to `ps`); add-mask keeps it out of the run log even
# if Dokploy echoes it back in an error body. Secrets reaching us via
# `infisical run` are not registered as GitHub secrets, so they are not masked
# automatically the way `secrets.*` values are.
if [ -n "${DOKPLOY_API_KEY:-}" ] && [ -n "${DOKPLOY_APPLICATION_ID:-}" ] && [ -n "${DOKPLOY_API_URL:-}" ]; then
	echo "::add-mask::$DOKPLOY_API_KEY"
	echo "::add-mask::$DOKPLOY_APPLICATION_ID"

	CURL_CONFIG="$(mktemp)"
	trap 'rm -f "$CURL_CONFIG"' EXIT
	chmod 600 "$CURL_CONFIG"
	printf 'header = "x-api-key: %s"\n' "$DOKPLOY_API_KEY" >"$CURL_CONFIG"

	api_post() {
		local endpoint="$1" payload="$2" body status
		body="$(mktemp)"
		status="$(
			curl -sS --max-time 30 --config "$CURL_CONFIG" \
				-o "$body" -w '%{http_code}' \
				-X POST "${DOKPLOY_API_URL%/}/api/${endpoint}" \
				-H 'Content-Type: application/json' \
				--data "$payload"
		)" || status="000"

		if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
			echo "::error::Dokploy ${endpoint} failed with HTTP ${status}: $(tr -d '\n' <"$body" | head -c 500)"
			rm -f "$body"
			return 1
		fi
		rm -f "$body"
		echo "Dokploy ${endpoint} → HTTP ${status}"
	}

	# username/password/registryUrl are declared `z.string()` (required, not
	# nullable) by Dokploy's apiSaveDockerProvider schema. Empty strings mean
	# "no registry auth", which is correct here: the image is public on GHCR by
	# design, because secrets are fetched at runtime rather than baked in.
	echo "Pinning Dokploy application to $IMAGE_REF"
	api_post application.saveDockerProvider "$(
		jq -n \
			--arg applicationId "$DOKPLOY_APPLICATION_ID" \
			--arg dockerImage "$IMAGE_REF" \
			'{
				applicationId: $applicationId,
				dockerImage: $dockerImage,
				username: "",
				password: "",
				registryUrl: ""
			}'
	)"

	api_post application.deploy "$(
		jq -n \
			--arg applicationId "$DOKPLOY_APPLICATION_ID" \
			--arg title "$DEPLOY_TITLE" \
			'{applicationId: $applicationId, title: $title}'
	)"

	echo "Dokploy accepted the rollout of $IMAGE_REF; the health gate verifies it actually serves."
	exit 0
fi

if [ -z "${DOKPLOY_WEBHOOK_URL:-}" ]; then
	echo "::error::No Dokploy rollout mechanism configured. Set DOKPLOY_API_URL, DOKPLOY_API_KEY and DOKPLOY_APPLICATION_ID (preferred) or DOKPLOY_WEBHOOK_URL in this environment's Infisical project."
	exit 1
fi

echo "::warning::DOKPLOY_API_URL/DOKPLOY_API_KEY/DOKPLOY_APPLICATION_ID are not all set — falling back to the webhook, which redeploys a mutable tag and can silently reuse a cached image. See documentation/internal-guides/deployment-and-secrets.md."

status="$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' "$DOKPLOY_WEBHOOK_URL")" || status="000"
echo "Dokploy webhook → HTTP $status"
if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
	echo "::error::Dokploy webhook failed with HTTP $status"
	exit 1
fi
