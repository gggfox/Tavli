import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminPageLayout } from "./AdminPageLayout";
import { useAdminPageToolbar } from "@/global/hooks/useAdminPageToolbar";

function RegisteredToolbar() {
	useAdminPageToolbar(<div data-testid="registered-toolbar">toolbar</div>);
	return <p>page body</p>;
}

describe("AdminPageLayout", () => {
	it("renders breadcrumb when provided", () => {
		render(
			<AdminPageLayout breadcrumb={<a href="/admin/menus">Back to menus</a>}>
				<p>content</p>
			</AdminPageLayout>
		);

		expect(screen.getByRole("link", { name: "Back to menus" })).toBeInTheDocument();
	});

	it("renders actions in sticky chrome", () => {
		render(
			<AdminPageLayout actions={<button type="button">Export</button>}>
				<p>content</p>
			</AdminPageLayout>
		);

		expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
	});

	it("registers dashboard toolbars via useAdminPageToolbar", () => {
		render(
			<AdminPageLayout actions={<button type="button">Export</button>}>
				<RegisteredToolbar />
			</AdminPageLayout>
		);

		expect(screen.getByTestId("registered-toolbar")).toBeInTheDocument();
		expect(screen.getByText("page body")).toBeInTheDocument();
	});
});
