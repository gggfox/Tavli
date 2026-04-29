import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
	it("renders a pulsing block aria-hidden by default", () => {
		render(<Skeleton className="h-4 w-12" />);
		const node = document.querySelector("div.animate-pulse");
		expect(node).toBeInTheDocument();
		expect(node).toHaveAttribute("aria-hidden", "true");
	});

	it("respects the requested rounding class", () => {
		render(<Skeleton rounded="full" className="h-4" />);
		const node = document.querySelector("div.animate-pulse");
		expect(node?.className).toContain("rounded-full");
	});
});

describe("Skeleton.Card", () => {
	it("wraps children in a Surface with default tone and rounding", () => {
		render(
			<Skeleton.Card>
				<Skeleton className="h-4 w-12" />
			</Skeleton.Card>
		);
		const node = screen.getByText("", { selector: ".rounded-lg" });
		expect(node).toBeInTheDocument();
		expect(node.style.backgroundColor).toBe("var(--bg-secondary)");
		expect(node.style.border).toBe("1px solid var(--border-default)");
	});
});

describe("Skeleton.Repeat", () => {
	it("renders the child renderer N times with stable keys", () => {
		render(
			<Skeleton.Repeat count={3} keyPrefix="item">
				{(i) => <span data-testid="row">{i}</span>}
			</Skeleton.Repeat>
		);
		const rows = screen.getAllByTestId("row");
		expect(rows).toHaveLength(3);
		expect(rows.map((r) => r.textContent)).toEqual(["0", "1", "2"]);
	});

	it("renders nothing when count is zero", () => {
		render(
			<Skeleton.Repeat count={0} keyPrefix="empty">
				{() => <span data-testid="row" />}
			</Skeleton.Repeat>
		);
		expect(screen.queryAllByTestId("row")).toHaveLength(0);
	});
});
