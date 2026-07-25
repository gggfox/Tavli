# Tech Debt Records (TDR)

This folder tracks **systemic tech debt only**—not every TODO or minor issue.

## When to Document

| Situation                                                         | Action                        |
| ----------------------------------------------------------------- | ----------------------------- |
| Affects **multiple modules** or requires a **migration decision** | Create a TDR                  |
| Localized, "fix when refactoring"                                 | Inline `// DEBT(...)` comment |
| Trivial or already tracked elsewhere                              | Skip                          |

**Do not over-document.** If it can be explained in a one-line comment, don't create a TDR.

## Inline Annotations

Use these prefixes in code comments:

```ts
// DEBT(TDR-0001): Session coupling issue. See docs/tech-debt/0001-auth-session-coupling.md
// TODO(tech-debt): Linear scan here, replace with indexed lookup when scaling
```

## TDR Template

```md
# TDR-XXXX: Title

## Context

1-2 sentences explaining why this debt exists.

## Impact

- Bullet points of consequences

## Options

1. Option A
2. Option B

## Owner

Team or person responsible

## Created

YYYY-MM-DD
```

## File Naming

`XXXX-short-slug.md`

Examples: `0001-auth-session-coupling.md`, `0002-sync-job-no-retries.md`

## Tech Debt Index

| ID       | Area            | Severity | Status   | Link                                                                               |
| -------- | --------------- | -------- | -------- | ---------------------------------------------------------------------------------- |
| TDR-0001 | Security/Auth   | High     | Archived | [0001-missing-backend-authentication.md](./0001-missing-backend-authentication.md) |
| TDR-0002 | Error Handling  | Medium   | Resolved | [0002-missing-error-handling.md](./0002-missing-error-handling.md)                 |
| TDR-0003 | Code Quality/DX | Low      | Resolved | [0003-styling-patterns-refactoring.md](./0003-styling-patterns-refactoring.md)     |
| TDR-0005 | Design Tokens   | Low      | Open     | [0005-remaining-var-tokens.md](./0005-remaining-var-tokens.md)                     |

**Severity:** High / Medium / Low  
**Status:** Open / In Progress / Resolved / Archived

`Archived` means the record describes a system that no longer exists. TDR-0004
was never written; the number is retired rather than reused.
