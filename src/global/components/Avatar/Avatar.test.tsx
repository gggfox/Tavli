import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./Avatar";
import { getAvatarFallback } from "./utils";

describe("Avatar", () => {
	it("renders an image when src is provided", () => {
		render(<Avatar src="https://example.com/photo.jpg" alt="User" fallback="U" />);
		const img = screen.getByRole("img");
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute("src", "https://example.com/photo.jpg");
	});

	it("renders fallback initials when src is null", () => {
		render(<Avatar src={null} fallback="JD" alt="John Doe" />);
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
		expect(screen.getByText("JD")).toBeInTheDocument();
	});

	it("renders fallback initials when src is undefined", () => {
		render(<Avatar fallback="AB" alt="User" />);
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
		expect(screen.getByText("AB")).toBeInTheDocument();
	});

	it("sets aria-label on initials fallback", () => {
		render(<Avatar fallback="X" alt="Xavier" />);
		expect(screen.getByLabelText("Xavier")).toBeInTheDocument();
	});
});

describe("getAvatarFallback", () => {
	it("returns uppercase first letter of firstName", () => {
		expect(getAvatarFallback("john", "john@test.com")).toBe("J");
	});

	it("falls back to first letter of email when no firstName", () => {
		expect(getAvatarFallback(null, "alice@test.com")).toBe("A");
	});

	it("falls back to first letter of email when firstName is empty", () => {
		expect(getAvatarFallback("", "bob@test.com")).toBe("B");
	});

	it("returns ? when both are null", () => {
		expect(getAvatarFallback(null, null)).toBe("?");
	});

	it("returns ? when both are undefined", () => {
		expect(getAvatarFallback(undefined, undefined)).toBe("?");
	});
});
