# Component Examples

Copy-paste ready component templates following our design system.

## Table of Contents

- [Button Components](#button-components)
- [Input Components](#input-components)
- [Card Components](#card-components)
- [List Components](#list-components)
- [Navigation Components](#navigation-components)
- [Feedback Components](#feedback-components)
- [Layout Components](#layout-components)

---

## Button Components

### Primary Button

```tsx
import { Plus } from "lucide-react";

function PrimaryButton({
	children,
	onClick,
	icon: Icon,
}: {
	children: React.ReactNode;
	onClick?: () => void;
	icon?: React.ComponentType<{ size?: number }>;
}) {
	return (
		<button
			onClick={onClick}
			className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-colors font-medium"
		>
			{Icon && <Icon size={18} />}
			{children}
		</button>
	);
}

// Usage
<PrimaryButton icon={Plus} onClick={handleClick}>
	Add Task
</PrimaryButton>;
```

### Secondary Button

```tsx
function SecondaryButton({
	children,
	onClick,
}: {
	children: React.ReactNode;
	onClick?: () => void;
}) {
	return (
		<button
			onClick={onClick}
			className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl transition-colors"
		>
			{children}
		</button>
	);
}
```

### Icon Button

```tsx
import { Settings } from "lucide-react";

function IconButton({
	icon: Icon,
	onClick,
	label,
}: {
	icon: React.ComponentType<{ size?: number }>;
	onClick?: () => void;
	label: string;
}) {
	return (
		<button
			onClick={onClick}
			className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
			aria-label={label}
			title={label}
		>
			<Icon size={18} />
		</button>
	);
}

// Usage
<IconButton icon={Settings} label="Settings" onClick={openSettings} />;
```

### Danger Button

```tsx
import { Trash2 } from "lucide-react";

function DangerButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
	return (
		<button
			onClick={onClick}
			className="flex items-center gap-2 px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 rounded-xl transition-colors"
		>
			<Trash2 size={18} />
			{children}
		</button>
	);
}
```

---

## Input Components

### Text Input

```tsx
interface TextInputProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	error?: boolean;
}

function TextInput({ value, onChange, placeholder, error }: TextInputProps) {
	return (
		<input
			type="text"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			className={`
        w-full px-4 py-2.5 rounded-xl 
        bg-white/5 border text-white placeholder-gray-500 
        focus:outline-none focus:bg-white/[0.07] transition-all
        ${
					error
						? "border-red-500/50 focus:border-red-500"
						: "border-white/10 focus:border-amber-500/50"
				}
      `}
		/>
	);
}
```

### Search Input

```tsx
import { Search } from "lucide-react";

function SearchInput({
	value,
	onChange,
	placeholder = "Search...",
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	return (
		<div className="relative">
			<Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:bg-white/[0.07] transition-all"
			/>
		</div>
	);
}
```

---

## Card Components

### Basic Card

```tsx
function Card({ children }: { children: React.ReactNode }) {
	return <div className="p-4 bg-white/5 rounded-xl border border-white/5">{children}</div>;
}
```

### Feature Card

```tsx
import { Zap } from "lucide-react";

interface FeatureCardProps {
	icon: React.ComponentType<{ size?: number; className?: string }>;
	iconColor?: string;
	title: string;
	description: string;
}

function FeatureCard({
	icon: Icon,
	iconColor = "text-amber-500",
	title,
	description,
}: FeatureCardProps) {
	return (
		<div className="p-4 bg-white/5 rounded-xl border border-white/5">
			<Icon className={`${iconColor} mb-3`} size={24} />
			<h3 className="text-white font-medium mb-1">{title}</h3>
			<p className="text-gray-500 text-sm">{description}</p>
		</div>
	);
}

// Usage
<FeatureCard
	icon={Zap}
	iconColor="text-emerald-500"
	title="Fast Sync"
	description="Real-time updates across devices"
/>;
```

### Interactive Card

```tsx
function InteractiveCard({
	children,
	onClick,
}: {
	children: React.ReactNode;
	onClick?: () => void;
}) {
	return (
		<button
			onClick={onClick}
			className="w-full p-4 bg-white/5 rounded-xl border border-white/5 hover:bg-white/[0.07] hover:border-white/10 transition-all text-left"
		>
			{children}
		</button>
	);
}
```

---

## List Components

### List Item with Hover Actions

```tsx
import { MoreHorizontal, Trash2 } from "lucide-react";

interface ListItemProps {
	title: string;
	subtitle?: string;
	onDelete?: () => void;
}

function ListItem({ title, subtitle, onDelete }: ListItemProps) {
	return (
		<div className="group px-3 py-2.5 rounded-lg flex items-center justify-between hover:bg-white/5 transition-all">
			<div className="flex-1 min-w-0">
				<p className="text-white text-sm truncate">{title}</p>
				{subtitle && <p className="text-gray-500 text-xs truncate">{subtitle}</p>}
			</div>
			<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
				{onDelete && (
					<button
						onClick={onDelete}
						className="p-1.5 rounded-md hover:bg-white/10 text-gray-500 hover:text-red-400 transition-colors"
						aria-label="Delete"
					>
						<Trash2 size={16} />
					</button>
				)}
			</div>
		</div>
	);
}
```

### Checkbox List Item

```tsx
import { Circle, CheckCircle2 } from "lucide-react";

interface CheckboxListItemProps {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}

function CheckboxListItem({ label, checked, onChange }: CheckboxListItemProps) {
	return (
		<button
			onClick={() => onChange(!checked)}
			className={`
        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg 
        hover:bg-white/5 transition-all text-left
        ${checked ? "opacity-50" : ""}
      `}
		>
			{checked ? (
				<CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
			) : (
				<Circle size={20} className="text-gray-500 shrink-0" />
			)}
			<span className={checked ? "line-through text-gray-500" : "text-white"}>{label}</span>
		</button>
	);
}
```

---

## Navigation Components

### Nav Link

```tsx
import { Link } from "@tanstack/react-router";
import { Home } from "lucide-react";

interface NavLinkProps {
	to: string;
	icon: React.ComponentType<{ size?: number; className?: string }>;
	label: string;
	collapsed?: boolean;
}

function NavLink({ to, icon: Icon, label, collapsed = false }: NavLinkProps) {
	const baseClass = `
    flex items-center gap-3 px-3 py-2 rounded-lg 
    transition-all duration-200
    ${collapsed ? "justify-center" : ""}
  `;

	return (
		<Link
			to={to}
			className={`${baseClass} text-gray-400 hover:text-white hover:bg-white/5`}
			activeProps={{ className: `${baseClass} bg-white/10 text-white` }}
			title={collapsed ? label : undefined}
		>
			<Icon size={18} className="shrink-0" />
			{!collapsed && <span className="text-sm truncate">{label}</span>}
		</Link>
	);
}

// Usage
<NavLink to="/" icon={Home} label="Home" collapsed={!isExpanded} />;
```

### Section Divider with Label

```tsx
function NavSection({ label, collapsed }: { label: string; collapsed: boolean }) {
	return (
		<>
			<div className="h-px bg-white/5 my-2" />
			{!collapsed && (
				<p className="px-3 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
					{label}
				</p>
			)}
		</>
	);
}
```

---

## Feedback Components

### Badge/Pill

```tsx
import { Zap } from "lucide-react";

interface BadgeProps {
	children: React.ReactNode;
	icon?: React.ComponentType<{ size?: number }>;
	color?: "amber" | "emerald" | "blue" | "red";
}

function Badge({ children, icon: Icon, color = "amber" }: BadgeProps) {
	const colorClasses = {
		amber: "bg-amber-500/10 border-amber-500/20 text-amber-500",
		emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-500",
		blue: "bg-blue-500/10 border-blue-500/20 text-blue-500",
		red: "bg-red-500/10 border-red-500/20 text-red-500",
	};

	return (
		<div
			className={`inline-flex items-center gap-2 px-3 py-1 border rounded-full text-sm ${colorClasses[color]}`}
		>
			{Icon && <Icon size={14} />}
			<span>{children}</span>
		</div>
	);
}

// Usage
<Badge icon={Zap} color="emerald">
	Active
</Badge>;
```

### Progress Bar

```tsx
interface ProgressBarProps {
	value: number;
	max?: number;
	color?: "amber" | "emerald" | "blue";
}

function ProgressBar({ value, max = 100, color = "emerald" }: ProgressBarProps) {
	const percent = Math.min(100, Math.max(0, (value / max) * 100));

	const colorClasses = {
		amber: "bg-amber-500",
		emerald: "bg-emerald-500",
		blue: "bg-blue-500",
	};

	return (
		<div className="h-1 bg-white/5 rounded-full overflow-hidden">
			<div
				className={`h-full ${colorClasses[color]} transition-all duration-300`}
				style={{ width: `${percent}%` }}
			/>
		</div>
	);
}
```

### Empty State

```tsx
import { ClipboardList } from "lucide-react";

interface EmptyStateProps {
	icon?: React.ComponentType<{ size?: number; className?: string }>;
	title?: string;
	description: string;
	action?: React.ReactNode;
}

function EmptyState({ icon: Icon = ClipboardList, title, description, action }: EmptyStateProps) {
	return (
		<div className="text-center py-12">
			<Icon size={48} className="mx-auto text-gray-600 mb-4" />
			{title && <h3 className="text-white font-medium mb-2">{title}</h3>}
			<p className="text-gray-500 mb-4">{description}</p>
			{action}
		</div>
	);
}

// Usage
<EmptyState
	description="No tasks yet. Add one above!"
	action={<PrimaryButton icon={Plus}>Add Task</PrimaryButton>}
/>;
```

### Loading Skeleton

```tsx
function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white/5 rounded animate-pulse ${className}`} />
  )
}

// Usage
<Skeleton className="h-4 w-full" />
<Skeleton className="h-4 w-3/4" />
<Skeleton className="w-8 h-8 rounded-full" />
```

---

## Modal Components

### Basic Modal

```tsx
import { useState } from "react";
import { Modal } from "@/components";
import { X } from "lucide-react";

function BasicModalExample() {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<button
				onClick={() => setIsOpen(true)}
				className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-colors"
			>
				Open Modal
			</button>

			<Modal isOpen={isOpen} onClose={() => setIsOpen(false)} ariaLabel="Example Modal">
				<div className="p-6 bg-white/5 rounded-xl border border-white/5">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-xl font-semibold text-white">Modal Title</h2>
						<button
							onClick={() => setIsOpen(false)}
							className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
							aria-label="Close modal"
						>
							<X size={18} />
						</button>
					</div>
					<p className="text-gray-400 mb-4">
						This is a headless modal. You can style the content however you want.
					</p>
					<div className="flex gap-2 justify-end">
						<button
							onClick={() => setIsOpen(false)}
							className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl transition-colors"
						>
							Cancel
						</button>
						<button
							onClick={() => setIsOpen(false)}
							className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-colors"
						>
							Confirm
						</button>
					</div>
				</div>
			</Modal>
		</>
	);
}
```

### Modal with Custom Styling

```tsx
import { useState } from "react";
import { Modal } from "@/components";
import { AlertCircle } from "lucide-react";

function CustomStyledModal() {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<button onClick={() => setIsOpen(true)}>Open Custom Modal</button>

			<Modal
				isOpen={isOpen}
				onClose={() => setIsOpen(false)}
				backdropClassName="backdrop-blur-sm"
				containerClassName="max-w-md"
				contentClassName="animate-in fade-in-0 zoom-in-95 duration-200"
				ariaLabel="Custom styled modal"
			>
				<div className="p-8 bg-[#191919] rounded-xl border border-white/10 shadow-lg">
					<div className="flex items-center gap-3 mb-4">
						<AlertCircle size={24} className="text-amber-500 shrink-0" />
						<h2 className="text-2xl font-semibold text-white">Warning</h2>
					</div>
					<p className="text-gray-400 mb-6">
						This modal has custom styling applied through className props.
					</p>
					<button
						onClick={() => setIsOpen(false)}
						className="w-full px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-colors"
					>
						Got it
					</button>
				</div>
			</Modal>
		</>
	);
}
```

### Modal with Form

```tsx
import { useState } from "react";
import { Modal } from "@/components";
import { Plus } from "lucide-react";

function ModalWithForm() {
	const [isOpen, setIsOpen] = useState(false);
	const [input, setInput] = useState("");

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		// Handle form submission
		setIsOpen(false);
		setInput("");
	};

	return (
		<>
			<button
				onClick={() => setIsOpen(true)}
				className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-colors"
			>
				<Plus size={18} />
				Add Item
			</button>

			<Modal
				isOpen={isOpen}
				onClose={() => {
					setIsOpen(false);
					setInput("");
				}}
				ariaLabel="Add new item"
			>
				<form onSubmit={handleSubmit} className="p-6 bg-white/5 rounded-xl border border-white/5">
					<h2 className="text-xl font-semibold text-white mb-4">Add New Item</h2>

					<input
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Enter item name..."
						className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:bg-white/[0.07] transition-all mb-4"
						autoFocus
					/>

					<div className="flex gap-2 justify-end">
						<button
							type="button"
							onClick={() => {
								setIsOpen(false);
								setInput("");
							}}
							className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl transition-colors"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!input.trim()}
							className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							Add
						</button>
					</div>
				</form>
			</Modal>
		</>
	);
}
```

---

## Layout Components

### Page Container

```tsx
function PageContainer({ children }: { children: React.ReactNode }) {
	return <div className="h-full flex flex-col bg-[#0f0f0f] overflow-hidden">{children}</div>;
}
```

### Content Section

```tsx
function ContentSection({ children }: { children: React.ReactNode }) {
	return <div className="px-6 py-4 max-w-2xl mx-auto">{children}</div>;
}
```

### Scrollable Content

```tsx
function ScrollableContent({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex-1 overflow-y-auto px-6 py-2">
			<div className="max-w-2xl mx-auto">{children}</div>
		</div>
	);
}
```

### Centered Hero

```tsx
function CenteredHero({ children }: { children: React.ReactNode }) {
	return (
		<div className="h-full flex flex-col items-center justify-center px-6 py-12 max-w-3xl mx-auto">
			{children}
		</div>
	);
}
```

---

## User Avatar

```tsx
interface AvatarProps {
	src?: string | null;
	name?: string | null;
	email?: string | null;
	size?: "sm" | "md" | "lg";
}

function Avatar({ src, name, email, size = "md" }: AvatarProps) {
	const sizeClasses = {
		sm: "w-6 h-6 text-xs",
		md: "w-8 h-8 text-sm",
		lg: "w-10 h-10 text-base",
	};

	const initial = name?.[0] || email?.[0]?.toUpperCase() || "?";

	if (src) {
		return (
			<img
				src={src}
				alt={name || "User"}
				className={`${sizeClasses[size]} rounded-full object-cover ring-2 ring-white/10`}
			/>
		);
	}

	return (
		<div
			className={`${sizeClasses[size]} rounded-full bg-linear-to-br from-amber-500 to-orange-600 flex items-center justify-center font-semibold text-white`}
		>
			{initial}
		</div>
	);
}

// Usage
<Avatar src={user.profilePictureUrl} name={user.firstName} email={user.email} />;
```

---

## Complete Component Example

Here's a complete example combining multiple patterns:

```tsx
import { useState } from "react";
import { Plus, Trash2, Circle, CheckCircle2 } from "lucide-react";

interface Task {
	id: string;
	text: string;
	completed: boolean;
}

export function TaskManager() {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [input, setInput] = useState("");

	const addTask = () => {
		if (!input.trim()) return;
		setTasks([...tasks, { id: crypto.randomUUID(), text: input, completed: false }]);
		setInput("");
	};

	const toggleTask = (id: string) => {
		setTasks(tasks.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
	};

	const deleteTask = (id: string) => {
		setTasks(tasks.filter((t) => t.id !== id));
	};

	const completedCount = tasks.filter((t) => t.completed).length;
	const percent = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

	return (
		<div className="h-full flex flex-col bg-[#0f0f0f]">
			{/* Header */}
			<div className="px-6 py-6">
				<div className="max-w-2xl mx-auto">
					<div className="flex items-center justify-between mb-2">
						<h1 className="text-xl font-semibold text-white">Tasks</h1>
						<span className="text-sm text-gray-500">
							<span className="text-emerald-500 font-medium">{completedCount}</span>/{tasks.length}
						</span>
					</div>
					{tasks.length > 0 && (
						<div className="h-1 bg-white/5 rounded-full overflow-hidden">
							<div
								className="h-full bg-emerald-500 transition-all duration-300"
								style={{ width: `${percent}%` }}
							/>
						</div>
					)}
				</div>
			</div>

			{/* Input */}
			<div className="px-6 pb-4">
				<div className="max-w-2xl mx-auto flex gap-2">
					<input
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && addTask()}
						placeholder="Add a new task..."
						className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50 transition-all"
					/>
					<button
						onClick={addTask}
						className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-colors flex items-center gap-2"
					>
						<Plus size={18} />
						<span className="hidden sm:inline">Add</span>
					</button>
				</div>
			</div>

			{/* Task List */}
			<div className="flex-1 overflow-y-auto px-6 py-2">
				<div className="max-w-2xl mx-auto space-y-1">
					{tasks.length === 0 ? (
						<div className="text-center py-12">
							<p className="text-gray-500">No tasks yet. Add one above!</p>
						</div>
					) : (
						tasks.map((task) => (
							<div
								key={task.id}
								className={`group px-3 py-2.5 rounded-lg flex items-center justify-between hover:bg-white/5 transition-all ${
									task.completed ? "opacity-50" : ""
								}`}
							>
								<button
									onClick={() => toggleTask(task.id)}
									className="flex items-center gap-3 flex-1 text-left"
								>
									{task.completed ? (
										<CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
									) : (
										<Circle
											size={20}
											className="text-gray-500 group-hover:text-gray-400 shrink-0"
										/>
									)}
									<span className={task.completed ? "line-through text-gray-500" : "text-white"}>
										{task.text}
									</span>
								</button>
								<button
									onClick={() => deleteTask(task.id)}
									className="p-1.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-white/5"
									aria-label="Delete task"
								>
									<Trash2 size={16} />
								</button>
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}
```
