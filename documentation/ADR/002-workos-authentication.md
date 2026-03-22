# ADR-002: WorkOS as Authentication Provider

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2025-12-21 |
| **Author(s)** | Gerardo Galan |
| **Supersedes** | N/A |
| **Superseded by** | N/A |

## Context

Fierro Viejo is a B2B SaaS auction marketplace that requires a robust authentication solution. As a business-to-business product, we need an auth provider that:

1. Is battle-tested and production-ready
2. Aligns with B2B SaaS requirements
3. Offers flexibility for future enterprise features (SSO, Directory Sync)
4. Has good integration support with our stack (TanStack Start + Convex)
5. Provides a reasonable free tier for early-stage development

## Decision

We will use **WorkOS** as our authentication provider.

WorkOS is purpose-built for B2B SaaS applications, which aligns directly with our target market. It provides enterprise-ready features out of the box while allowing us to start simple and scale into more complex authentication scenarios as customer requirements evolve.

Key factors in this decision:

- **Battle-tested**: WorkOS is used in production by established companies, providing confidence in its reliability and security
- **B2B Focus**: Unlike general-purpose auth providers, WorkOS specifically targets B2B SaaS—our exact use case
- **Future Flexibility**: While our auction marketplace is currently single-tenant, WorkOS gives us the option to add Enterprise SSO (SAML/OIDC), Directory Sync (SCIM), and Admin Portal features if customers require them
- **Integration Support**: Both Convex and TanStack Start have documentation for WorkOS integration, reducing implementation risk

## Consequences

### Positive

- Enterprise-grade authentication from day one
- Clear upgrade path if customers require SSO or directory sync
- Admin Portal feature available for customer IT management
- Strong documentation and integration guides for our stack
- Attractive free tier for early development

### Negative

- Pricing at scale is not fully understood; may need to revisit if costs become prohibitive
- Smaller community compared to Auth0 or Clerk
- May be over-engineered if we never need enterprise features

### Neutral

- Single-tenant architecture means some B2B features (multi-org, directory sync) may go unused initially
- Vendor lock-in is comparable to other hosted auth solutions

## Alternatives Considered

### Option 1: Clerk

Modern, developer-friendly authentication with excellent DX and pre-built UI components.

**Pros:**

- Excellent developer experience
- Beautiful pre-built components
- Strong React/Next.js ecosystem support

**Cons:**

- More consumer/B2C focused
- Enterprise features feel bolted-on rather than core

**Why not chosen:** Less aligned with B2B SaaS requirements; WorkOS is more purpose-built for our market.

### Option 2: Auth0

Industry veteran with comprehensive feature set and wide adoption.

**Pros:**

- Mature, widely adopted
- Extensive documentation
- Broad feature set

**Cons:**

- Complex pricing model
- Can be over-complicated for straightforward use cases
- Recent Okta acquisition has caused some community concern

**Why not chosen:** Complexity and pricing concerns; WorkOS offers a more focused B2B solution.

### Option 3: Better Auth

Open-source authentication library with full control over the implementation.

**Pros:**

- Open source, no vendor lock-in
- Full control over auth logic
- No per-user pricing

**Cons:**

- More implementation effort required
- Security responsibility falls on us
- Enterprise features would need custom development

**Why not chosen:** This was our second choice. While attractive for control and cost, the additional implementation burden and security responsibility tipped the scales toward WorkOS's managed solution.

### Option 4: Custom Implementation

Build authentication from scratch using JWT, sessions, and standard libraries.

**Pros:**

- Complete control
- No external dependencies
- No per-user costs

**Cons:**

- Significant development time
- Security vulnerabilities risk
- No enterprise features without substantial effort
- Ongoing maintenance burden

**Why not chosen:** Authentication is a solved problem; building custom auth introduces unnecessary risk and delays time-to-market.

## Implementation

WorkOS will be integrated following their official documentation alongside Convex and TanStack Start integration guides.

Key integration points:

- TanStack Start routes for auth callbacks (`/api/auth/*`)
- Convex backend authentication verification
- WorkOS SDK for session management

See also: [TDR-0001: Missing Backend Authentication](../tech-debt/0001-missing-backend-authentication.md) for current auth implementation status.

## References

- [WorkOS Documentation](https://workos.com/docs)
- [WorkOS + Convex Integration](https://docs.convex.dev/auth/workos)
- [ADR-001: Effect.ts Integration](./001-effect-ts-integration.md)

---

## Change Log

| Date | Author | Description |
|------|--------|-------------|
| 2025-12-21 | Gerardo Galan | Initial version |

