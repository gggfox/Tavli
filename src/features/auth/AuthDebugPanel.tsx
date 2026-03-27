import { StatusBadge } from "@/global";
import { getDebugStatusConfig } from "@/global/components/StatusBadge/constants/debugStatusConfig";
import { useAuth, useUser } from "@clerk/tanstack-react-start";
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

function formatClaim(value: unknown): string {
	if (value === undefined || value === null) return "MISSING!";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.join(", ");
	return JSON.stringify(value);
}

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

const valueColorMap: Record<string, string> = {
	success: "text-emerald-400",
	error: "text-rose-400",
	neutral: "text-slate-400",
};

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

function loadingStatus(isLoading: boolean): DataRowStatus {
	return isLoading ? "neutral" : "success";
}

function booleanStatus(value: unknown): DataRowStatus {
	return value ? "success" : "error";
}

function optionalStatus(value: unknown): DataRowStatus {
	return value ? "success" : "neutral";
}

function formatJwtTimestamp(timestamp: unknown): string | null {
	if (!timestamp) return null;
	return new Date(Number(timestamp) * 1000).toLocaleString();
}

function DataRow({
	label,
	value,
	status,
}: Readonly<{
	label: string;
	value: string | null | undefined;
	status?: DataRowStatus;
}>) {
	const valueColor = status ? valueColorMap[status] : "text-slate-300";

	return (
		<div className="flex items-start gap-2 py-1 text-xs">
			<span className="text-slate-500 min-w-[80px] shrink-0">{label}:</span>
			<span className={`${valueColor} break-all`}>{value || "—"}</span>
		</div>
	);
}

function ClerkSection({
	isLoaded,
	isSignedIn,
	userId,
	email,
}: Readonly<{
	isLoaded: boolean;
	isSignedIn: boolean;
	userId: string | null | undefined;
	email: string | null | undefined;
}>) {
	return (
		<div className="mb-4">
			<SectionHeader title="Clerk Auth" color="cyan" />
			<div className="space-y-0.5 pl-2">
				<DataRow label="Loaded" value={String(isLoaded)} status={loadingStatus(!isLoaded)} />
				<DataRow label="Signed In" value={String(isSignedIn)} status={booleanStatus(isSignedIn)} />
				<DataRow label="User ID" value={userId} status={optionalStatus(userId)} />
				<DataRow label="Email" value={email} status={optionalStatus(email)} />
			</div>
		</div>
	);
}

function TokenSection({
	token,
	tokenError,
	testResult,
	isTestLoading,
	onTestToken,
}: Readonly<{
	token: string | null;
	tokenError: string | null;
	testResult: string | null;
	isTestLoading: boolean;
	onTestToken: () => void;
}>) {
	const tokenPreview = token ? `${token.substring(0, 24)}...` : null;
	const buttonLabel = isTestLoading ? "Testing..." : "Test getToken()";

	return (
		<div className="mb-4">
			<SectionHeader title="Convex Token" color="orange" />
			<div className="space-y-0.5 pl-2">
				<DataRow label="Has Token" value={String(!!token)} status={booleanStatus(token)} />
				{token && <DataRow label="Preview" value={tokenPreview} status="neutral" />}
				{tokenError && <DataRow label="Error" value={tokenError} status="error" />}
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
					<div
						className={`mt-2 text-xs ${testResult.startsWith("✓") ? "text-emerald-400" : "text-rose-400"}`}
					>
						{testResult}
					</div>
				)}
			</div>
		</div>
	);
}

function JwtClaimsSection({
	jwtPayload,
}: Readonly<{
	jwtPayload: Record<string, unknown> | null;
}>) {
	return (
		<div className="mb-4">
			<SectionHeader title="JWT Claims (Critical for Convex)" color="yellow" />
			{jwtPayload ? (
				<>
					<div className="space-y-0.5 pl-2">
						<DataRow
							label="Issuer (iss)"
							value={formatClaim(jwtPayload.iss)}
							status={booleanStatus(jwtPayload.iss)}
						/>
						<DataRow
							label="Audience (aud)"
							value={formatClaim(jwtPayload.aud)}
							status={booleanStatus(jwtPayload.aud)}
						/>
						<DataRow
							label="Subject (sub)"
							value={formatClaim(jwtPayload.sub)}
							status={optionalStatus(jwtPayload.sub)}
						/>
						<DataRow
							label="Expires"
							value={formatJwtTimestamp(jwtPayload.exp)}
							status={optionalStatus(jwtPayload.exp)}
						/>
					</div>
					<details className="mt-3 pl-2">
						<summary className="text-slate-500 hover:text-slate-400 cursor-pointer text-xs">
							View raw JWT claims
						</summary>
						<pre className="mt-2 p-2 bg-slate-800 rounded text-[10px] overflow-auto max-h-32 text-slate-400">
							{JSON.stringify(jwtPayload, null, 2)}
						</pre>
					</details>
				</>
			) : (
				<div className="text-rose-400 pl-2">No token to decode</div>
			)}
		</div>
	);
}

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
 * Auth Debug Panel - displays authentication state across Clerk, JWT, and Convex.
 *
 * Flow:
 * 1. Clerk handles user authentication
 * 2. getToken({ template: "convex" }) produces JWTs for Convex
 * 3. Convex validates the JWT and provides its own auth state
 */
export function AuthDebugPanel() {
	const { isLoaded, isSignedIn, userId, getToken } = useAuth();
	const { user } = useUser();
	const { isLoading: convexLoading, isAuthenticated: convexAuthenticated } = useConvexAuth();

	const [convexToken, setConvexToken] = useState<string | null>(null);
	const [tokenError, setTokenError] = useState<string | null>(null);
	const [testResult, setTestResult] = useState<string | null>(null);
	const [isTestLoading, setIsTestLoading] = useState(false);

	const jwtPayload = convexToken ? decodeJwtPayload(convexToken) : null;

	const handleTestToken = async () => {
		setIsTestLoading(true);
		try {
			const token = await getToken({ template: "convex" });
			if (token) {
				setConvexToken(token);
				setTokenError(null);
				setTestResult(`✓ Token retrieved (${token.length} chars)`);
			} else {
				setTestResult("✗ Returned null");
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : "Unknown error";
			setTokenError(message);
			setTestResult(`✗ ${message}`);
		} finally {
			setIsTestLoading(false);
		}
	};

	const email = user?.primaryEmailAddress?.emailAddress ?? null;

	return (
		<div className="p-4 font-mono text-xs bg-slate-900 min-h-full overflow-auto">
			<div className="flex flex-wrap gap-2 mb-4 p-3 bg-slate-800/50 rounded-lg">
				{(() => {
					const badgeState = deriveBadgeState(!isLoaded, isSignedIn ?? false, {
						loading: "Clerk Loading",
						success: "Clerk OK",
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
					const badgeState = deriveBadgeState(false, !!convexToken, {
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

			<ClerkSection
				isLoaded={isLoaded}
				isSignedIn={isSignedIn ?? false}
				userId={userId}
				email={email}
			/>
			<TokenSection
				token={convexToken}
				tokenError={tokenError}
				testResult={testResult}
				isTestLoading={isTestLoading}
				onTestToken={handleTestToken}
			/>
			<JwtClaimsSection jwtPayload={jwtPayload} />
			<ConvexSection loading={convexLoading} authenticated={convexAuthenticated} />
		</div>
	);
}
