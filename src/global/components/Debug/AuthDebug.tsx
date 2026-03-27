import { useAuth } from "@clerk/tanstack-react-start";
import { useConvexAuth } from "convex/react";
import { useState } from "react";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1];
		const decoded = atob(payload.replaceAll("-", "+").replaceAll("_", "/"));
		return JSON.parse(decoded);
	} catch {
		return null;
	}
}

function stringifyClaim(value: unknown): string {
	if (value === undefined || value === null) return "MISSING!";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.join(", ");
	return JSON.stringify(value);
}

function ClerkDebugSection({
	isLoaded,
	isSignedIn,
	userId,
}: Readonly<{ isLoaded: boolean; isSignedIn: boolean; userId: string | null | undefined }>) {
	return (
		<>
			<div className="text-cyan-400 font-bold mb-1">Clerk Auth:</div>
			<div className={isLoaded ? "text-gray-300" : "text-yellow-400"}>
				loaded: {String(isLoaded)}
			</div>
			<div className={isSignedIn ? "text-green-400" : "text-red-400"}>
				signedIn: {String(isSignedIn)}
			</div>
			<div className="text-gray-300">
				userId: {userId ? `${userId.substring(0, 12)}...` : "null"}
			</div>
		</>
	);
}

function JwtDebugSection({ jwtPayload }: Readonly<{ jwtPayload: Record<string, unknown> | null }>) {
	if (!jwtPayload) {
		return (
			<>
				<div className="text-yellow-400 font-bold mb-1">JWT Claims:</div>
				<div className="text-red-400">No token to decode</div>
			</>
		);
	}

	return (
		<>
			<div className="text-yellow-400 font-bold mb-1">JWT Claims:</div>
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
					exp:{" "}
					{jwtPayload.exp ? new Date(Number(jwtPayload.exp) * 1000).toLocaleTimeString() : "none"}
				</div>
			</div>
		</>
	);
}

/**
 * Compact debug component to visualize auth state across Clerk and Convex.
 */
export function AuthDebug() {
	const { isLoading: convexLoading, isAuthenticated: convexAuthenticated } = useConvexAuth();
	const { isLoaded, isSignedIn, userId, getToken } = useAuth();

	const [accessToken, setAccessToken] = useState<string | null>(null);
	const [testResult, setTestResult] = useState<string | null>(null);

	const jwtPayload = accessToken ? decodeJwtPayload(accessToken) : null;

	const testGetToken = async () => {
		try {
			const token = await getToken({ template: "convex" });
			if (token) {
				setAccessToken(token);
				setTestResult(`✓ ${token.substring(0, 20)}...`);
			} else {
				setTestResult("✗ null");
			}
		} catch (e) {
			setTestResult(`✗ ${e instanceof Error ? e.message : "error"}`);
		}
	};

	return (
		<div className="fixed bottom-4 right-4 bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs font-mono z-50 max-w-md overflow-auto max-h-[80vh]">
			<ClerkDebugSection isLoaded={isLoaded} isSignedIn={isSignedIn ?? false} userId={userId} />

			<div className="border-t border-slate-600 my-2" />

			<div className="text-orange-400 font-bold mb-1">Convex Token:</div>
			<div className={accessToken ? "text-green-400" : "text-red-400"}>
				hasToken: {String(!!accessToken)}
			</div>
			{accessToken && (
				<div className="text-gray-400 truncate">token: {accessToken.substring(0, 20)}...</div>
			)}
			<button
				onClick={testGetToken}
				className="mt-1 px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-gray-300"
			>
				Test getToken()
			</button>
			{testResult && (
				<div className={testResult.startsWith("✓") ? "text-green-400" : "text-red-400"}>
					{testResult}
				</div>
			)}

			<div className="border-t border-slate-600 my-2" />

			<JwtDebugSection jwtPayload={jwtPayload} />

			<div className="border-t border-slate-600 my-2" />

			<div className="text-purple-400 font-bold mb-1">Convex:</div>
			<div className={convexLoading ? "text-yellow-400" : "text-gray-300"}>
				isLoading: {String(convexLoading)}
			</div>
			<div className={convexAuthenticated ? "text-green-400" : "text-red-400"}>
				isAuthenticated: {String(convexAuthenticated)}
			</div>
		</div>
	);
}
