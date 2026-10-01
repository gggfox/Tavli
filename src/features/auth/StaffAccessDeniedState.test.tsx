/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The staff gate in front of `/admin` and `/dashboard`.
 *
 * The case worth pinning is the signed-out one: it used to be a grey
 * "Access Denied" line with nowhere to go, which is what a manager opening a
 * bookmarked admin link on a fresh device saw.
 */
import { i18n } from "@/global/i18n";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ isSignedIn: false as boolean | undefined }));

vi.mock("@clerk/tanstack-react-start", () => ({
	useAuth: () => ({ isSignedIn: hoisted.isSignedIn }),
	SignInButton: ({ children, mode }: any) => <div data-sign-in-mode={mode}>{children}</div>,
}));

import { StaffAccessDeniedState } from "./StaffAccessDeniedState";

describe("StaffAccessDeniedState", () => {
	beforeEach(async () => {
		await i18n.changeLanguage("en");
	});

	it("offers a signed-out visitor a way in instead of a dead end", () => {
		hoisted.isSignedIn = false;
		const { container } = render(<StaffAccessDeniedState />);

		expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
		// Redirect mode brings them back to the page they asked for.
		expect(container.querySelector("[data-sign-in-mode]")?.getAttribute("data-sign-in-mode")).toBe(
			"redirect"
		);
		expect(screen.queryByText("Access denied")).not.toBeInTheDocument();
	});

	it("tells a signed-in visitor without a staff role that access is denied", () => {
		hoisted.isSignedIn = true;
		render(<StaffAccessDeniedState />);

		expect(screen.getByText("Access denied")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
	});

	it("speaks Spanish when the app does", async () => {
		hoisted.isSignedIn = false;
		await i18n.changeLanguage("es");
		render(<StaffAccessDeniedState />);

		expect(screen.getByText("Inicia sesión para continuar")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
	});
});
