#!/usr/bin/env bash
#
# Post-deploy health gate.
#
# Accepting a rollout is not the same as serving it: Dokploy returns success as
# soon as it has queued the deployment. This polls the public /health route
# until it reports the exact commit this run built, so "the deploy silently did
# nothing" fails the job instead of going unnoticed.
#
# On timeout it classifies *how* it failed, because the remediations are not the
# same. Serving a stale build points at the rollout (Dokploy kept the old
# container); serving nothing points at the container (it never came up).
# Reporting both as "the deploy may have failed" is what made the 2026-07-19 →
# 2026-07-26 stale-rollout incident take a week to read correctly.
#
# Environment:
#   HEALTH_BASE_URL   public base URL, no trailing slash
#   EXPECTED_SHA      commit this run built
#   EXPECTED_IMAGE    immutable image reference that should be running
#   TIMEOUT_SECONDS   optional, default 300
#   INTERVAL_SECONDS  optional, default 10
set -euo pipefail

: "${HEALTH_BASE_URL:?HEALTH_BASE_URL is required}"
: "${EXPECTED_SHA:?EXPECTED_SHA is required}"

HEALTH_URL="${HEALTH_BASE_URL%/}/health"
EXPECTED_IMAGE="${EXPECTED_IMAGE:-<unknown>}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-300}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-10}"
DEADLINE=$((SECONDS + TIMEOUT_SECONDS))

attempt=0
last_failure="unreachable"
last_sha=""
last_status=""

echo "Polling $HEALTH_URL for sha $EXPECTED_SHA (timeout ${TIMEOUT_SECONDS}s, interval ${INTERVAL_SECONDS}s)"
echo "Expecting image $EXPECTED_IMAGE"

while [ "$SECONDS" -lt "$DEADLINE" ]; do
	attempt=$((attempt + 1))
	body="$(mktemp)"
	status="$(curl -sS --max-time 10 -o "$body" -w '%{http_code}' "$HEALTH_URL")" || status="000"

	case "$status" in
	200)
		observed="$(jq -r '.sha // empty' <"$body" 2>/dev/null || true)"
		if [ "$observed" = "$EXPECTED_SHA" ]; then
			echo "Health gate passed on attempt $attempt: $HEALTH_URL reports sha $observed"
			rm -f "$body"
			exit 0
		fi
		if [ -n "$observed" ]; then
			last_failure="stale"
			last_sha="$observed"
			echo "Attempt $attempt: serving sha '$observed', expected '$EXPECTED_SHA' (rollout not applied yet)"
		else
			last_failure="malformed"
			echo "Attempt $attempt: HTTP 200 but no .sha field in the response body"
		fi
		;;
	404)
		last_failure="route-missing"
		echo "Attempt $attempt: HTTP 404 — the running build predates the /health route"
		;;
	000)
		last_failure="unreachable"
		echo "Attempt $attempt: no response from $HEALTH_URL"
		;;
	*)
		last_failure="http-error"
		last_status="$status"
		echo "Attempt $attempt: HTTP $status"
		;;
	esac

	rm -f "$body"
	sleep "$INTERVAL_SECONDS"
done

echo "::group::Deploy diagnosis"
case "$last_failure" in
stale)
	cat <<EOF
$HEALTH_BASE_URL is healthy, but it is serving a DIFFERENT build than this run pushed:

  expected  $EXPECTED_SHA
  serving   $last_sha

This workflow run did its job — the image was built and pushed to GHCR. Dokploy
accepted the rollout and then did not replace the container. Check, in order:

  1. Dokploy -> app -> Deployments: did a deployment start for this commit, and
     did it succeed?
  2. Dokploy -> app -> General -> Docker image: it must be the immutable
     per-commit reference ($EXPECTED_IMAGE), not a mutable :staging /
     :production tag. A mutable tag can be satisfied from the server's local
     image cache, serving an old build indefinitely while every check stays
     green. If it still shows a mutable tag, this run used the legacy webhook
     fallback — set DOKPLOY_API_URL / DOKPLOY_API_KEY / DOKPLOY_APPLICATION_ID
     in this environment's Infisical project.
  3. Dokploy -> app -> Logs: a new container that crashes on boot (for example
     missing INFISICAL_MACHINE_CLIENT_ID/SECRET) gets rolled back, leaving the
     previous container serving.
EOF
	;;
route-missing)
	cat <<EOF
$HEALTH_URL returns 404. The route has shipped in every build since 2026-07-19,
so a 404 means the running container is older than that — this environment has
not taken a new image in a long time.

Treat this as a stale rollout: check Dokploy -> app -> Deployments and confirm
the app's Docker image is the immutable per-commit reference
($EXPECTED_IMAGE) rather than a mutable :staging / :production tag.
EOF
	;;
unreachable)
	cat <<EOF
$HEALTH_URL never answered. Nothing healthy is behind Traefik — this is the 502
class from the 2026-07-13 outage, not a stale build.

Check that the container started at all (Dokploy -> app -> Logs). A container
that exits on boot leaves Traefik with no backend.
EOF
	;;
http-error)
	cat <<EOF
$HEALTH_URL answered HTTP $last_status. The container is up but the server is
erroring, which is almost always a missing or mismatched runtime secret.

Read the container logs: 'Clerk: no secret key provided' or
'starting without Infisical.' both mean the Infisical machine-identity
credentials are missing from the Dokploy app's environment.
EOF
	;;
malformed)
	cat <<EOF
$HEALTH_URL answered 200 but without a .sha field. Either something other than
the app is answering on this domain (a proxy or placeholder page), or the route
was changed without updating this gate.
EOF
	;;
esac
echo "::endgroup::"

echo "::error::Health gate timed out after ${TIMEOUT_SECONDS}s — $HEALTH_URL never reported sha $EXPECTED_SHA (failure mode: $last_failure). See the deploy diagnosis above."
exit 1
