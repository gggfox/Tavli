# Postmortem — Staging & production served stale builds, 2026-07-17 → 2026-07-26

**Status:** Root cause confirmed; fix in [#77](https://github.com/gggfox/Tavli/pull/77)
**Severity:** High (every deploy was a no-op; production ran a 9-day-old build)
**Environments affected:** `staging.tavliai.com` and `tavliai.com`
**Author:** Incident response, 2026-07-26

---

## Summary

For over a week, **every deploy silently did nothing**. GitHub Actions built the app,
deployed Convex, pushed the image to GHCR, and got an HTTP 200 back from the Dokploy
webhook — but Dokploy never replaced the running container. Both environments kept
serving an old build while returning 200 to every request, so there was no outage, no
error page, and no user-visible symptom of any kind.

- **staging** last adopted a new image on **2026-07-19** (`79925f5`). The 8 failed and 4
  cancelled deploy runs after it changed nothing that was actually serving.
- **production** last adopted a new image on **2026-07-17** (`a014b19`) — old enough
  that it predates the `/health` route, which is why `tavliai.com/health` returned 404.

This is the inverse of the [2026-07-13 → 07-17 outage](./2026-07-17-staging-bad-gateway.md): that
one failed loudly (502, nothing running) and took 4 days to notice. This one never failed
at all from the outside. The only reason it was caught is the post-deploy health gate
added as action item #5 of that postmortem — its first real catch.

---

## Impact

- **What:** Every merge to `staging`, and one **Promote to Production**, appeared to
  deploy and did not. Nine days of backend/frontend changes — including the TAVLI-61/62/63
  hardening work and a Stripe refund fix — were never actually running.
- **Who:** Anyone testing on staging was testing a build from 2026-07-19. Anyone using
  production was on a build from 2026-07-17.
- **Duration:** production ~9 days, staging ~7 days.
- **Data:** None. Convex deploys **did** succeed throughout (they do not go through
  Dokploy), so the backend moved ahead while the frontend container stayed behind — a
  skew that had not yet caused a visible break, but could have.

---

## Root cause

**The pipeline had no way to say which image should run, and no way to learn whether the
rollout happened.**

The deploy's last step curled a Dokploy webhook. That webhook carries no image identity —
it means only "redeploy the application you already have configured", and that
configuration was a **mutable tag** (`ghcr.io/gggfox/tavli:staging` /
`:production`). Dokploy answers **200 as soon as it has queued the request**, which says
nothing about whether a new container ever replaced the old one.

So the pipeline's success condition was "Dokploy acknowledged a message", not "the new
build is serving". Every possible Dokploy-side failure — a pull that resolved to a cached
image, a container that crashed and got rolled back, a deployment that never started —
produces exactly the same green step.

Evidence collected on 2026-07-26 (run
[30214232953](https://github.com/gggfox/Tavli/actions/runs/30214232953)):

| Fact                               | Value                                               |
| ---------------------------------- | --------------------------------------------------- |
| Image the run pushed               | `sha256:6eeb336…`                                   |
| GHCR `:staging` resolves to        | `sha256:6eeb336…` — **registry was correct**        |
| Digest actually serving on staging | `sha256:db2137d…` (the `79925f5` image, 7 days old) |
| Dokploy webhook response           | HTTP 200                                            |

The registry was right and CI was right. The gap is entirely between "Dokploy said OK"
and "a new container is serving".

### The rollouts ran, reported success, and did nothing

Dokploy's **Deployments** tab for the production `frontend` app shows the webhook was
received and acted on every time — and how long each took:

| Dokploy deployment         | Duration | Corresponding workflow run                |
| -------------------------- | -------- | ----------------------------------------- |
| `NEW CHANGES` — Done       | **3s**   | Deploy Production `42b94dc`, 07-26 (red)  |
| `NEW CHANGES` — Done       | **5s**   | Deploy Production `79925f5`, 07-19 (red)  |
| `Manual deployment` — Done | **0s**   | manual redeploy during the 07-17 incident |

**The durations are the tell.** The image is `node:22-slim` plus the Infisical CLI plus
the `.output` bundle — hundreds of MB. A deployment that genuinely pulls a new image and
recreates the container cannot finish in 3 seconds. "Done" here means Dokploy ran its
routine and found nothing to do, while `tavliai.com/health` kept 404ing — which is only
possible if the container predates 2026-07-19.

This rules out two of the three original candidates: the deployment did **not** fail to
start (it started and completed), and the new container did **not** crash and roll back
(that takes far longer than 3s and would not report green).

### Confirmed: the mutable tag is never re-resolved against the registry

Querying `application.one` for both apps settled the last candidate — the configured
image was correct all along:

| Environment | Dokploy app             | `sourceType` | Configured `dockerImage`          |
| ----------- | ----------------------- | ------------ | --------------------------------- |
| staging     | `tavli-frontend-7bdzi6` | `docker`     | `ghcr.io/gggfox/tavli:staging`    |
| prod        | `tavli-frontend-0wcgnf` | `docker`     | `ghcr.io/gggfox/tavli:production` |

Both point at exactly the tags CI pushes, and GHCR's `:staging` was already shown to hold
the newly-built digest. So the reference was right, the registry was right, and the
container still ran a week-old image.

**That leaves exactly one mechanism: the mutable tag is not re-resolved at deploy time.**
Docker finds `ghcr.io/gggfox/tavli:staging` already present locally, skips the pull, and
recreates the container from the cached image — which is why a "deployment" of a
several-hundred-MB image completed in 3 seconds and reported success. The environment was
pinned to whichever build happened to be pulled first, permanently.

This is the deepest form of the bug, because **nothing was misconfigured**. Every
individual piece — the tag, the registry, the webhook, the Dokploy app — was exactly as
intended. The pipeline was still incapable of delivering a new build, because a mutable
tag carries no information about whether it changed.

Pinning the immutable `:<sha>` reference is a structural fix rather than a corrected
setting: a per-commit tag cannot already exist in the local cache, so the pull is forced
every time.

---

## Contributing factors

1. **Mutable image tags.** `:staging` / `:production` cannot distinguish "pulled the new
   build" from "reused the old one". The pipeline already pushed an immutable `:<sha>`
   tag alongside them — nothing consumed it.
2. **The webhook is fire-and-forget.** It conveys neither which image to run nor whether
   the rollout succeeded, yet its 200 was the pipeline's definition of a successful deploy.
3. **Failing silently to the outside.** Unlike the 502 incident, both sites returned 200
   the entire time. Nothing short of comparing the running commit to the expected one
   could have caught this.
4. **The health gate's message conflated two different failures.** It said "may be
   serving a stale build **or nothing at all**" for both cases. Staging (stale build) and
   production (404, no `/health` route at all) were the same sentence, so eight red runs
   read as one vague "deploy is flaky" rather than "the rollout is a no-op".
5. **`cancel-in-progress: true` on deploys.** Four runs were cancelled mid-deploy by a
   following push. A cancellation between "image pushed" and "Dokploy notified" drops that
   commit's rollout entirely, with no error anywhere.
6. **Alerting worked and was not acted on.** Issues [#67](https://github.com/gggfox/Tavli/issues/67)
   (7 comments) and [#63](https://github.com/gggfox/Tavli/issues/63) were open the whole
   time. The detection gap from the last postmortem is closed; the **triage** gap is not.

---

## Detection

Automated, by the post-deploy health gate — action item #5 of the previous postmortem,
shipped in `17e1957` five days before this was diagnosed. It failed correctly on every
single deploy from 2026-07-19 onward. This incident is the gate working exactly as
designed; the failure was in reading it.

---

## Resolution

Pipeline changes (this PR):

1. **Roll out an immutable image.** The deploy now calls Dokploy's API —
   `application.saveDockerProvider` to pin the app to `ghcr.io/gggfox/tavli:<sha>`, then
   `application.deploy` — instead of firing a blind webhook. Because the reference is
   different on every deploy, a cached image can never satisfy the pull. See
   `.github/scripts/dokploy-rollout.sh`. Falls back to the old webhook (with a warning)
   when the API credentials are absent, so no environment breaks before it is configured.
2. **Classify health-gate failures.** `.github/scripts/health-gate.sh` now distinguishes
   _stale build_ / _route missing_ / _unreachable_ / _HTTP error_ / _malformed_, prints
   expected-vs-serving SHAs, and gives the remediation for that specific class.
3. **Stop cancelling in-flight deploys.** `cancel-in-progress: false` — deploys queue
   rather than abort partway through.

Configuration, done 2026-07-26:

4. `DOKPLOY_API_URL`, `DOKPLOY_API_KEY` and `DOKPLOY_APPLICATION_ID` are set in Infisical
   `staging` and `prod`, which activates the API path above. (The API key is generated at
   **`/dashboard/settings/profile` → API/CLI** — the **user profile** page. The
   organization settings sidebar has no API entry, which is easy to lose five minutes to.)

   To re-derive the application ids, or to re-check what each app is configured to run:

   ```sh
   curl -sS -H "x-api-key: $DOKPLOY_API_KEY" \
     "$DOKPLOY_API_URL/api/application.one?applicationId=$DOKPLOY_APPLICATION_ID" \
     | jq -r '"\(.appName)  source=\(.sourceType)  image=\(.dockerImage // "<none>")"'
   ```

Still required, by hand:

5. Verify the **production** app has `INFISICAL_ENV=prod` + machine-identity creds —
   still-open action item #6 from the previous postmortem. It was not the cause here, but
   it is latent: the first genuinely-new container production has pulled since 2026-07-17
   will be the first to expose it.

---

## Lessons learned

- **"The deploy tool accepted my request" is not a deploy.** A pipeline step that cannot
  observe the outcome it claims should not be the step that decides the job is green.
- **Deploy by immutable reference.** A mutable tag makes "did the rollout happen?"
  unanswerable after the fact. The per-commit tag existed already and was simply unused.
- **Nothing was misconfigured.** The tag, the registry, the webhook and both Dokploy apps
  were all exactly as designed — and the pipeline still could not deliver a build for nine
  days. Looking for the wrong setting would never have found this; the defect was in the
  shape of the pipeline, not its values. Bugs of this class are invisible to review that
  asks "is each piece correct?" instead of "can this arrangement fail silently?".
- **A silent success is worse than a loud failure.** The 502 incident was fixed in 4 days
  because it was visible; this one lasted longer precisely because everything returned 200.
- **A diagnostic that lumps two failure modes together costs more than no diagnostic.**
  The gate caught this on day one; the wording is what let eight red runs go unread.
- **Detection without triage is not coverage.** The alert issues did their job. Nobody
  opened them.

---

## Action items

| #   | Action                                                                                         | Rationale                                     | Owner | Status                 |
| --- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- | ----- | ---------------------- |
| 1   | Roll out the immutable `:<sha>` image via the Dokploy API instead of the webhook               | Makes a cached/stale rollout impossible       | —     | ✅ Done (this PR)      |
| 2   | Classify health-gate failures and print expected-vs-serving SHA                                | Eight red runs read as one vague failure      | —     | ✅ Done (this PR)      |
| 3   | `cancel-in-progress: false` on deploys                                                         | A cancelled deploy drops a rollout            | —     | ✅ Done (this PR)      |
| 4   | Add `DOKPLOY_API_URL` / `DOKPLOY_API_KEY` / `DOKPLOY_APPLICATION_ID` to Infisical staging+prod | Activates item 1; webhook fallback until then | —     | ✅ Done (2026-07-26)   |
| 5   | Confirm the Dokploy-side mechanism                                                             | Was inferred; now proven — cached mutable tag | —     | ✅ Done (2026-07-26)   |
| 6   | Verify production Dokploy has `INFISICAL_ENV=prod` + machine creds                             | Latent since 2026-07-17; candidate cause 2    | —     | ☐ Todo (needs Dokploy) |
| 7   | Route `deploy-failure` issues somewhere they get triaged                                       | Alerts fired for 7 days and were not read     | —     | ☐ Todo                 |

---

## Timeline (UTC)

| Time              | Event                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| 2026-07-17 17:00  | Last **successful** production deploy (`a014b19`). Production serves this build until further notice.           |
| 2026-07-19 ~14:00 | `17e1957` adds the `/health` route + post-deploy health gate (previous postmortem, action #5).                  |
| 2026-07-19 15:00  | Last **successful** staging deploy (`79925f5`). Staging serves this build until further notice.                 |
| 2026-07-19 15:04  | Deploy Production fails the new gate — production's build predates `/health`, so it 404s.                       |
| 2026-07-19 16:19  | First failing staging deploy (`aa404d8`, a Convex-only commit). The gate times out on a stale SHA.              |
| 2026-07-19 → 26   | 8 failed + 4 cancelled staging deploys. Issues #67 and #63 accumulate comments. Both sites keep returning 200.  |
| 2026-07-26 02:00  | Promote to Production → Deploy Production fails the gate again.                                                 |
| 2026-07-26 18:12  | Latest staging deploy (`52153fd`) fails the gate.                                                               |
| 2026-07-26 ~19:00 | Investigation: GHCR `:staging` digest matches the pushed image, the serving digest does not. Root cause scoped. |
