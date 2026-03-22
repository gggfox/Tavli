# Architecture Decision Records (ADR)

This directory contains Architecture Decision Records (ADRs) for the Fierro Viejo project.

## What is an ADR?

An Architecture Decision Record is a document that captures an important architectural decision made along with its context and consequences.

## ADR Status Lifecycle

```
Proposed → Accepted → [Deprecated | Superseded]
```

- **Proposed**: Under discussion, not yet accepted
- **Accepted**: Decision has been made and is in effect
- **Deprecated**: No longer relevant but kept for historical context
- **Superseded**: Replaced by a newer ADR

## How to Create a New ADR

1. Copy `template.md` to a new file named `{NUMBER}-{slug}.md`
   - Example: `002-authentication-strategy.md`
2. Fill in all sections of the template
3. Submit for review via pull request
4. Update this README with the new ADR entry

## ADR Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [001](./001-effect-ts-integration.md) | Effect.ts Integration Between TanStack Start and Convex | Deprecated | 2025-12-14 |
| [002](./002-workos-authentication.md) | WorkOS as Authentication Provider | Accepted | 2025-12-21 |
| [003](./003-convex-backend.md) | Convex as Backend-as-a-Service | Accepted | 2025-12-21 |

## Conventions

### Naming

- Use sequential numbers with leading zeros: `001`, `002`, etc.
- Use kebab-case for the slug: `effect-ts-integration`
- Full filename: `001-effect-ts-integration.md`

### Writing Style

- Use active voice
- Be specific and concrete
- Include code examples where helpful
- Link to relevant documentation and resources

### Review Process

1. Create ADR as "Proposed"
2. Share with team for feedback
3. Iterate based on feedback
4. Update status to "Accepted" when consensus is reached
5. Implement the decision

## References

- [Michael Nygard's ADR Blog Post](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [ADR GitHub Organization](https://adr.github.io/)
