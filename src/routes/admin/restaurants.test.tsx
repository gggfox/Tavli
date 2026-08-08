/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, boundaries/element-types, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	navigateMock: vi.fn(),
	search: { manage: undefined, settings: undefined } as {
		manage?: string;
		settings?: string;
	},
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: (_path: string) => (options: any) => ({
		...options,
		useSearch: () => hoisted.search,
	}),
	useNavigate: () => hoisted.navigateMock,
}));

vi.mock("@/global/components", () => ({
	AdminPageLayout: ({ children }: any) => <div data-testid="admin-page-layout">{children}</div>,
}));

vi.mock("@/features/restaurants", () => ({
	AdminRestaurantsList: ({ manageId, settingsId, onManageChange, onSettingsChange }: any) => (
		<div
			data-testid="restaurants-list"
			data-manage-id={manageId ?? ""}
			data-settings-id={settingsId ?? ""}
		>
			<button type="button" onClick={() => onSettingsChange("restaurants:settings-target")}>
				open-settings
			</button>
			<button type="button" onClick={() => onSettingsChange(null)}>
				close-settings
			</button>
			<button type="button" onClick={() => onManageChange("restaurants:manage-target")}>
				open-manage
			</button>
		</div>
	),
}));

import { Route } from "./restaurants";

function renderPage() {
	const Component = (Route as any).component;
	return render(<Component />);
}

describe("admin/restaurants search params", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.search = { manage: undefined, settings: undefined };
	});

	describe("validateSearch", () => {
		const validate = (Route as any).validateSearch as (s: Record<string, unknown>) => {
			manage?: string;
			settings?: string;
		};

		it("keeps a settings id as a real, navigable search param", () => {
			expect(validate({ settings: "restaurants:abc" })).toEqual({
				manage: undefined,
				settings: "restaurants:abc",
			});
		});

		it("still parses manage the way it always did", () => {
			expect(validate({ manage: "restaurants:abc" })).toEqual({
				manage: "restaurants:abc",
				settings: undefined,
			});
		});

		it("treats settings and manage as mutually exclusive", () => {
			expect(validate({ manage: "restaurants:tables", settings: "restaurants:config" })).toEqual({
				manage: undefined,
				settings: "restaurants:config",
			});
		});

		it("drops empty and non-string values", () => {
			expect(validate({ settings: "", manage: 42 })).toEqual({
				manage: undefined,
				settings: undefined,
			});
		});
	});

	it("drops the page header chrome when the settings canvas is open", () => {
		hoisted.search = { settings: "restaurants:abc" };
		renderPage();

		expect(screen.queryByTestId("admin-page-layout")).toBeNull();
		expect(screen.getByTestId("restaurants-list").dataset.settingsId).toBe("restaurants:abc");
	});

	it("keeps the page header when neither canvas is open", () => {
		renderPage();

		expect(screen.getByTestId("admin-page-layout")).toBeTruthy();
		expect(screen.getByTestId("restaurants-list").dataset.settingsId).toBe("");
	});

	it("navigates to ?settings=<id> when the list opens a restaurant's settings", () => {
		renderPage();

		fireEvent.click(screen.getByText("open-settings"));

		expect(hoisted.navigateMock).toHaveBeenCalledWith({
			to: "/admin/restaurants",
			search: { settings: "restaurants:settings-target", manage: undefined },
			replace: false,
		});
	});

	it("clears the param (and keeps history) when the canvas is closed", () => {
		hoisted.search = { settings: "restaurants:abc" };
		renderPage();

		fireEvent.click(screen.getByText("close-settings"));

		expect(hoisted.navigateMock).toHaveBeenCalledWith({
			to: "/admin/restaurants",
			search: { settings: undefined, manage: undefined },
			replace: false,
		});
	});

	it("clears settings when the tables canvas is opened instead", () => {
		hoisted.search = { settings: "restaurants:abc" };
		renderPage();

		fireEvent.click(screen.getByText("open-manage"));

		expect(hoisted.navigateMock).toHaveBeenCalledWith({
			to: "/admin/restaurants",
			search: { manage: "restaurants:manage-target", settings: undefined },
			replace: false,
		});
	});
});
