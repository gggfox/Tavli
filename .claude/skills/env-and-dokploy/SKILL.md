---
name: env-and-dokploy
description: Tavli's deployment, environment-variable, and secrets workflow across GitHub Actions, Infisical, Dokploy, Convex, and Hostinger DNS. Use when adding or rotating env vars/secrets, taking an integration live in staging/production (Clerk, Stripe, Resend, etc.), configuring a Dokploy app or Infisical environment, or debugging a broken deploy (502, 500, "Development mode" badge, jwk-kid mismatch, "starting without Infisical").
---

# Managing env vars & Dokploy deploys (Tavli)

Full model + rationale: **[deployment-and-secrets.md](../../../documentation/internal-guides/deployment-and-secrets.md)**. Read it before non-trivial changes. This skill is the operating procedure.

## First, know where a value belongs

| Value                                                                           | Goes in                               | Applied                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `VITE_*` (public)                                                               | Infisical, per-env                    | **build-time** (baked into the bundle) — rebuild to change |
| Frontend SSR secret (`CLERK_SECRET_KEY`)                                        | Infisical, per-env                    | **runtime** (entrypoint injects)                           |
| Convex-only vars (`CLERK_JWT_ISSUER_DOMAIN`, `STRIPE_*`, `RESEND_*`)            | Convex deployment env                 | read by Convex functions                                   |
| Infisical machine creds (`INFISICAL_ENV`, `INFISICAL_MACHINE_CLIENT_ID/SECRET`) | Dokploy app → Environment Settings    | runtime                                                    |
| DNS                                                                             | Hostinger hPanel (`tavliai.com` zone) | —                                                          |

Infisical env **slugs**: `dev` / `staging` / `prod` (NOT the "Production" display name).
Dokploy precedence: **Service > Environment > Project > System**. Keep the **Project (shared) env empty** and Build-time Args/Secrets empty (images are prebuilt & pulled, not built by Dokploy).

## Workflow: take an integration live (staging → prod)

1. **DNS** (if needed) → add CNAMEs in Hostinger → verify in the vendor dashboard → wait for SSL.
2. **Vendor** → create the production instance / live keys / OAuth app.
3. **Public keys** → set `VITE_*` in Infisical `prod`.
4. **Server secrets** → set in Infisical `prod` (SSR) and/or Convex `prod` deployment.
5. **Cross-service ids** → e.g. Convex `CLERK_JWT_ISSUER_DOMAIN`, webhook secrets.
6. **Deploy** → Promote to Production (`gh workflow run promote-production.yml -f source_branch=staging`).
7. **Verify** (below).

**Order:** never ship a live public key before its DNS/SSL is ready; flip cross-service ids (Convex issuer) **at cutover with the redeploy**, not before — either one early breaks the live site.

## Workflow: add / rotate a secret

- Runtime/SSR or `VITE_*` → Infisical (correct env). `VITE_*` needs a **rebuild** to take effect; SSR secrets take effect on the next container **redeploy**.
- Convex-side → `npx convex env set NAME value --prod` (or Convex dashboard).
- **Never** paste secrets into the Dokploy app env, the public image, or chat/logs. Machine-identity client secrets are one-time-view — regenerate under the identity's Universal Auth.

## Workflow: apply a Dokploy env change

Editing + **Save does NOT restart the container**. You must **Redeploy** (or Reload) the app. Confirm via the container's uptime (`Up 2 minutes`, not `Up 26 hours`).

## Verify a deploy

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://<host>/       # 200
curl -s https://<host>/ | grep -o 'pk_live[a-z0-9_]*'          # prod: pk_live (not pk_test)
```

Dokploy → app → **Logs** → select the running container: expect `Injecting N Infisical secrets` + `Listening on http://[::]:3000`, and **no** `jwk-kid` / `no secret key` / `without Infisical` lines. For a login-gated app, do a real sign-in and confirm it sticks.

## Diagnose a broken deploy

| Symptom                            | Likely cause → fix                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 502 Bad Gateway                    | No container → CI build failed (check Actions) or container crashed on boot                              |
| 500 `{"unhandled":true}`           | SSR error → read container logs for the missing/mismatched secret                                        |
| `…starting without Infisical.`     | `INFISICAL_MACHINE_CLIENT_ID/SECRET` missing in Dokploy → set + redeploy                                 |
| "Development mode" badge on prod   | Bundle built with `pk_test` → set `pk_live` in Infisical `prod` and **rebuild**                          |
| `jwk-kid mismatch` / redirect loop | Frontend/backend keys from different Clerk instances → make `CLERK_SECRET_KEY` match the `pk_*` instance |
| Convex 401 for signed-in users     | `CLERK_JWT_ISSUER_DOMAIN` wrong on the Convex deployment                                                 |

## Golden rules

- The Docker image is **public** → no secrets baked in; only the Infisical CLI is.
- `.dockerignore` is a **whitelist** — a new `COPY <file>` needs a matching `!<file>` line.
- `infisical run` doesn't override existing env vars → keep the container's base env clean so Infisical wins.
