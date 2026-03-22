# ADR-004: WorkOS + Convex + TanStack Start Integration

## Metadata

| Field | Value |
| ------- | ------- |
| **Status** | Accepted |
| **Date** | 2025-12-23 |
| **Author(s)** | Development Team |
| **Supersedes** | N/A |
| **Superseded by** | N/A |

## Context

After selecting WorkOS for authentication (ADR-002) and Convex for the backend (ADR-003), we needed to integrate these three technologies:

1. **TanStack Start**: Our full-stack React framework handling SSR, routing, and server functions
2. **WorkOS AuthKit**: Authentication provider with session management and JWT tokens
3. **Convex**: Backend-as-a-service requiring JWT validation for protected queries/mutations

The challenge was that:

- WorkOS AuthKit for TanStack Start (`@workos/authkit-tanstack-react-start`) splits auth state across multiple hooks (`useAuth` for user info, `useAccessToken` for tokens)
- Convex's `ConvexProviderWithAuth` expects a single `useAuth` hook returning `{ isLoading, isAuthenticated, fetchAccessToken }`
- The official `@convex-dev/workos` library (`ConvexProviderWithAuthKit`) was designed for a different WorkOS SDK and didn't work with TanStack Start's SDK
- JWT claims from WorkOS needed specific configuration to be validated by Convex

## Decision

We implemented a **custom authentication bridge** that connects WorkOS TanStack Start SDK with Convex's auth provider pattern.

Key implementation decisions:

1. **Custom `useAuthForConvex` hook**: Bridges the gap between WorkOS's split hooks and Convex's unified auth interface
2. **Dual JWT issuer configuration**: Convex auth config accepts tokens from both WorkOS SSO and User Management issuers
3. **WORKOS_CLIENT_ID in Convex**: Required environment variable for JWT validation on the backend
4. **WorkOS JWT template configuration**: Ensure the `aud` (audience) claim matches what Convex expects

## Consequences

### Positive

- Full authentication flow from WorkOS → TanStack Start → Convex
- Type-safe integration across all three systems
- Real-time auth state synchronization
- Debug tooling integrated into TanStack Devtools for visibility

### Negative

- Custom hook adds maintenance burden (not using official libraries directly)
- Two JWT issuer configurations to maintain in Convex
- Debugging auth issues requires understanding all three systems

### Neutral

- Console logging in `useAuthForConvex` aids debugging but should be removed in production
- Auth debug panel in devtools provides visibility into the flow

## Implementation

### Architecture Overview

```md
┌─────────────────────────────────────────────────────────────────────────┐
│                           Browser (Client)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────┐     ┌───────────────────────────────────────┐ │
│  │   AuthKitProvider    │────▶│        useAuth() / useAccessToken()   │ │
│  │  (WorkOS TanStack)   │     │          (WorkOS SDK Hooks)           │ │
│  └──────────────────────┘     └───────────────┬───────────────────────┘ │
│                                               │                          │
│                                               ▼                          │
│                               ┌───────────────────────────────────────┐ │
│                               │        useAuthForConvex()             │ │
│                               │      (Custom Bridge Hook)             │ │
│                               │                                       │ │
│                               │  • Combines useAuth + useAccessToken  │ │
│                               │  • Returns Convex-compatible interface│ │
│                               │  • Stable token ref for consistency   │ │
│                               └───────────────┬───────────────────────┘ │
│                                               │                          │
│                                               ▼                          │
│                               ┌───────────────────────────────────────┐ │
│                               │     ConvexProviderWithAuth            │ │
│                               │                                       │ │
│                               │  • Receives fetchAccessToken          │ │
│                               │  • Passes JWT to Convex client        │ │
│                               └───────────────┬───────────────────────┘ │
│                                               │                          │
└───────────────────────────────────────────────┼──────────────────────────┘
                                                │
                                                │ JWT Token
                                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Convex Backend                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      auth.config.ts                               │   │
│  │                                                                   │   │
│  │  • Validates JWT signature via JWKS endpoint                      │   │
│  │  • Checks issuer matches WorkOS                                   │   │
│  │  • Verifies audience claim (WORKOS_CLIENT_ID)                     │   │
│  │  • Supports both SSO and User Management issuers                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                               │                          │
│                                               ▼                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              ctx.auth.getUserIdentity()                           │   │
│  │                                                                   │   │
│  │  • Returns authenticated user identity                            │   │
│  │  • Available in queries/mutations                                 │   │
│  │  • subject = user ID for data scoping                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1. Custom Auth Bridge Hook

```typescript
// src/hooks/useAuthForConvex.ts
import { useCallback, useRef } from "react";
import {
  useAuth,
  useAccessToken,
} from "@workos/authkit-tanstack-react-start/client";

/**
 * Custom hook that bridges WorkOS TanStack Start auth with Convex's expected auth interface.
 *
 * @workos/authkit-tanstack-react-start splits auth state (useAuth) and token fetching (useAccessToken)
 * into separate hooks, but Convex expects them combined in a single useAuth hook.
 */
export function useAuthForConvex() {
  const { user, loading: authLoading } = useAuth();
  const {
    accessToken,
    loading: tokenLoading,
    error: tokenError,
  } = useAccessToken();

  // Store token in ref for stability across renders
  const stableAccessToken = useRef<string | null>(null);
  if (accessToken && !tokenError) {
    stableAccessToken.current = accessToken;
  }

  const isLoading = (authLoading ?? false) || (tokenLoading ?? false);
  // Important: isAuthenticated requires BOTH user AND accessToken
  const isAuthenticated = !!user && !!accessToken && !isLoading;

  const fetchAccessToken = useCallback(async () => {
    const token = stableAccessToken.current;
    if (token && !tokenError) {
      return token;
    }
    return null;
  }, [tokenError]);

  return {
    isLoading,
    isAuthenticated,
    fetchAccessToken,
  };
}
```

### 2. Provider Setup in Router

```tsx
// src/router.tsx
import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react";
import { AuthKitProvider } from "@workos/authkit-tanstack-react-start/client";
import { useAuthForConvex } from "./hooks/useAuthForConvex";

/**
 * Inner component that uses the auth hooks.
 * Must be rendered inside AuthKitProvider.
 */
function ConvexAuthBridge({ children, convexClient }) {
  return (
    <ConvexProviderWithAuth client={convexClient} useAuth={useAuthForConvex}>
      {children}
    </ConvexProviderWithAuth>
  );
}

function AuthWrapper({ children, convexClient }) {
  return (
    <AuthKitProvider
      onSessionExpired={() => {
        globalThis.location.href = '/api/auth/signin';
      }}>
      <ConvexAuthBridge convexClient={convexClient}>
        {children}
      </ConvexAuthBridge>
    </AuthKitProvider>
  );
}
```

### 3. Convex Auth Configuration

```typescript
// convex/auth.config.ts
const clientId = process.env.WORKOS_CLIENT_ID;

export default {
  providers: [
    // WorkOS SSO issuer
    {
      type: "customJwt",
      issuer: `https://api.workos.com/`,
      algorithm: "RS256",
      applicationID: clientId,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
    // WorkOS User Management issuer (different format)
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256",
      applicationID: clientId,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
  ],
};
```

### 4. Environment Variables

**Convex Dashboard or CLI:**

```bash
# Set WORKOS_CLIENT_ID in Convex environment
npx convex env set WORKOS_CLIENT_ID client_01XXXXXXXXX
```

**Local `.env.local` (for TanStack Start):**

```env
WORKOS_CLIENT_ID=client_01XXXXXXXXX
WORKOS_API_KEY=sk_test_XXXXXXXXX
WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback
```

### 5. WorkOS JWT Template Configuration

In the WorkOS Dashboard, configure the JWT template:

1. Navigate to **Authentication** → **JWT Templates**
2. Ensure the access token includes:
   - `iss`: Issuer (auto-set by WorkOS)
   - `sub`: Subject (user ID)
   - `aud`: Audience (must match your client ID for Convex validation)
   - `exp`: Expiration

The `aud` claim is critical—Convex uses this to verify the token was intended for your application.

## Debugging

An Auth Debug Panel is integrated into TanStack Devtools to visualize:

1. **WorkOS TanStack State**: User object, session ID, loading states
2. **Access Token**: Token presence, fetch testing, errors
3. **JWT Claims**: Decoded issuer, audience, subject, expiration
4. **Convex Auth State**: `isLoading`, `isAuthenticated` from `useConvexAuth`

Access via the TanStack Devtools panel (bottom-right corner) → "Auth" tab.

### Common Issues

| Symptom | Cause | Solution |
| --------- | ------- | ---------- |
| WorkOS authenticated but Convex shows unauthenticated | JWT claims mismatch | Check `iss` and `aud` in JWT match `auth.config.ts` |
| Token missing | `useAccessToken` not returning token | Verify WorkOS session is active, check for errors |
| "Invalid audience" error | `aud` claim doesn't match | Configure WorkOS JWT template with correct audience |
| Convex stuck in loading | Token not being passed | Check `useAuthForConvex` is returning correct interface |

## Alternatives Considered

### Option 1: Use `@convex-dev/workos` Directly

**Why not chosen:** This library was built for a different WorkOS SDK (`@workos/authkit-nextjs` pattern) and doesn't export the correct hooks for TanStack Start. The `ConvexProviderWithAuthKit` expects a `useAuth` that returns both user and token, which doesn't match the split-hook pattern in `@workos/authkit-tanstack-react-start`.

### Option 2: Fork `@convex-dev/workos`

**Why not chosen:** Added maintenance burden for a relatively simple bridge hook. Our custom hook is ~30 lines and easier to maintain than a fork.

### Option 3: Use Convex's Built-in Auth

**Why not chosen:** We specifically chose WorkOS for B2B features (SSO, directory sync). Convex's built-in auth is more consumer-focused.

## References

- [Convex Custom Auth Documentation](https://docs.convex.dev/auth/custom-auth)
- [WorkOS AuthKit TanStack Start](https://workos.com/docs/user-management/authkit/tanstack-start)
- [WorkOS JWT Configuration](https://workos.com/docs/user-management/jwt-templates)
- [ADR-002: WorkOS Authentication](./002-workos-authentication.md)
- [ADR-003: Convex Backend](./003-convex-backend.md)
- [TDR-0001: Missing Backend Authentication](../tech-debt/0001-missing-backend-authentication.md)

---

## Change Log

| Date       | Author           | Description     |
|------------|------------------|-----------------|
| 2025-12-23 | Development Team | Initial version |
