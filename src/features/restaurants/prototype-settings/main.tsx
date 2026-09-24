/**
 * PROTOTYPE — throwaway entry. Four variants of the restaurant settings page
 * (plus a mobile-capable app shell), switchable via `?variant=A|B|C|D` and
 * framed at phone/tablet/desktop via `?device=`. Mock data in memory; nothing
 * saves. Standalone Vite SPA (vite.proto.config.ts) so it needs no Clerk,
 * Convex or Infisical: `pnpm proto:settings`.
 *
 * Branch: proto/restaurant-settings-layout. Never merged to main.
 *
 * `?section=` is the per-section deep link every variant honours.
 * `?embed=1` is the framed inner page (no switcher).
 */
import { PrototypeSwitcher, type PrototypeDevice } from "@/global/components/PrototypeSwitcher";
import { StrictMode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ProtoStoreProvider, isSectionId, type SectionId } from "./mock";
import { ProtoShell } from "./shell";
import { VARIANTS, type VariantKey } from "./variants";
import "./proto.css";

interface Search {
	variant: VariantKey;
	section?: SectionId;
	device?: PrototypeDevice;
	embed: boolean;
}

const DEVICE_SIZE: Record<PrototypeDevice, readonly [number, number]> = {
	phone: [390, 844],
	tablet: [820, 1180],
	desktop: [1440, 900],
};

// ─── URL as the only state store for navigation ─────────────────────────────

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
	listeners.add(fn);
	globalThis.addEventListener("popstate", fn);
	return () => {
		listeners.delete(fn);
		globalThis.removeEventListener("popstate", fn);
	};
};
const getHref = () => location.href;

function parse(href: string): Search {
	const p = new URL(href).searchParams;
	const v = p.get("variant");
	const d = p.get("device");
	const s = p.get("section");
	return {
		variant: v && v in VARIANTS ? (v as VariantKey) : "A",
		section: isSectionId(s) ? s : undefined,
		device: d === "phone" || d === "tablet" || d === "desktop" ? d : undefined,
		embed: p.get("embed") === "1",
	};
}

function setSearch(patch: Partial<Search>, replace = true) {
	const url = new URL(location.href);
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined || v === false) url.searchParams.delete(k);
		else url.searchParams.set(k, v === true ? "1" : String(v));
	}
	history[replace ? "replaceState" : "pushState"](null, "", url);
	listeners.forEach((fn) => fn());
}

function useSearch(): Search {
	return parse(useSyncExternalStore(subscribe, getHref));
}

// ─── page ───────────────────────────────────────────────────────────────────

function PrototypePage() {
	const search = useSearch();
	const { variant } = search;

	if (search.device && !search.embed) {
		return (
			<>
				<DeviceFrame device={search.device} variant={variant} section={search.section} />
				<Switcher variant={variant} device={search.device} />
			</>
		);
	}

	const { Component } = VARIANTS[variant];
	return (
		<ProtoStoreProvider>
			<ProtoShell>
				{/* key: switching variant starts from a clean layout */}
				<Component
					key={variant}
					nav={{
						section: search.section,
						go: (section, opts) => setSearch({ section }, opts?.replace ?? false),
					}}
				/>
			</ProtoShell>
			{search.embed ? null : <Switcher variant={variant} device={undefined} />}
		</ProtoStoreProvider>
	);
}

function Switcher({
	variant,
	device,
}: Readonly<{ variant: VariantKey; device: PrototypeDevice | undefined }>) {
	return (
		<PrototypeSwitcher
			variants={Object.entries(VARIANTS).map(([k, v]) => [k as VariantKey, v.name] as const)}
			current={variant}
			onVariant={(v) => setSearch({ variant: v, section: undefined })}
			device={device}
			onDevice={(d) => setSearch({ device: d })}
		/>
	);
}

/** Renders the page in an iframe at a real device width so media queries fire. */
function DeviceFrame({
	device,
	variant,
	section,
}: Readonly<{ device: PrototypeDevice; variant: VariantKey; section?: SectionId }>) {
	const [w, h] = DEVICE_SIZE[device];
	const box = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);

	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const fit = () => setScale(Math.min(1, (el.clientWidth - 32) / w, (el.clientHeight - 112) / h));
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, [w, h]);

	const params = new URLSearchParams({ variant, embed: "1" });
	if (section) params.set("section", section);

	return (
		<div
			ref={box}
			className="flex h-dvh items-center justify-center overflow-hidden bg-[#0b0b0c] pb-16"
		>
			<div style={{ width: w * scale, height: h * scale }}>
				<iframe
					key={`${device}-${variant}`}
					title={`Prototipo ${variant} — ${device}`}
					src={`${location.pathname}?${params}`}
					width={w}
					height={h}
					style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
					className={`border-0 bg-background ring-1 ring-white/15 ${device === "phone" ? "rounded-[2rem]" : "rounded-xl"}`}
				/>
			</div>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PrototypePage />
	</StrictMode>
);
