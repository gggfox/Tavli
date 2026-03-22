# Tech debt documentation patterns

Yes—there *are* established patterns for this, and you’re thinking in exactly the right direction. An **“ADR but for tech debt”** approach can work well **if you scope it correctly**. Most teams that succeed with this use a **hybrid system**, not a single mechanism.

Below is a practical breakdown, with pros/cons and a recommended setup that fits how engineers actually work.

---

## 1. Inline Annotations (lowest friction, highest signal)

### Common patterns

```ts
// TODO(tech-debt): Replace linear scan with indexed lookup
// FIXME(perf): O(n²) behavior on large datasets
// NOTE(arch): This violates layering but avoids circular deps
```

#### Enhancements that matter

* Use **structured prefixes**: `TODO(tech-debt)`, `DEBT(perf)`, `HACK(legacy)`
* Require a **why**, not just a what
* Optionally reference an ID or doc

#### Pros

* Right next to the code
* Zero process overhead
* IDEs + static analysis can surface them

#### Cons

* Easy to rot
* Hard to prioritize
* No ownership or history

**Best use**
➡️ *Local, tactical debt* (“this function sucks, here’s why”).

---

## 2. “Tech Debt Records” (ADR-style, but lighter)

This is the thing closest to what you’re proposing—and yes, it’s a valid pattern.

### Typical structure

```bash
docs/tech-debt/
├── 0001-auth-session-coupling.md
├── 0002-sync-job-no-retries.md
└── README.md
```

### Example template

```md
# TDR-0002: Background Job Has No Retries

## Context
This job was implemented quickly to unblock launch.
Failures currently require manual re-runs.

## Impact
- Lost events on transient failures
- On-call intervention required

## Why It Exists
- No job framework selected at the time
- Tight deadline

## Options
1. Add retry logic manually
2. Migrate to BullMQ
3. Use cloud-managed queues

## Recommendation
Option 2 when volume > X

## Owner
Team Platform

## Created
2024-11-12
```

Pros:

* Preserves *reasoning*
* Extremely helpful for future engineers
* Great companion to ADRs

Cons:

* Easy to over-document
* Needs discipline to stay useful

**Best use**
➡️ *Systemic, architectural, or cross-cutting debt*.

---

## 3. Debt Index (this is the missing piece most teams forget)

Instead of *just* documents, have a **single index**.

```md
# Tech Debt Index

| ID | Area | Severity | Type | Status | Link |
|----|------|----------|------|--------|------|
| TDR-0001 | Auth | High | Architecture | Open | ./0001-auth-session-coupling.md |
| TDR-0002 | Jobs | Medium | Reliability | Open | ./0002-sync-job-no-retries.md |
```

This turns “docs” into something **trackable**.

---

## 4. Code → Doc Linking (critical)

The real power move is **bidirectional linking**.

```ts
// DEBT(TDR-0002): Job has no retries. See docs/tech-debt/0002-sync-job-no-retries.md
```

Now:

* The code explains *why*
* The doc explains *context and options*

Future engineers will love you for this.

---

## 5. Why *not* just use Jira / GitHub Issues?

You *can*, but they fail at one key thing:

> **Issues lose architectural context once closed**

Docs inside the repo:

* Survive org changes
* Are versioned with the code
* Are visible during code review

The best teams treat:

* **Issue tracker** → *execution*
* **Repo docs** → *institutional memory*

---

## 6. A Pattern That Works Very Well (recommended)

If I were designing this today, I’d do:

### 🔹 Three-tier system

1. **Inline annotations** for local debt
2. **`docs/tech-debt/`** for systemic debt
3. **Index file** for visibility & prioritization

### 🔹 Clear rules

* If it affects **multiple modules** → write a TDR
* If it requires a **migration decision** → write a TDR
* If it’s “fix when refactoring” → inline comment only

---

## 7. Bonus: Make It Hard to Ignore

Some teams:

* Fail CI if `TODO(tech-debt)` count increases
* Require a TDR link for large hacks
* Review the Tech Debt Index quarterly

Not bureaucracy—*memory*.

---

### TL;DR

Yes, an “ADR for tech debt” is a **good idea**, but:

* Keep it **lighter than ADRs**
* Use it only for **meaningful debt**
* Link it **from the code**
* Maintain a **single index**

If you want, I can:

* Design a **TDR template**
* Help you decide **what qualifies** for a doc vs comment
* Show how big companies (Amazon / Stripe / Uber) do this in practice
