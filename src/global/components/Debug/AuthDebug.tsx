import { useState } from "react"
import { useConvexAuth } from "convex/react"
import { useAuth, useAccessToken } from "@workos/authkit-tanstack-react-start/client"

/**
 * Decode JWT payload (without verification) to inspect claims
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Safely stringify a JWT claim value
 */
function stringifyClaim(value: unknown): string {
  if (value === undefined || value === null) return "MISSING!";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

/**
 * Debug component to visualize auth state - remove after debugging
 */
export function AuthDebug() {
  // Convex auth state
  const { isLoading: convexLoading, isAuthenticated: convexAuthenticated } = useConvexAuth()
  
  // WorkOS auth state (from TanStack Start SDK)
  const { user, loading: workosLoading, sessionId } = useAuth()
  const { accessToken, loading: tokenLoading, error: tokenError, getAccessToken } = useAccessToken()
  
  // Decode JWT to inspect claims
  const jwtPayload = accessToken ? decodeJwtPayload(accessToken) : null;
  
  // Test token fetch
  const [testResult, setTestResult] = useState<string | null>(null)
  const testGetToken = async () => {
    try {
      const token = await getAccessToken()
      if (token) {
        // Show first 20 chars of token
        setTestResult(`✓ ${token.substring(0, 20)}...`)
      } else {
        setTestResult("✗ null")
      }
    } catch (e) {
      setTestResult(`✗ ${e instanceof Error ? e.message : "error"}`)
    }
  }
  
  return (
    <div className="fixed bottom-4 right-4 bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs font-mono z-50 max-w-md overflow-auto max-h-[80vh]">
      {/* WorkOS TanStack Section */}
      <div className="text-cyan-400 font-bold mb-1">WorkOS TanStack:</div>
      <div className={workosLoading ? "text-yellow-400" : "text-gray-300"}>
        loading: {String(workosLoading)}
      </div>
      <div className={user ? "text-green-400" : "text-red-400"}>
        user: {user ? user.email : "null"}
      </div>
      <div className="text-gray-300">
        sessionId: {sessionId ? `${sessionId.substring(0, 12)}...` : "null"}
      </div>
      
      {/* Divider */}
      <div className="border-t border-slate-600 my-2" />
      
      {/* Access Token Section */}
      <div className="text-orange-400 font-bold mb-1">Access Token:</div>
      <div className={tokenLoading ? "text-yellow-400" : "text-gray-300"}>
        loading: {String(tokenLoading)}
      </div>
      <div className={accessToken ? "text-green-400" : "text-red-400"}>
        hasToken: {String(!!accessToken)}
      </div>
      {accessToken && (
        <div className="text-gray-400 truncate">
          token: {accessToken.substring(0, 20)}...
        </div>
      )}
      {tokenError && (
        <div className="text-red-400">
          error: {tokenError.message}
        </div>
      )}
      <button 
        onClick={testGetToken}
        className="mt-1 px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-gray-300"
      >
        Test getAccessToken()
      </button>
      {testResult && (
        <div className={testResult.startsWith("✓") ? "text-green-400" : "text-red-400"}>
          {testResult}
        </div>
      )}
      
      {/* Divider */}
      <div className="border-t border-slate-600 my-2" />
      
      {/* JWT Claims Section - CRITICAL for debugging */}
      <div className="text-yellow-400 font-bold mb-1">JWT Claims (key for Convex):</div>
      {jwtPayload ? (
        <div className="text-gray-300 space-y-0.5">
          <div className={jwtPayload.iss ? "text-green-400" : "text-red-400"}>
            iss: {stringifyClaim(jwtPayload.iss)}
          </div>
          <div className={jwtPayload.aud ? "text-green-400" : "text-red-400"}>
            aud: {stringifyClaim(jwtPayload.aud)}
          </div>
          <div className="text-gray-400">
            sub: {jwtPayload.sub ? stringifyClaim(jwtPayload.sub) : "none"}
          </div>
          <div className="text-gray-400">
            exp: {jwtPayload.exp ? new Date(Number(jwtPayload.exp) * 1000).toLocaleTimeString() : "none"}
          </div>
        </div>
      ) : (
        <div className="text-red-400">No token to decode</div>
      )}
      
      {/* Divider */}
      <div className="border-t border-slate-600 my-2" />
      
      {/* Convex Section */}
      <div className="text-purple-400 font-bold mb-1">Convex:</div>
      <div className={convexLoading ? "text-yellow-400" : "text-gray-300"}>
        isLoading: {String(convexLoading)}
      </div>
      <div className={convexAuthenticated ? "text-green-400" : "text-red-400"}>
        isAuthenticated: {String(convexAuthenticated)}
      </div>
    </div>
  )
}

