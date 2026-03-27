import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
	it("renders the label text", () => {
		render(
			<StatusBadge
				bgColor="rgba(34, 197, 94, 0.15)"
				textColor="rgb(34, 197, 94)"
				label="Approved"
			/>
		);
		expect(screen.getByText("Approved")).toBeInTheDocument();
	});

	it("applies the correct inline styles", () => {
		render(
			<StatusBadge bgColor="rgba(34, 197, 94, 0.15)" textColor="rgb(34, 197, 94)" label="Active" />
		);
		const badge = screen.getByText("Active");
		expect(badge).toHaveStyle({
			backgroundColor: "rgba(34, 197, 94, 0.15)",
			color: "rgb(34, 197, 94)",
		});
	});

	it("renders without border by default", () => {
		render(<StatusBadge bgColor="rgba(0,0,0,0.1)" textColor="rgb(0,0,0)" label="Default" />);
		const badge = screen.getByText("Default");
		expect(badge.style.borderColor).toBe("");
	});

	it("renders with border when showBorder is true", () => {
		render(
			<StatusBadge
				bgColor="rgba(0,0,0,0.1)"
				textColor="rgb(255, 0, 0)"
				label="Bordered"
				showBorder
			/>
		);
		const badge = screen.getByText("Bordered");
		expect(badge.style.borderColor).toBe("rgba(255, 0, 0, 0.3)");
	});

	it("applies additional className", () => {
		render(
			<StatusBadge
				bgColor="rgba(0,0,0,0.1)"
				textColor="rgb(0,0,0)"
				label="Extra"
				className="my-class"
			/>
		);
		const badge = screen.getByText("Extra");
		expect(badge.className).toContain("my-class");
	});
});
