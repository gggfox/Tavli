import { StatusBadge } from "@/global";
import { getDebugStatusConfig } from "@/global/components/StatusBadge/constants/debugStatusConfig";
import { useAccessToken, useAuth } from "@workos/authkit-tanstack-react-start/client";
import { useConvexAuth } from "convex/react";
import { useState } from "react";

/**
 * Decode JWT payload (without verification) to inspect claims
 */
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

/**
 * Format a claim value for display
 */
function formatClaim(value: unknown): string {
	if (value === undefined || value === null) return "MISSING!";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.join(", ");
	return JSON.stringify(value);
}

/**
 * Section header component
 */
function SectionHeader({
	title,
	color = "cyan",
}: Readonly<{
	title: string;
	color?: "cyan" | "orange" | "yellow" | "purple";
}>) {
	const colors = {
		cyan: "text-cyan-400 border-cyan-500/30",
		orange: "text-orange-400 border-orange-500/30",
		yellow: "text-yellow-400 border-yellow-500/30",
		purple: "text-purple-400 border-purple-500/30",
	};

	return <div className={`font-semibold text-sm mb-3 pb-2 border-b ${colors[color]}`}>{title}</div>;
}

/**
 * Status color mapping for DataRow values
 */
const valueColorMap: Record<string, string> = {
	success: "text-emerald-400",
	error: "text-rose-400",
	neutral: "text-slate-400",
};

/**
 * Derive status badge state from loading and authenticated conditions
 */
interface BadgeState {
	status: "loading" | "success" | "error" | "neutral";
	label: string;
}

function deriveBadgeState(
	isLoading: boolean,
	isAuthenticated: boolean,
	labels: { loading: string; success: string; error: string }
): BadgeState {
	if (isLoading) {
		return { status: "loading", label: labels.loading };
	}
	if (isAuthenticated) {
		return { status: "success", label: labels.success };
	}
	return { status: "error", label: labels.error };
}

type DataRowStatus = "success" | "error" | "neutral";

/**
 * Derive status from loading state (neutral when loading, success when not)
 */
function loadingStatus(isLoading: boolean): DataRowStatus {
	if (isLoading) {
		return "neutral";
	}
	return "success";
}

/**
 * Derive status from boolean value (success when truthy, error when falsy)
 */
function booleanStatus(value: unknown): DataRowStatus {
	return value ? "success" : "error";
}

/**
 * Derive status from optional value (success when present, neutral when absent)
 */
function optionalStatus(value: unknown): DataRowStatus {
	return value ? "success" : "neutral";
}

/**
 * Get test result color class
 */
function getTestResultColor(result: string): string {
	return result.startsWith("✓") ? "text-emerald-400" : "text-rose-400";
}

/**
 * Format timestamp from JWT claim
 */
function formatJwtTimestamp(timestamp: unknown): string | null {
	if (!timestamp) return null;
	return new Date(Number(timestamp) * 1000).toLocaleString();
}

/**
 * Data row component for displaying key-value pairs
 */
function DataRow({
	label,
	value,
	status,
}: Readonly<{
	label: string;
	value: string | null | undefined;
	status?: "success" | "error" | "neutral";
}>) {
	const valueColor = status ? valueColorMap[status] : "text-slate-300";

	return (
		<div className="flex items-start gap-2 py-1 text-xs">
			<span className="text-slate-500 min-w-[80px] shrink-0">{label}:</span>
			<span className={`${valueColor} break-all`}>{value || "—"}</span>
		</div>
	);
}

/**
 * WorkOS auth section component
 */
function WorkOsSection({
	loading,
	user,
	sessionId,
}: Readonly<{
	loading: boolean;
	user: { email: string; id: string } | null | undefined;
	sessionId: string | null | undefined;
}>) {
	const truncatedSession = sessionId ? `${sessionId.substring(0, 16)}...` : null;

	return (
		<div className="mb-4">
			<SectionHeader title="WorkOS TanStack Start" color="cyan" />
			<div className="space-y-0.5 pl-2">
				<DataRow label="Loading" value={String(loading)} status={loadingStatus(loading)} />
				<DataRow label="User" value={user?.email || null} status={booleanStatus(user)} />
				<DataRow label="User ID" value={user?.id} status={optionalStatus(user?.id)} />
				<DataRow label="Session" value={truncatedSession} status={optionalStatus(sessionId)} />
			</div>
		</div>
	);
}

/**
 * Access token section component
 */
function AccessTokenSection({
	loading,
	accessToken,
	tokenError,
	testResult,
	isTestLoading,
	onTestToken,
}: Readonly<{
	loading: boolean;
	accessToken: string | null | undefined;
	tokenError: Error | null | undefined;
	testResult: string | null;
	isTestLoading: boolean;
	onTestToken: () => void;
}>) {
	const buttonLabel = isTestLoading ? "Testing..." : "Test getAccessToken()";
	const tokenPreview = accessToken ? `${accessToken.substring(0, 24)}...` : null;

	return (
		<div className="mb-4">
			<SectionHeader title="Access Token" color="orange" />
			<div className="space-y-0.5 pl-2">
				<DataRow label="Loading" value={String(loading)} status={loadingStatus(loading)} />
				<DataRow
					label="Has Token"
					value={String(!!accessToken)}
					status={booleanStatus(accessToken)}
				/>
				{accessToken && <DataRow label="Preview" value={tokenPreview} status="neutral" />}
				{tokenError && <DataRow label="Error" value={tokenError.message} status="error" />}
			</div>
			<div className="mt-2 pl-2">
				<button
					onClick={onTestToken}
					disabled={isTestLoading}
					className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded text-slate-300 transition-colors"
				>
					{buttonLabel}
				</button>
				{testResult && (
					<div className={`mt-2 text-xs ${getTestResultColor(testResult)}`}>{testResult}</div>
				)}
			</div>
		</div>
	);
}

/**
 * JWT claims section component
 */
function JwtClaimsSection({
	jwtPayload,
}: Readonly<{
	jwtPayload: Record<string, unknown> | null;
}>) {
	return (
		<div className="mb-4">
			<SectionHeader title="JWT Claims (Critical for Convex)" color="yellow" />
			{jwtPayload ? (
				<JwtClaimsContent payload={jwtPayload} />
			) : (
				<div className="text-rose-400 pl-2">No token to decode</div>
			)}
		</div>
	);
}

/**
 * JWT claims content when payload is available
 */
function JwtClaimsContent({
	payload,
}: Readonly<{
	payload: Record<string, unknown>;
}>) {
	return (
		<>
			<div className="space-y-0.5 pl-2">
				<DataRow
					label="Issuer (iss)"
					value={formatClaim(payload.iss)}
					status={booleanStatus(payload.iss)}
				/>
				<DataRow
					label="Audience (aud)"
					value={formatClaim(payload.aud)}
					status={booleanStatus(payload.aud)}
				/>
				<DataRow
					label="Subject (sub)"
					value={formatClaim(payload.sub)}
					status={optionalStatus(payload.sub)}
				/>
				<DataRow
					label="Expires"
					value={formatJwtTimestamp(payload.exp)}
					status={optionalStatus(payload.exp)}
				/>
				<DataRow label="Issued At" value={formatJwtTimestamp(payload.iat)} status="neutral" />
			</div>
			<details className="mt-3 pl-2">
				<summary className="text-slate-500 hover:text-slate-400 cursor-pointer text-xs">
					View raw JWT claims
				</summary>
				<pre className="mt-2 p-2 bg-slate-800 rounded text-[10px] overflow-auto max-h-32 text-slate-400">
					{JSON.stringify(payload, null, 2)}
				</pre>
			</details>
		</>
	);
}

/**
 * Convex auth state section component
 */
function ConvexSection({
	loading,
	authenticated,
}: Readonly<{
	loading: boolean;
	authenticated: boolean;
}>) {
	return (
		<div className="mb-4">
			<SectionHeader title="Convex Auth State" color="purple" />
			<div className="space-y-0.5 pl-2">
				<DataRow label="Loading" value={String(loading)} status={loadingStatus(loading)} />
				<DataRow
					label="Authenticated"
					value={String(authenticated)}
					status={booleanStatus(authenticated)}
				/>
			</div>
		</div>
	);
}

/**
 * Troubleshooting guide section component
 */
function TroubleshootingSection() {
	return (
		<details className="mt-4">
			<summary className="text-slate-500 hover:text-slate-400 cursor-pointer text-xs font-medium">
				Troubleshooting Guide
			</summary>
			<div className="mt-2 p-3 bg-slate-800/50 rounded text-[11px] space-y-2 text-slate-400">
				<div>
					<strong className="text-slate-300">WorkOS OK but Convex fails:</strong>
					<p>Check JWT claims (iss, aud) match Convex auth.config.ts</p>
				</div>
				<div>
					<strong className="text-slate-300">Token missing:</strong>
					<p>Ensure WORKOS_CLIENT_ID is set in Convex environment</p>
				</div>
				<div>
					<strong className="text-slate-300">Invalid audience:</strong>
					<p>Configure WorkOS JWT template with correct audience claim</p>
				</div>
			</div>
		</details>
	);
}

/**
 * Auth Debug Panel - displays authentication state across WorkOS, JWT, and Convex
 *
 * This panel helps debug the complex auth flow:
 * 1. WorkOS TanStack Start SDK handles user authentication
 * 2. Access tokens are JWTs that must have correct claims for Convex
 * 3. Convex validates the JWT and provides its own auth state
 */
export function AuthDebugPanel() {
	const { isLoading: convexLoading, isAuthenticated: convexAuthenticated } = useConvexAuth();
	const { user, loading: workosLoading, sessionId } = useAuth();
	const {
		accessToken,
		loading: tokenLoading,
		error: tokenError,
		getAccessToken,
	} = useAccessToken();

	const jwtPayload = accessToken ? decodeJwtPayload(accessToken) : null;

	const [testResult, setTestResult] = useState<string | null>(null);
	const [isTestLoading, setIsTestLoading] = useState(false);

	const handleTestToken = async () => {
		setIsTestLoading(true);
		try {
			const token = await getAccessToken();
			const result = token ? `✓ Token retrieved (${token.length} chars)` : "✗ Returned null";
			setTestResult(result);
		} catch (e) {
			const message = e instanceof Error ? e.message : "Unknown error";
			setTestResult(`✗ ${message}`);
		} finally {
			setIsTestLoading(false);
		}
	};

	return (
		<div className="p-4 font-mono text-xs bg-slate-900 min-h-full overflow-auto">
			{/* Overview Status */}
			<div className="flex flex-wrap gap-2 mb-4 p-3 bg-slate-800/50 rounded-lg">
				{(() => {
					const badgeState = deriveBadgeState(workosLoading, !!user, {
						loading: "WorkOS Loading",
						success: "WorkOS OK",
						error: "No User",
					});
					const config = getDebugStatusConfig(badgeState.status);
					return (
						<StatusBadge
							bgColor={config.bgColor}
							textColor={config.textColor}
							label={badgeState.label}
							showBorder={true}
						/>
					);
				})()}
				{(() => {
					const badgeState = deriveBadgeState(tokenLoading, !!accessToken, {
						loading: "Token Loading",
						success: "Token OK",
						error: "No Token",
					});
					const config = getDebugStatusConfig(badgeState.status);
					return (
						<StatusBadge
							bgColor={config.bgColor}
							textColor={config.textColor}
							label={badgeState.label}
							showBorder={true}
						/>
					);
				})()}
				{(() => {
					const badgeState = deriveBadgeState(convexLoading, convexAuthenticated, {
						loading: "Convex Loading",
						success: "Convex OK",
						error: "Convex Unauth",
					});
					const config = getDebugStatusConfig(badgeState.status);
					return (
						<StatusBadge
							bgColor={config.bgColor}
							textColor={config.textColor}
							label={badgeState.label}
							showBorder={true}
						/>
					);
				})()}
			</div>

			<WorkOsSection loading={workosLoading} user={user} sessionId={sessionId} />
			<AccessTokenSection
				loading={tokenLoading}
				accessToken={accessToken}
				tokenError={tokenError}
				testResult={testResult}
				isTestLoading={isTestLoading}
				onTestToken={handleTestToken}
			/>
			<JwtClaimsSection jwtPayload={jwtPayload} />
			<ConvexSection loading={convexLoading} authenticated={convexAuthenticated} />
			<TroubleshootingSection />
		</div>
	);
}
