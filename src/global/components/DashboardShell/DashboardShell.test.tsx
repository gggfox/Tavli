import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminPageLayout } from "../AdminPageLayout";
import { DashboardShell } from "./DashboardShell";

describe("DashboardShell", () => {
	it("renders the skeleton and header while loading", () => {
		render(
			<DashboardShell
				isLoading
				error={null}
				entityName="orders"
				header={<nav>filters</nav>}
				skeleton={<div data-testid="skel" />}
			>
				<p>real content</p>
			</DashboardShell>
		);

		expect(screen.getByTestId("skel")).toBeInTheDocument();
		expect(screen.getByText("filters")).toBeInTheDocument();
		expect(screen.queryByText("real content")).not.toBeInTheDocument();
	});

	it("renders the noun-aware title and maps a known backend code to a localized message", () => {
		render(
			<DashboardShell
				isLoading={false}
				error={{
					message:
						"[CONVEX Q(reservations:list)] Server Error Uncaught Error: ERROR_INSUFFICIENT_ROLES at x",
				}}
				entityName="reservations"
				skeleton={<div data-testid="skel" />}
			>
				<p>real content</p>
			</DashboardShell>
		);

		expect(screen.getByText("Could not load reservations.")).toBeInTheDocument();
		expect(screen.getByText("You don't have the required permissions.")).toBeInTheDocument();
		// The raw backend/wrapper text is never shown.
		expect(screen.queryByText(/CONVEX|ERROR_INSUFFICIENT_ROLES/)).not.toBeInTheDocument();
		expect(screen.queryByText("real content")).not.toBeInTheDocument();
	});

	it("falls back to the localized hint for an unknown error message", () => {
		render(
			<DashboardShell
				isLoading={false}
				error={{ message: "Forbidden" }}
				entityName="reservations"
				skeleton={<div />}
			>
				<p>real content</p>
			</DashboardShell>
		);

		expect(screen.getByText("Please check your permissions and try again.")).toBeInTheDocument();
		expect(screen.queryByText("Forbidden")).not.toBeInTheDocument();
	});

	it("falls back to the localized hint when the error has no message", () => {
		render(
			<DashboardShell isLoading={false} error={{}} entityName="payments" skeleton={<div />}>
				<p>real content</p>
			</DashboardShell>
		);

		expect(screen.getByText("Please check your permissions and try again.")).toBeInTheDocument();
	});

	it("renders children when neither loading nor errored", () => {
		render(
			<DashboardShell isLoading={false} error={null} entityName="orders" skeleton={<div />}>
				<p>real content</p>
			</DashboardShell>
		);

		expect(screen.getByText("real content")).toBeInTheDocument();
	});

	it("registers header as admin toolbar when inside AdminPageLayout", () => {
		render(
			<AdminPageLayout>
				<DashboardShell
					isLoading={false}
					error={null}
					entityName="orders"
					header={<nav>filters</nav>}
					skeleton={<div />}
				>
					<p>real content</p>
				</DashboardShell>
			</AdminPageLayout>
		);

		expect(screen.getByText("filters")).toBeInTheDocument();
		expect(screen.getByText("real content")).toBeInTheDocument();
	});
});
