# Postmortem — Every deploy was a no-op, 2026-07-17 → 2026-07-26

**Status:** Root cause confirmed; pipeline guards in [#77](https://github.com/gggfox/Tavli/pull/77); credential fix outstanding
**Severity:** High (nine days of changes never reached production)
**Environments affected:** `staging.tavliai.com` and `tavliai.com`
**Author:** Incident response, 2026-07-26

---

## Summary

For over a week **every deploy silently did nothing**. CI built the app, deployed
Convex, pushed the image, and told Dokploy to roll it out — all green. Dokploy pulled
the image and started a container. That container **exited(1) after ~420ms**, so the
orchestrator kept the previous healthy task, and both sites went on serving an old
build while returning HTTP 200 to every request. No outage, no error page, no symptom.

The container died because `docker-entrypoint.sh` logs into Infisical at boot with a
machine-identity client secret **stored on the Dokploy app** — and that secret is no
longer accepted. Infisical answered `401 Invalid credentials`, `set -eu` killed the
entrypoint, and the app never started. CI was unaffected because it authenticates with a
**different client secret on the same identity**, which is still valid.

- **staging** last adopted a new image **2026-07-19** (`79925f5`); 8 failed + 4 cancelled
  deploys followed, none of which changed what was serving.
- **production** last adopted a new image **2026-07-17** (`a014b19`) — old enough to
  predate the `/health` route, which is why `tavliai.com/health` returned 404.

---

## Impact

- **What:** Every merge to `staging` and one **Promote to Production** appeared to deploy
  and did not. Nine days of work — the TAVLI-61/62/63 hardening, a Stripe refund fix —
  never ran.
- **Duration:** production ~9 days, staging ~7 days.
- **Data:** None. But Convex deploys **did** succeed throughout (they don't go through
  Dokploy), so the backend advanced while the frontend stayed frozen. That skew hadn't
  broken anything visible yet; it easily could have.

---

## Root cause

**The container and CI authenticate to Infisical with two different client secrets on the
same identity. The container's stopped being accepted; CI's did not.**

`docker-entrypoint.sh` runs, before anything else:

```sh
INFISICAL_TOKEN=$(infisical login --method=universal-auth \
  --client-id="$INFISICAL_MACHINE_CLIENT_ID" \
  --client-secret="$INFISICAL_MACHINE_CLIENT_SECRET" ...)
```

Those two values live in **Dokploy → app → Environment Settings**, and are a different
copy from the one GitHub Actions holds. Dokploy's copy stopped being accepted around
2026-07-19. An identity can hold several Universal Auth client secrets at once, which is
why CI — authenticating with its own, still-valid copy — never noticed.

**Why Dokploy's copy died is not established.** Infisical returns the same
`401 Invalid credentials` for all of these, and none is distinguishable from outside:

- it was **regenerated** for CI and the new value was never copied to Dokploy (the client
  secret is one-time-view, so this is easy to do and impossible to notice), or
- it **expired** — client secrets support a TTL, or
- it **exhausted its max-uses limit** — each `infisical login`, from CI or a container
  boot, consumes one.

The distinction matters for the fix: if it was a TTL or a usage cap, **a replacement
created with the same settings will fail again on the same schedule.** Check the
identity's Universal Auth screen and set TTL `0` / max uses `0` unless there is a reason
not to.

Verified 2026-07-26 by replaying the entrypoint's exact login with the credentials read
back from each Dokploy app:

| Environment | Stored client ID                           | `infisical login` result    |
| ----------- | ------------------------------------------ | --------------------------- |
| staging     | matches the documented `github-dokploy-ci` | **401 Invalid credentials** |
| prod        | matches the documented `github-dokploy-ci` | **401 Invalid credentials** |

The identity is right; only the secret is stale. Everything downstream follows:

1. Swarm pulls the new image (confirmed — Dokploy's deployment log shows the full pull,
   digest matching CI exactly).
2. The container starts, `infisical login` 401s in ~400ms, `set -eu` exits 1.
3. The rolling update fails, so the **previous healthy task keeps serving**.
4. Dokploy reports the deployment `done`, because it only issued an async service update.
5. The site returns 200 with a week-old build. Nothing anywhere says otherwise.

Container evidence (`docker.getContainers`, 2026-07-26):

```
tavli-frontend-7bdzi6.1.tysnl170…  ghcr.io/gggfox/tavli:8d228d71…  Exited (1) — ran 421ms
tavli-frontend-7bdzi6.1.m0v5crhm…  ghcr.io/gggfox/tavli:staging    Exited (1)
tavli-frontend-0wcgnf.1.jhy5zow7…  ghcr.io/gggfox/tavli:production Exited (1)
tavli-frontend-7bdzi6.1.t2mn3dnr…  34894be87970 (untagged)         Up 7 days (healthy)
```

### Two wrong theories, and why they were wrong

Worth recording, because both were _consistent with everything visible from CI_ — which
is the actual lesson.

1. **"A mutable tag is being served from the local image cache."** Fit every symptom.
   Killed by pinning the immutable `:<sha>` tag and watching the rollout still fail: a
   per-commit tag cannot be cached, and Dokploy's log showed a genuine download.
2. **"The unpinned Infisical CLI in the Dockerfile drifted."** The CLI did drift
   (0.43.110 → 0.43.114 — the Dockerfile pins no version). Killed by extracting the dpkg
   database from both images: the last **working** build and the first **broken** build
   both shipped 0.43.110.

Both survived as long as they did because **nothing in the pipeline could see the
container**. Diagnosis only moved once the container list and its exit code were pulled
from the Dokploy API directly.

---

## Contributing factors

1. **Two independent credentials, no link between them.** CI and the container each hold
   their own client secret on the same identity, so one can lapse — by rotation, TTL, or
   a usage cap — while the other keeps working. Nothing detects it until a container
   tries to boot, and CI's continued success actively argues that nothing is wrong.
2. **A boot failure is invisible.** Dokploy's **Logs** tab showed "No logs found"; its
   deployment log ends at `✅ Pulling image completed`; the Swarm task API reports only
   `task: non-zero exit (1)`; there is no REST endpoint for container stderr. The one
   line naming the cause existed only inside `docker logs`.
3. **A failed rollout is indistinguishable from a successful one, from CI.** Dokploy
   answers 200 for "queued", and the orchestrator's rollback is a silent success.
4. **Failing safe looks identical to working.** Swarm keeping the last healthy task is
   correct behaviour — and it is also what hid a nine-day outage behind HTTP 200.
5. **`cancel-in-progress: true` on deploys.** Four runs were cancelled mid-deploy; a
   cancellation between image push and rollout drops that commit entirely.
6. **Alerting worked and was not read.** Issues [#67](https://github.com/gggfox/Tavli/issues/67)
   (7 comments) and [#63](https://github.com/gggfox/Tavli/issues/63) were open the whole
   time. The detection gap from the previous postmortem is closed; the **triage** gap is not.

---

## Detection

Automated, by the post-deploy health gate — action item #5 of the
[2026-07-17 postmortem](./2026-07-17-staging-bad-gateway.md), shipped in `17e1957` five
days earlier. It failed correctly on every deploy from 2026-07-19 onward. This incident
is the gate working exactly as designed; the failure was in reading it.

---

## Resolution

**Manual, and required — the outage is not fixed until this is done:**

1. If you still have the current client secret saved (password manager, notes), skip to
   step 2 — no rotation needed. Otherwise: Infisical → Access Control → Identities →
   `github-dokploy-ci` → Universal Auth → create a new client secret with **TTL `0` and
   max uses `0`**. Creating one is non-destructive: existing client secrets on the
   identity keep working, so CI is unaffected and no coordinated cutover is required.
2. Set `INFISICAL_MACHINE_CLIENT_SECRET` on **both** Dokploy apps
   (`tavli-frontend-7bdzi6` staging, `tavli-frontend-0wcgnf` production) and Redeploy.
3. Leave the GitHub Actions secret alone — CI authenticates with its own client secret,
   which is still valid. Only touch it if you deliberately revoked that one.

Verify with `curl -s https://staging.tavliai.com/health` reporting the deployed commit.

**Pipeline guards (this PR)** — none of these fix the outage; they stop it recurring
silently:

1. **Boot-credential preflight** (`.github/scripts/dokploy-rollout.sh`). Before rolling
   out, CI reads the target app's stored machine-identity credentials and performs the
   same `infisical login` the container will. If it 401s the deploy fails **in seconds**,
   naming the cause and the fix, instead of shipping an image that cannot start.
2. **The entrypoint names its own death** (`docker-entrypoint.sh`). Login failure is
   handled explicitly instead of dying under `set -e`, printing a `FATAL` line plus the
   remediation.
3. **Immutable image rollout.** The deploy pins `ghcr.io/gggfox/tavli:<sha>` via
   `application.saveDockerProvider` rather than firing a webhook at a mutable tag. This
   did not fix the outage, but it is what made the dead container attributable to a
   specific commit.
4. **Classified health-gate failures** (`.github/scripts/health-gate.sh`) — stale build /
   route missing / unreachable / HTTP error / malformed, each with its own remediation.
5. **`cancel-in-progress: false`** so a deploy is never aborted mid-rollout.
6. **Alerts carry the diagnosis** — the `deploy-failure` issue now reports what the
   environment is actually serving.

---

## Lessons learned

- **A secret copied into two systems will drift, and the drift is invisible until
  something boots.** Anything holding a second copy of a credential needs a check that
  the copy still works — the rotation runbook cannot be the only guard.
- **"The deploy tool accepted my request" is not a deploy.** A step that cannot observe
  the outcome it claims should not be the step that decides the job is green.
- **A pipeline that cannot see its own container cannot diagnose itself.** Two plausible,
  self-consistent theories survived days because every signal CI had was equally
  compatible with them. The first real progress came from querying the orchestrator for
  container state and exit codes.
- **Graceful degradation hides outages.** Keeping the last healthy task is right; doing it
  without ever surfacing that the new one died is how a week disappears.
- **Detection without triage is not coverage.** The alerts fired for seven days.

---

## Action items

| #   | Action                                                                           | Rationale                                                                                                        | Owner | Status                |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- | --------------------- |
| 1   | Rotate the `github-dokploy-ci` client secret and set it on **both** Dokploy apps | The outage itself                                                                                                | —     | ☐ **Todo (blocking)** |
| 2   | Preflight the container's Infisical credentials before rolling out               | Turns a 5-min silent timeout into a named error                                                                  | —     | ✅ Done (#77)         |
| 3   | Entrypoint prints a FATAL line + remediation on login failure                    | The cause existed only in `docker logs`                                                                          | —     | ✅ Done (#77)         |
| 4   | Roll out the immutable `:<sha>` image via the Dokploy API                        | Makes a failed container attributable                                                                            | —     | ✅ Done (#77)         |
| 5   | Classify health-gate failures; alert with what is actually serving               | 8 red runs read as one vague failure                                                                             | —     | ✅ Done (#77)         |
| 6   | `cancel-in-progress: false` on deploys                                           | A cancelled deploy drops a rollout                                                                               | —     | ✅ Done (#77)         |
| 7   | Route `deploy-failure` issues somewhere they get triaged                         | Alerts fired for 7 days unread                                                                                   | —     | ☐ Todo                |
| 8   | Pin the Infisical CLI version in the `Dockerfile`                                | Unpinned; drifted 0.43.110→0.43.114 unnoticed. Not this cause, but the same class as the `.dockerignore` footgun | —     | ☐ Todo                |
| 9   | Surface container stderr somewhere without SSH                                   | Dokploy's UI showed "No logs found" throughout                                                                   | —     | ☐ Todo                |

---

## Timeline (UTC)

| Time              | Event                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| 2026-07-17 17:00  | Last successful production deploy (`a014b19`). Production serves this build for the next 9 days.     |
| 2026-07-19 ~14:00 | `17e1957` adds `/health` + the post-deploy health gate.                                              |
| 2026-07-19 15:00  | Last successful staging deploy (`79925f5`). Staging serves this build for the next 7 days.           |
| 2026-07-19 ~15–16 | The `github-dokploy-ci` Universal Auth client secret is rotated; Dokploy's copies are not updated.   |
| 2026-07-19 16:19  | First failing staging deploy (`aa404d8`). Every container from here on exits(1) at boot.             |
| 2026-07-19 → 26   | 8 failed + 4 cancelled staging deploys; issues #67/#63 accumulate. Both sites keep returning 200.    |
| 2026-07-26 02:00  | Promote to Production → Deploy Production fails the gate.                                            |
| 2026-07-26 21:02  | First deploy on the immutable-tag path; still fails. Container `tysnl170…` exits(1) after 421ms.     |
| 2026-07-26 ~21:30 | Dokploy API reveals the crashed containers; replaying the entrypoint's login returns 401. Confirmed. |
