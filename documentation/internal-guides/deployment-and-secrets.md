# Deployment, environment variables & secrets

How Tavli's config, secrets, and deploys actually fit together. Every per-integration
runbook (`clerk-go-live.md`, `stripe-go-live.md`, `email-deliverability.md`) sits on top
of this model — read this first. If you're taking an integration live or debugging a bad
deploy, also see the **[env-and-dokploy skill](../../.claude/skills/env-and-dokploy/SKILL.md)**.

## TL;DR mental model

- The frontend runs as a **prebuilt, public** Docker image (`ghcr.io/gggfox/tavli:<staging|production>`) that **Dokploy pulls** — Dokploy does **not** build it.
- **GitHub Actions builds** the image (`deploy.yml`), baking **public** `VITE_*` values in at build time (from Infisical, per-env).
- The container **fetches server-side secrets at runtime** from Infisical via `docker-entrypoint.sh` (Infisical CLI is baked into the image; the secrets are not).
- **Dokploy holds almost nothing** — just the Infisical machine-identity creds. Infisical is the source of truth for secrets, per environment.
- **Convex-only vars** (e.g. `CLERK_JWT_ISSUER_DOMAIN`) live in the **Convex deployment**, not Dokploy or the image.

## Where every value lives

| Value kind                         | Example                                                                                                 | Stored in                                 | Applied                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Public client keys                 | `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CONVEX_URL`, `VITE_STRIPE_PUBLISHABLE_KEY`                          | **Infisical** (per-env)                   | **Baked at build** by `deploy.yml` (`infisical run --env=<slug> pnpm build`) → inlined into the JS bundle |
| Server-side secrets (frontend SSR) | `CLERK_SECRET_KEY`                                                                                      | **Infisical** (per-env)                   | **Injected at runtime** by `docker-entrypoint.sh`                                                         |
| Convex-only server vars            | `CLERK_JWT_ISSUER_DOMAIN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `CONVEX_ENV` | **Convex deployment** env                 | Read by Convex functions / `convex/auth.config.ts`                                                        |
| Infisical machine identity         | `INFISICAL_MACHINE_CLIENT_ID/SECRET`, `INFISICAL_ENV`                                                   | **Dokploy** app → Environment Settings    | Read by the entrypoint to log into Infisical                                                              |
| DNS records                        | `clerk.tavliai.com` CNAME, etc.                                                                         | **Hostinger** hPanel (`tavliai.com` zone) | —                                                                                                         |

## The pipeline (staging & production)

`.github/workflows/deploy.yml` (reusable), called by `deploy-staging.yml` (push to
`staging`, `infisical_env: staging`, `image_tag: staging`) and `deploy-production.yml`
(push to `production`, `infisical_env: prod`, `image_tag: production`):

1. `pnpm install` → **build app** wrapped in `infisical run --env=<slug>` (bakes `VITE_*`)
2. `npx convex deploy` (deploys Convex functions for that env)
3. Build & push `ghcr.io/gggfox/tavli:<image_tag>` (+ `:<sha>`)
4. Curl the Dokploy webhook (`$DOKPLOY_WEBHOOK_URL` from Infisical) → Dokploy pulls the
   new image and redeploys.

Deploys are branch-driven: merge to `main` → CI fast-forwards `staging` → **Deploy
Staging**. Production is a manual **Promote to Production** (`workflow_dispatch`, fast-forwards
`production` from `staging`) → **Deploy Production**.

## Runtime: the Infisical entrypoint

`docker-entrypoint.sh`:

```sh
if [ -n "$INFISICAL_MACHINE_CLIENT_ID" ] && [ -n "$INFISICAL_MACHINE_CLIENT_SECRET" ]; then
  infisical login --method=universal-auth ...            # authenticate
  exec infisical run --env="${INFISICAL_ENV:-prod}" -- "$@"  # inject secrets, run the server
fi
echo "…starting without Infisical." >&2                  # fallback: run with whatever env is present
exec "$@"
```

- Healthy boot logs: `Injecting N Infisical secrets into your application process` + `Listening on http://[::]:3000`.
- Fallback boot log: `docker-entrypoint: INFISICAL_MACHINE_CLIENT_ID/SECRET not set — starting without Infisical.`
- The machine identity is **`github-dokploy-ci`** (Infisical → Access Control → Identities), Client ID `9e521c33-bba4-464c-99fd-8d054de12f15`, **Viewer** on the Tavli project (reads all envs). Client secret is one-time-view; create a fresh one under its Universal Auth.

## Infisical

- Project `da9416bf-...`, self-hosted at `https://infisical.gggfox.com`.
- **Environment slugs differ from display names**: Development=`dev`, Staging=`staging`, **Production=`prod`**. `--env=` / `INFISICAL_ENV` use the **slug**.
- Secrets are per-environment. Staging holds test/dev-instance keys; production holds live keys.

## Dokploy env layers & precedence

A Dokploy app has multiple env surfaces. Precedence: **Service > Environment > Project > System defaults**. Shared/project vars are also referencable via `${{project.VAR}}` / `${{environment.VAR}}`.

| Surface                                      | Used when?                              | Put here                                                                 |
| -------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| App → **Environment Settings**               | **Runtime** (always)                    | `INFISICAL_ENV`, `INFISICAL_MACHINE_CLIENT_ID/SECRET` — and nothing else |
| App → **Build-time Arguments / Secrets**     | Only if **Dokploy builds** the image    | **Nothing** — our images are prebuilt & pulled, so these are inert       |
| **Project Environment** (shared across envs) | Inherited by services unless overridden | **Keep empty** — legacy dev/test values here are a landmine              |

The current clean state: each frontend app's Environment Settings has just
`INFISICAL_ENV=<slug>` + the two machine-cred lines. `NODE_ENV` and `PORT` are omitted
(the image sets `ENV NODE_ENV=production`; Nitro defaults to `3000`).

## Convex environments

Dev `blessed-weasel-428` · Staging `aromatic-dog-762` · Prod `polite-antelope-545`.
Convex env vars are set **on the deployment** (`npx convex env set NAME value --prod`, or
the Convex dashboard), independent of Dokploy/Infisical. Notably `convex/auth.config.ts`
reads `CLERK_JWT_ISSUER_DOMAIN` — it must match the Clerk instance that issues the
frontend's session tokens (e.g. `https://clerk.tavliai.com` for prod).

## First-admin bootstrap

**Symptom:** a fresh production database has no privileged user, so
`/admin/restaurants` (and every other admin surface) shows **"Access Denied"**
for _everyone_ — including you. Every privileged mutation requires an
already-privileged caller, no Clerk webhook seeds roles, and `devSetOwnRoles`
is correctly blocked outside development. There is exactly one supported way to
mint the very first owner/admin: the guarded `admin.bootstrapFirstAdmin`
`internalMutation` (ticket TAVLI-51).

Because it is an **`internalMutation`** it is unreachable from the browser — the
only surfaces are `npx convex run` and the Convex dashboard, i.e. an operator
who already holds deployment access. It fails closed on three guards:

1. `ALLOW_ADMIN_BOOTSTRAP` must be truthy on the Convex deployment (inert by
   default in every environment).
2. It refuses if **any** `userRoles` row already has `owner` or `admin` —
   strictly the _first_ admin.
3. It refuses if the target user does not already exist; it never creates
   users. The person must have **signed in via Clerk at least once** (or been
   invited) so their `userRoles` row exists. Pass **exactly one** of `email` or
   `clerkSubject`.

### Procedure (production)

```sh
# 1. Confirm the target has signed in (their row must already exist):
npx convex run --prod admin:getCurrentUserRoles   # or inspect the userRoles table in the dashboard

# 2. Arm the bootstrap (opt-in flag; inert until set):
npx convex env set ALLOW_ADMIN_BOOTSTRAP true --prod

# 3. Promote the first admin — pick ONE selector:
npx convex run --prod admin:bootstrapFirstAdmin '{"email":"founder@tavliai.com"}'
#   or by Clerk subject:
# npx convex run --prod admin:bootstrapFirstAdmin '{"clerkSubject":"user_abc123"}'
# → { ok: true, userRoleId: "...", roles: ["...","owner","admin"] }

# 4. DISARM immediately — leave no standing escalation path:
npx convex env remove ALLOW_ADMIN_BOOTSTRAP --prod
```

### Verify

Sign in as that user and load **`/admin/restaurants`** — it should render the
admin dashboard instead of "Access Denied". A `userRoles.bootstrap_first_admin`
row is written to `allEvents` for the audit trail. Re-running the mutation now
refuses with `ERROR_ADMIN_BOOTSTRAP_ALREADY_INITIALIZED`; every further role
change goes through the normal admin UI. If step 3 returns
`ERROR_ADMIN_BOOTSTRAP_DISABLED` the flag isn't set (or the deployment wasn't
reloaded); `ERROR_ADMIN_BOOTSTRAP_USER_NOT_FOUND` means the person hasn't signed
in yet.

## Taking an integration live (staging → prod)

The repeatable shape (Clerk did all of these; Stripe/Resend will too):

1. **DNS** (if the vendor needs a domain) → Hostinger CNAMEs → verify with the vendor → wait for SSL.
2. **Provider dashboard** → create the production instance / live credentials / OAuth app.
3. **Public keys** → set `VITE_*` in Infisical **`prod`** (baked at next build).
4. **Server secrets** → set them in Infisical **`prod`** (frontend SSR) and/or the **Convex prod** deployment (Convex-side).
5. **Cross-service identifiers** → e.g. Convex `CLERK_JWT_ISSUER_DOMAIN`; webhook secrets.
6. **Deploy** → Promote to Production (rebuilds with the live `VITE_*`; runtime pulls the live secrets).
7. **Verify** → see the diagnostic tree below.

**Ordering matters:** don't ship a live public key before its domain/DNS is ready, and
flip cross-service identifiers (like the Convex issuer) at cutover, together with the
redeploy — doing either early breaks the currently-running site.

## Footgun catalog (all hit in the 2026-07 go-live)

1. **`.dockerignore` is a whitelist** (`*` + `!allowed`). A new `COPY <file>` in the Dockerfile needs a matching `!<file>` line or the build dies with `"/<file>": not found` → no image → 502.
2. **`INFISICAL_ENV` defaults to `prod`.** A staging box that omits it silently pulls **production** secrets. Always set it explicitly.
3. **Infisical slug ≠ display name.** "Production" tab → slug `prod`.
4. **`VITE_*` are baked at build.** Changing them at runtime does nothing; you must **rebuild** to change a public key. (This is why a prod box can show `pk_live` while a stale Dokploy build-arg still says `pk_test`.)
5. **The image is public** → never bake secrets into it; fetch at runtime.
6. **Project shared env is a landmine.** Legacy dev/test values there leak into a container the moment a per-app override is removed. Keep it empty.
7. **Saving env in Dokploy does not restart the container.** You must **Redeploy/Reload** for a new env to take effect (`Up 26 hours` = your edits aren't applied yet).
8. **`infisical run` does not override existing env vars.** If a secret is also present in the container's base env (e.g. inherited from the shared project env), that value can win over Infisical's. Keep the base env clean.
9. **Convex issuer is separate.** `CLERK_JWT_ISSUER_DOMAIN` lives in the Convex deployment; if it doesn't match the live Clerk instance, authenticated Convex calls 401.

## Diagnostic decision tree

| Symptom                                      | Cause                                                         | Fix                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **502 Bad Gateway**                          | No healthy container behind Traefik                           | Check the CI build (image may have failed to build/push); then check the container booted (`Up …`) |
| **500 / `{"unhandled":true}`**               | Container up, SSR throws                                      | Read container logs — usually a missing/mismatched runtime secret                                  |
| Logs: `Clerk: no secret key provided`        | No `CLERK_SECRET_KEY` at runtime                              | Ensure Infisical injects it (creds set) or it's present per-env                                    |
| Logs: `…starting without Infisical.`         | `INFISICAL_MACHINE_CLIENT_ID/SECRET` missing/wrong in Dokploy | Set them; Redeploy                                                                                 |
| **"Development mode" badge** on prod         | Bundle built with a `pk_test` key                             | Set `VITE_CLERK_PUBLISHABLE_KEY=pk_live` in Infisical `prod` and **rebuild**                       |
| `jwk-kid mismatch` / handshake redirect loop | Frontend & backend keys from **different Clerk instances**    | Make `CLERK_SECRET_KEY` match the frontend `pk_*`'s instance                                       |
| Convex calls 401 for signed-in users         | `CLERK_JWT_ISSUER_DOMAIN` wrong on the Convex deployment      | Set it to the live instance's issuer; it applies immediately                                       |

**Verification commands:**

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://tavliai.com/     # expect 200
curl -s https://tavliai.com/ | grep -o 'pk_live[a-z0-9_]*'        # expect pk_live, not pk_test
# Dokploy → app → Logs → select container: expect "Injecting N Infisical secrets" + "Listening"
```
