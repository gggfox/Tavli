---
name: threat-audit
description: Run an exhaustive adversarial security audit of the whole Tavli codebase + architecture — threat-models first, then audits frontend, backend, auth, database, infrastructure, and dependencies via a multi-agent workflow, confidence-labels each finding, and reports attack chains + secure-design fixes inline. Use when the user asks to threat-model, red-team, security-audit, pentest, or adversarially review the app/system (not just the current diff — for the pending branch diff use the built-in /security-review instead). Trigger on "/threat-audit", "audit the security", "find vulnerabilities", "attack this".
---

# threat-audit

A full-codebase **adversarial** security audit. Distinct from the built-in `/security-review`
(which only reviews the pending branch diff): this ignores git state and audits the entire repo
plus system design, like a motivated attacker in a hostile environment.

## How it works

It orchestrates a multi-agent **Workflow** (script at
[scripts/threat-audit-workflow.js](scripts/threat-audit-workflow.js)) in four phases:

1. **Threat model** — one agent defines attacker types, entry points, trust boundaries, and
   sensitive assets (secrets, tokens, data, permissions).
2. **Audit layers** — one agent per requested layer (`frontend`, `backend`, `auth`, `database`,
   `infra`, `dependencies`), each given the threat model, finding Critical→Low issues, logic flaws,
   and non-obvious risks.
3. **Verify** — every finding gets an adversarial reviewer that tries to refute it and assigns a
   confidence label (**Confirmed / Likely / Speculative**). **Findings are never dropped** — a
   refuted one is downgraded and flagged, honoring "if something looks risky but uncertain, flag it."
4. **Synthesize** — attack chains (smaller issues composed) + secure-design improvements.

Static analysis only: agents read code/config and may run read-only checks (`pnpm audit`, inspect
`pnpm-lock.yaml`, secret greps). No live exploitation, no network attacks, no file mutation.

## Running it

1. **Parse the argument** for layer scope (default = all six):
   - `/threat-audit` → all layers.
   - `/threat-audit auth` or `/threat-audit backend,database` → only those.
   - Valid layers: `frontend`, `backend`, `auth`, `database`, `infra`, `dependencies`.
2. **Confirm scope first** (cost gate — this launches ~10+ agents). Tell the user which layers will
   run and the rough agent count (1 threat-model + N layer audits + 1 verifier per finding + 1
   synthesis), and ask to proceed. Do not launch until they confirm.
3. **Launch the workflow.** The skill's instructions authorize the Workflow tool here — call it
   directly (no extra opt-in needed):
   ```
   Workflow({ scriptPath: ".claude/skills/threat-audit/scripts/threat-audit-workflow.js",
              args: { layers: ["auth", "backend"] } })   // omit/empty args.layers = all six
   ```
4. **Render the report inline** in chat from the workflow's return value (do not write a file). Use
   the exact format in [REFERENCE.md](REFERENCE.md) § Output format:
   1. Vulnerability summary by severity (table: count per Critical/High/Medium/Low).
   2. Detailed findings — title, severity, **confidence**, affected component, description,
      exploitation steps, impact, recommended fix. Group by severity, Critical first.
   3. Attack chains.
   4. Secure design improvements.
      Lead with the threat model summary, then the four sections. Flag every Speculative finding as such.

## Reference

[REFERENCE.md](REFERENCE.md) holds the Tavli asset inventory, per-layer checklists, and the output
spec. The workflow agents read it themselves — you should too before rendering, so the summary is
grounded in this repo's real trust boundaries.
