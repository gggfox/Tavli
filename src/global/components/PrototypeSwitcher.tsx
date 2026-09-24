/**
 * PROTOTYPE tooling — floating bar that cycles `?variant=` and frames the
 * page at phone / tablet / desktop widths. Never ships: renders nothing in
 * production builds. Lives on proto/* branches only.
 */
import { ChevronLeft, ChevronRight, Monitor, Smartphone, Tablet, Maximize } from "lucide-react";
import { useEffect } from "react";

export type PrototypeDevice = "phone" | "tablet" | "desktop";

interface PrototypeSwitcherProps<K extends string> {
	readonly variants: ReadonlyArray<readonly [K, string]>;
	readonly current: K;
	readonly onVariant: (key: K) => void;
	readonly device: PrototypeDevice | undefined;
	readonly onDevice: (device: PrototypeDevice | undefined) => void;
}

const DEVICES: ReadonlyArray<readonly [PrototypeDevice | undefined, string, typeof Monitor]> = [
	[undefined, "Ventana real", Maximize],
	["phone", "Teléfono 390", Smartphone],
	["tablet", "Tablet 820", Tablet],
	["desktop", "Escritorio 1440", Monitor],
];

function isTyping(el: Element | null): boolean {
	if (!el) return false;
	const tag = el.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		(el as HTMLElement).isContentEditable
	);
}

export function PrototypeSwitcher<K extends string>({
	variants,
	current,
	onVariant,
	device,
	onDevice,
}: PrototypeSwitcherProps<K>) {
	const index = Math.max(
		0,
		variants.findIndex(([k]) => k === current)
	);
	const step = (delta: number) =>
		onVariant(variants[(index + delta + variants.length) % variants.length][0]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (isTyping(document.activeElement)) return;
			if (e.key === "ArrowLeft") step(-1);
			if (e.key === "ArrowRight") step(1);
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	});

	if (import.meta.env.PROD) return null;

	return (
		<div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#fde047] px-1.5 py-1 text-[13px] font-medium text-black shadow-[0_8px_30px_rgba(0,0,0,0.5)] ring-2 ring-black">
			<button
				type="button"
				aria-label="Variante anterior"
				onClick={() => step(-1)}
				className="rounded-full p-1.5 hover:bg-black/10"
			>
				<ChevronLeft size={16} />
			</button>
			<span className="min-w-[11rem] whitespace-nowrap px-1 text-center">
				<b>{current}</b> · {variants[index][1]}
			</span>
			<button
				type="button"
				aria-label="Variante siguiente"
				onClick={() => step(1)}
				className="rounded-full p-1.5 hover:bg-black/10"
			>
				<ChevronRight size={16} />
			</button>
			<span className="mx-1 h-5 w-px bg-black/30" />
			{DEVICES.map(([d, label, Icon]) => (
				<button
					key={label}
					type="button"
					title={label}
					aria-label={label}
					aria-pressed={device === d}
					onClick={() => onDevice(d)}
					className={`rounded-full p-1.5 ${device === d ? "bg-black text-[#fde047]" : "hover:bg-black/10"}`}
				>
					<Icon size={15} />
				</button>
			))}
		</div>
	);
}
