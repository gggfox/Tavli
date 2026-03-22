import { StatusBadge } from "@/global";
import { getDebugStatusConfig } from "@/global/components/StatusBadge/constants/debugStatusConfig";
import { useConvexAuth } from "convex/react";
import { useState } from "react";
import { useTasks } from "../../features/tasks/hooks/useTasks";
import {
	simulateTaskError,
	type TaskOperationType,
} from "../../features/tasks/stores/TasksDebugStore";

/**
 * Section header component
 */
function SectionHeader({
	title,
	color = "cyan",
}: Readonly<{
	title: string;
	color?: "cyan" | "orange" | "yellow" | "purple" | "rose";
}>) {
	const colors = {
		cyan: "text-cyan-400 border-cyan-500/30",
		orange: "text-orange-400 border-orange-500/30",
		yellow: "text-yellow-400 border-yellow-500/30",
		purple: "text-purple-400 border-purple-500/30",
		rose: "text-rose-400 border-rose-500/30",
	};

	return <div className={`font-semibold text-sm mb-3 pb-2 border-b ${colors[color]}`}>{title}</div>;
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
	value: string | number | null | undefined;
	status?: "success" | "error" | "neutral" | "warning";
}>) {
	const valueColorMap: Record<string, string> = {
		success: "text-emerald-400",
		error: "text-rose-400",
		warning: "text-orange-400",
		neutral: "text-slate-400",
	};
	const valueColor = status ? valueColorMap[status] : "text-slate-300";

	return (
		<div className="flex items-start gap-2 py-1 text-xs">
			<span className="text-slate-500 min-w-[80px] shrink-0">{label}:</span>
			<span className={`${valueColor} break-all`}>{value ?? "—"}</span>
		</div>
	);
}

/**
 * Task counts section
 */
function TaskCountsSection({
	counts,
}: Readonly<{
	counts: { total: number; completed: number; pending: number };
}>) {
	return (
		<div className="mb-4">
			<SectionHeader title="Task Counts" color="cyan" />
			<div className="space-y-0.5 pl-2">
				<DataRow
					label="Total"
					value={counts.total}
					status={counts.total > 0 ? "success" : "neutral"}
				/>
				<DataRow
					label="Completed"
					value={counts.completed}
					status={counts.completed > 0 ? "success" : "neutral"}
				/>
				<DataRow
					label="Pending"
					value={counts.pending}
					status={counts.pending > 0 ? "warning" : "success"}
				/>
			</div>
		</div>
	);
}

/**
 * Architecture info section
 */
function ArchitectureSection() {
	return (
		<div className="mb-4">
			<SectionHeader title="Architecture" color="orange" />
			<div className="pl-2 space-y-2 text-xs text-slate-400">
				<p>
					Mutations return result objects with <code className="text-orange-300">success</code> and{" "}
					<code className="text-orange-300">error</code> properties.
				</p>
				<p>Error state is managed at the component level, not in the hook.</p>
				<div className="bg-slate-800/50 p-2 rounded mt-2 text-[10px]">
					<div className="text-slate-500 mb-1">Example:</div>
					<code className="text-cyan-300">
						{`const result = await addTask("text")`}
						<br />
						{`if (result.success) { ... }`}
					</code>
				</div>
			</div>
		</div>
	);
}

/**
 * Force error section for testing error UI
 */
function ForceErrorSection() {
	const [customMessage, setCustomMessage] = useState("");
	const [selectedOperation, setSelectedOperation] = useState<TaskOperationType>("create");

	const handleForceError = () => {
		simulateTaskError(selectedOperation, customMessage || undefined);
	};

	return (
		<div className="mb-4">
			<SectionHeader title="Force Error (Testing)" color="rose" />
			<div className="pl-2 space-y-3">
				<fieldset className="border-0 p-0 m-0">
					<legend className="text-slate-500 text-xs block mb-1">Operation Type</legend>
					<div className="flex gap-2">
						{(["create", "delete", "toggle"] as const).map((op) => (
							<button
								key={op}
								onClick={() => setSelectedOperation(op)}
								className={`px-2 py-1 text-xs rounded transition-colors ${
									selectedOperation === op
										? "bg-rose-500/30 text-rose-300 border border-rose-500/50"
										: "bg-slate-700 text-slate-400 hover:bg-slate-600"
								}`}
							>
								{op}
							</button>
						))}
					</div>
				</fieldset>

				<div>
					<label htmlFor="debug-custom-message" className="text-slate-500 text-xs block mb-1">
						Custom Message (optional)
					</label>
					<input
						id="debug-custom-message"
						type="text"
						value={customMessage}
						onChange={(e) => setCustomMessage(e.target.value)}
						placeholder="Leave empty for default"
						className="w-full px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-slate-300 text-xs focus:outline-none focus:border-rose-500/50"
					/>
				</div>

				<div className="flex gap-2">
					<button
						onClick={handleForceError}
						className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 rounded text-white transition-colors text-xs font-medium"
					>
						Trigger Error
					</button>
					<button
						onClick={() =>
							simulateTaskError("create", "Your session has expired. Please sign in again.")
						}
						className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-white transition-colors text-xs font-medium"
					>
						Auth Error
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * Tasks list preview section
 */
function TasksListSection({
	tasks,
}: Readonly<{
	tasks: readonly { _id: string; text: string; isCompleted?: boolean }[];
}>) {
	const displayTasks = tasks.slice(0, 5);
	const hasMore = tasks.length > 5;

	return (
		<div className="mb-4">
			<SectionHeader title="Tasks Preview" color="purple" />
			{tasks.length === 0 ? (
				<div className="text-slate-500 pl-2 text-xs">No tasks</div>
			) : (
				<div className="pl-2 space-y-1">
					{displayTasks.map((task) => (
						<div
							key={task._id}
							className="flex items-center gap-2 text-xs py-1 px-2 bg-slate-800/50 rounded"
						>
							<span className={task.isCompleted ? "text-emerald-400" : "text-slate-400"}>
								{task.isCompleted ? "✓" : "○"}
							</span>
							<span
								className={`${task.isCompleted ? "text-slate-500 line-through" : "text-slate-300"} truncate`}
							>
								{task.text}
							</span>
						</div>
					))}
					{hasMore && (
						<div className="text-slate-500 text-xs pl-2">... and {tasks.length - 5} more</div>
					)}
				</div>
			)}
			<details className="mt-3 pl-2">
				<summary className="text-slate-500 hover:text-slate-400 cursor-pointer text-xs">
					View raw tasks data
				</summary>
				<pre className="mt-2 p-2 bg-slate-800 rounded text-[10px] overflow-auto max-h-48 text-slate-400">
					{JSON.stringify(tasks, null, 2)}
				</pre>
			</details>
		</div>
	);
}

/**
 * Wrapper that checks auth before rendering tasks panel
 */
function TasksPanelContent() {
	const { tasks, counts } = useTasks();

	return (
		<>
			<TaskCountsSection counts={counts} />
			<ArchitectureSection />
			<ForceErrorSection />
			<TasksListSection tasks={tasks} />
		</>
	);
}

/**
 * Unauthenticated state view
 */
function UnauthenticatedView() {
	return (
		<div className="p-6 text-center">
			<div className="text-slate-500 mb-2">🔒</div>
			<div className="text-slate-400 text-sm mb-1">Not authenticated</div>
			<div className="text-slate-600 text-xs">Sign in to view tasks debug info</div>
		</div>
	);
}

/**
 * Loading state view
 */
function LoadingView() {
	return (
		<div className="p-6 text-center">
			<div className="text-slate-500 mb-2 animate-pulse">⏳</div>
			<div className="text-slate-400 text-sm">Loading auth state...</div>
		</div>
	);
}

function getAuthStatus(isLoading: boolean, isAuthenticated: boolean) {
	if (isLoading) return { status: "loading" as const, label: "Loading" };
	if (isAuthenticated) return { status: "success" as const, label: "Authenticated" };
	return { status: "error" as const, label: "Unauthenticated" };
}

function AuthContent({
	isLoading,
	isAuthenticated,
}: Readonly<{ isLoading: boolean; isAuthenticated: boolean }>) {
	if (isLoading) return <LoadingView />;
	if (isAuthenticated) return <TasksPanelContent />;
	return <UnauthenticatedView />;
}

/**
 * Tasks Debug Panel - displays task state
 *
 * This panel helps debug tasks functionality:
 * - View current task counts and list
 * - Understand the Effect-based architecture
 *
 * Note: Error state is now managed at the component level (AuthenticatedTasks),
 * not in the useTasks hook. Mutations return result objects for typed error handling.
 */
export function TasksDebugPanel() {
	const { isLoading, isAuthenticated } = useConvexAuth();
	const authStatus = getAuthStatus(isLoading, isAuthenticated);

	return (
		<div className="p-4 font-mono text-xs bg-slate-900 min-h-full overflow-auto">
			{/* Overview Status */}
			<div className="flex flex-wrap gap-2 mb-4 p-3 bg-slate-800/50 rounded-lg">
				{(() => {
					const config = getDebugStatusConfig(authStatus.status);
					return (
						<StatusBadge
							bgColor={config.bgColor}
							textColor={config.textColor}
							label={authStatus.label}
							showBorder={true}
						/>
					);
				})()}
			</div>

			<AuthContent isLoading={isLoading} isAuthenticated={isAuthenticated} />
		</div>
	);
}
