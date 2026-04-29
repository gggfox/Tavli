import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

	it("renders the error state with the noun-aware title and message", () => {
		render(
			<DashboardShell
				isLoading={false}
				error={{ message: "Forbidden" }}
				entityName="reservations"
				skeleton={<div data-testid="skel" />}
			>
				<p>real content</p>
			</DashboardShell>
		);

		expect(screen.getByText("Could not load reservations.")).toBeInTheDocument();
		expect(screen.getByText("Forbidden")).toBeInTheDocument();
		expect(screen.queryByText("real content")).not.toBeInTheDocument();
	});

	it("falls back to the default error description when the error has no message", () => {
		render(
			<DashboardShell
				isLoading={false}
				error={{}}
				entityName="payments"
				skeleton={<div />}
			>
				<p>real content</p>
			</DashboardShell>
		);

		expect(
			screen.getByText("Please check your permissions and try again.")
		).toBeInTheDocument();
	});

	it("renders children when neither loading nor errored", () => {
		render(
			<DashboardShell
				isLoading={false}
				error={null}
				entityName="orders"
				skeleton={<div />}
			>
				<p>real content</p>
			</DashboardShell>
		);

		expect(screen.getByText("real content")).toBeInTheDocument();
	});
});
