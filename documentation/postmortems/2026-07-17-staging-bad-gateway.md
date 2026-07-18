# Postmortem — Staging down (502 Bad Gateway), 2026-07-13 → 2026-07-17

**Status:** Resolved
**Severity:** High (staging fully unavailable)
**Environments affected:** `staging.tavliai.com` only (production unaffected)
**Author:** Incident response, 2026-07-17

---

## Summary

`staging.tavliai.com` served **502 Bad Gateway** for roughly four days. The root cause
was a `.dockerignore` whitelist that excluded `docker-entrypoint.sh` from the Docker
build context, so **every staging image build failed** and no container was ever
started behind Traefik. A second, latent misconfiguration (the staging Dokploy app was
missing its Infisical machine-identity credentials) surfaced only once the build was
fixed, briefly turning the 502 into a **500** until the runtime secrets were wired up.

One-line fix for the outage: add `!docker-entrypoint.sh` to `.dockerignore`
(commit `a014b19`).

---

## Impact

- **What:** `staging.tavliai.com` returned 502 for all requests; no application
  container was running.
- **Who:** Anyone using staging (internal testing, QA, demos). No customer/production
  impact — `tavliai.com` was unaffected.
- **Duration:** ~4 days. Introduced by commit `86c9133` (2026-07-13), detected and
  resolved 2026-07-17.
- **Data:** None. No data loss or corruption; this was an availability-only incident.

---

## How the deploy pipeline works (context)

Staging deploys are fully automated (`.github/workflows/deploy-staging.yml` →
reusable `.github/workflows/deploy.yml`):

1. Push to the `staging` branch triggers **Deploy Staging**.
2. The runner builds the app (`pnpm build` → `.output`), runs `convex deploy`, then
   **builds and pushes** the Docker image `ghcr.io/gggfox/tavli:staging`.
3. **Only if the image push succeeds**, the final step curls the Dokploy webhook, which
   tells Dokploy to pull the new image and redeploy the container.
4. Dokploy's Traefik proxies `staging.tavliai.com` to that container on port `3000`.
   With no healthy container, Traefik returns **502 Bad Gateway**.

The container starts via `docker-entrypoint.sh`, which logs into Infisical using a
machine identity and injects runtime secrets (notably `CLERK_SECRET_KEY`) before
`exec`-ing the Node server. See `Dockerfile` and `docker-entrypoint.sh`.

---

## Root cause

`.dockerignore` is a **whitelist**:

```
*
!.output
```

`*` ignores the entire build context; `!.output` re-includes only the build artifact.

Commit `86c9133` ("Add Infisical docker entrypoint for runtime secrets") added a new
file and a matching COPY to the `Dockerfile`:

```dockerfile
COPY docker-entrypoint.sh ./docker-entrypoint.sh   # Dockerfile:15
```

…but **did not** add `!docker-entrypoint.sh` to `.dockerignore`. Because the file was
excluded from the build context, `docker build` failed at that COPY:

```
failed to compute cache key: failed to calculate checksum of ref ...:
"/docker-entrypoint.sh": not found
buildx failed with: ERROR: failed to build: failed to solve: ...
```

Every **Deploy Staging** run after `86c9133` failed at "Build and push runtime image".
Because that step failed, the **Dokploy webhook step never ran**, so Dokploy was never
told to redeploy. A subsequent manual redeploy in Dokploy then replaced the previously
running container with nothing pullable, leaving **zero containers** → 502.

---

## Contributing factors

1. **`.dockerignore` whitelist is a footgun.** With `* ` + `!allowlist`, every new
   build-context file the Dockerfile needs must be explicitly re-included. Adding a
   `COPY` without a matching `!` line silently breaks the build. This coupling is easy
   to miss in review because the two files are edited independently.
2. **Failure was silent to humans.** The GitHub Actions run failed, but there was no
   alert/notification. The break sat undetected for ~4 days until someone opened the
   site.
3. **No container healthcheck / deploy gate.** Neither the Dockerfile nor Dokploy
   defines a healthcheck, and nothing verifies the site returns 200 after a deploy, so
   "no running container" produced no signal beyond the raw 502.
4. **Latent staging env misconfiguration.** The staging Dokploy app had only
   `NODE_ENV`/`PORT` set — it was never configured with the Infisical machine-identity
   credentials the new entrypoint expects. This was masked entirely by the build
   failure and only surfaced (as a 500) once the build was fixed.
5. **`INFISICAL_ENV` defaults to `prod`.** `docker-entrypoint.sh` defaults
   `INFISICAL_ENV` to `prod`; a staging box that sets the machine creds but forgets
   `INFISICAL_ENV=staging` would silently pull **production** secrets.

---

## Detection

Manual. A user opened `staging.tavliai.com`, saw "Bad Gateway", and reported it. There
was no automated alert.

---

## Resolution & recovery

1. **Fixed the build** — added `!docker-entrypoint.sh` to `.dockerignore`
   (commit `a014b19`, pushed to both `staging` and `main` to avoid branch divergence).
   Deploy Staging then went green: image built and pushed, Dokploy webhook fired,
   container came up. Site moved from **502 → 500**.
2. **Diagnosed the 500** — container logs showed
   `@clerk/tanstack-react-start: Clerk: no secret key provided`. The Dokploy staging
   env held only `NODE_ENV`/`PORT`, so the entrypoint took its "no Infisical" fallback
   and started without `CLERK_SECRET_KEY`.
3. **Wired up runtime secrets** — added to the staging Dokploy app's environment:
   `INFISICAL_ENV=staging`, `INFISICAL_MACHINE_CLIENT_ID`,
   `INFISICAL_MACHINE_CLIENT_SECRET` (Universal-Auth creds for the `github-dokploy-ci`
   identity, which has Viewer access to the Tavli Infisical project). Redeployed.
4. **Verified** — container logs showed `Injecting 10 Infisical secrets` and
   `Listening on http://[::]:3000` with no errors; `staging.tavliai.com` returned
   **200** and served the app (Clerk + Convex initializing SSR-side).

---

## Lessons learned

- A whitelist `.dockerignore` tightly couples `Dockerfile` COPY lines to allowlist
  entries; that coupling needs a guard, not vigilance.
- A failed deploy that leaves the previous container replaced-by-nothing degrades to a
  hard outage with no signal. Deploys need a post-deploy health gate and failure
  alerting.
- Runtime-secret configuration for a Dokploy app is a required, easily-forgotten manual
  step that is invisible until the container actually boots.

---

## Action items

| #   | Action                                                                                                                                     | Rationale                             | Owner | Status              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ----- | ------------------- |
| 1   | Fix `.dockerignore` (`!docker-entrypoint.sh`)                                                                                              | Restore staging                       | —     | ✅ Done (`a014b19`) |
| 2   | Configure staging Dokploy env with Infisical machine identity                                                                              | Runtime secrets                       | —     | ✅ Done             |
| 3   | Add a CI guard that fails if the `Dockerfile` `COPY`s a path not re-included in `.dockerignore` (or switch `.dockerignore` to a blacklist) | Prevent recurrence of the exact break | —     | ☐ Todo              |
| 4   | Add failure alerting to the deploy workflows (notify on red)                                                                               | Cut 4-day detection gap               | —     | ☐ Todo              |
| 5   | Add a post-deploy health gate (curl the domain for 200; fail/alert otherwise) and/or a container `HEALTHCHECK`                             | Turn silent 502 into a signal         | —     | ☐ Todo              |
| 6   | Verify the **production** Dokploy app has `INFISICAL_MACHINE_CLIENT_ID/SECRET` + `INFISICAL_ENV=prod` before the next promotion            | Same latent misconfig would 500 prod  | —     | ☐ Todo              |
| 7   | Document the per-app Dokploy runtime-secret setup in a runbook                                                                             | Make the manual step discoverable     | —     | ☐ Todo              |

---

## Timeline (UTC)

| Time               | Event                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-13 ~05:32  | Commit `86c9133` adds `COPY docker-entrypoint.sh` without updating `.dockerignore`.                                                                            |
| 2026-07-13 → 07-17 | Every **Deploy Staging** run fails at "Build and push runtime image"; a manual Dokploy redeploy leaves no running container. `staging.tavliai.com` serves 502. |
| 2026-07-17 ~09:00  | Incident reported. Root cause traced to `.dockerignore` via the failing Actions run (`"/docker-entrypoint.sh": not found`).                                    |
| 2026-07-17 ~09:05  | `.dockerignore` fix (`a014b19`) pushed to `staging` + `main`. Deploy Staging goes green; site is 502 → 500.                                                    |
| 2026-07-17 ~09:11  | 500 diagnosed as missing `CLERK_SECRET_KEY` (Infisical fallback).                                                                                              |
| 2026-07-17 ~09:40  | Staging Dokploy env configured with Infisical machine identity; redeployed.                                                                                    |
| 2026-07-17 ~09:41  | `staging.tavliai.com` returns 200; logs clean. Resolved.                                                                                                       |
