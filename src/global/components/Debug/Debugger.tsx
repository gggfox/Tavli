import { Bug, ChevronDown, Shield, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { KEY } from "@/global/utils/keyboard";
import { AuthDebugPanel } from "../../../features/auth/AuthDebugPanel";

type DebugSection = {
	id: string;
	name: string;
	icon: ReactNode;
	panel: ReactNode;
};

/**
 * Available debug sections - add new sections here
 */
const DEBUG_SECTIONS: DebugSection[] = [
	{
		id: "auth",
		name: "Authentication",
		icon: <Shield size={14} />,
		panel: <AuthDebugPanel />,
	},
	// Future sections can be added here:
	// { id: "effect", name: "Effect", icon: <Layers size={14} />, panel: <EffectDebugPanel /> },
	// { id: "convex", name: "Convex Queries", icon: <Database size={14} />, panel: <ConvexDebugPanel /> },
];

/**
 * Standalone debugger component with floating button trigger.
 *
 * Use this when you want a dedicated debugger outside of TanStack Devtools.
 * For TanStack Devtools integration, use AuthDebugPanel directly as a plugin.
 */
export function Debugger() {
	const [isOpen, setIsOpen] = useState(false);
	const [activeSection, setActiveSection] = useState(DEBUG_SECTIONS[0].id);
	const [isSectionMenuOpen, setIsSectionMenuOpen] = useState(false);

	const currentSection = DEBUG_SECTIONS.find((s) => s.id === activeSection) || DEBUG_SECTIONS[0];

	return (
		<>
			{/* Floating trigger button */}
			<button
				onClick={() => setIsOpen(true)}
				className={`
          fixed bottom-4 right-4 z-40
          w-12 h-12 rounded-full
          bg-linear-to-br from-violet-600 to-fuchsia-600
          hover:from-violet-500 hover:to-fuchsia-500
          shadow-lg shadow-violet-500/25
          flex items-center justify-center
          transition-all duration-300
          hover:scale-110 active:scale-95
          ${isOpen ? "opacity-0 pointer-events-none scale-75" : "opacity-100"}
        `}
				title="Open Debugger"
			>
				<Bug size={20} className="text-white" />
			</button>

			{/* Debugger panel */}
			<div
				className={`
          fixed bottom-4 right-4 z-50
          w-[420px] max-w-[calc(100vw-2rem)]
          bg-slate-900 border border-slate-700
          rounded-xl overflow-hidden
          shadow-2xl shadow-black/50
          transition-all duration-300 ease-out
          ${
						isOpen
							? "opacity-100 translate-y-0 scale-100"
							: "opacity-0 translate-y-4 scale-95 pointer-events-none"
					}
        `}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 bg-slate-800/80 border-b border-slate-700">
					{/* Section selector */}
					<div className="relative">
						<button
							onClick={() => setIsSectionMenuOpen(!isSectionMenuOpen)}
							className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors"
						>
							{currentSection.icon}
							<span className="text-sm font-medium text-slate-200">{currentSection.name}</span>
							<ChevronDown
								size={14}
								className={`text-slate-400 transition-transform ${isSectionMenuOpen ? "rotate-180" : ""}`}
							/>
						</button>

						{/* Dropdown menu */}
						{isSectionMenuOpen && (
							<>
								{/* Backdrop - using button for accessibility */}
								<button
									type="button"
									aria-label="Close menu"
									className="fixed inset-0 z-10 cursor-default bg-transparent border-none"
									onClick={() => setIsSectionMenuOpen(false)}
									onKeyDown={(e) => {
										if (e.key === KEY.Escape) setIsSectionMenuOpen(false);
									}}
								/>

								{/* Menu */}
								<div className="absolute top-full left-0 mt-1 z-20 py-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl min-w-[180px]">
									{DEBUG_SECTIONS.map((section) => (
										<button
											key={section.id}
											onClick={() => {
												setActiveSection(section.id);
												setIsSectionMenuOpen(false);
											}}
											className={`
                        w-full flex items-center gap-2 px-3 py-2 text-sm text-left
                        transition-colors
                        ${
													section.id === activeSection
														? "bg-violet-600/20 text-violet-300"
														: "text-slate-300 hover:bg-slate-700/50"
												}
                      `}
										>
											{section.icon}
											<span>{section.name}</span>
										</button>
									))}

									{DEBUG_SECTIONS.length === 1 && (
										<div className="px-3 py-2 text-xs text-slate-500 italic">
											More sections coming soon
										</div>
									)}
								</div>
							</>
						)}
					</div>

					{/* Title and close */}
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-2 text-slate-400">
							<Bug size={16} />
							<span className="text-xs font-medium uppercase tracking-wider">Debug</span>
						</div>

						<button
							onClick={() => setIsOpen(false)}
							className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-slate-200"
							title="Close"
						>
							<X size={16} />
						</button>
					</div>
				</div>

				{/* Content */}
				<div className="max-h-[70vh] overflow-auto">{currentSection.panel}</div>
			</div>
		</>
	);
}
