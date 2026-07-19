import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

import { config } from "@/global/utils/config";

/**
 * Liveness/readiness endpoint used by the container `HEALTHCHECK` and the
 * post-deploy health gate in `.github/workflows/deploy.yml`. Returns 200 with
 * the git SHA baked into this build so a deploy can confirm the just-pushed
 * image is the one actually serving (not a stale container left behind by a
 * failed redeploy — the failure mode behind the 2026-07 staging outage).
 *
 * Pure server handler with no auth dependency: it must answer for anonymous
 * callers (Docker healthcheck on localhost, CI curling the public domain).
 */
export const Route = createFileRoute("/health")({
	server: {
		handlers: {
			GET: () =>
				json({
					status: "ok",
					sha: config.gitSha,
				}),
		},
	},
});
