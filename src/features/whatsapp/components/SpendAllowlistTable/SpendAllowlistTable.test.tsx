/**
 * The admin surface for the WhatsApp spend allowlist (TAVLI-91).
 *
 * What is pinned here is what an operator would notice being wrong: the number
 * they typed is the number that gets sent, a rejected add says why in words
 * rather than leaking a backend code, and a removal actually names the row it
 * removes.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import { useConvexAuth } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpendAllowlistTable } from "./SpendAllowlistTable";

vi.mock("@tanstack/react-query", () => ({
	useMutation: vi.fn(),
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: unknown, args: unknown) => ({ queryKey: ["allowlist"], ref, args }),
	useConvexMutation: (ref: unknown) => ref,
}));

vi.mock("convex/react", () => ({
	useConvexAuth: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-i18next")>();
	return {
		...actual,
		useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
	};
});

type MutationCall = { name: string; args: unknown };

const calls: MutationCall[] = [];
/** What `add` resolves to for the test in hand — a Convex result tuple. */
let addResult: () => unknown = () => ["allowlist-new", null];

const ROW = {
	_id: "allowlist-1",
	_creationTime: 1,
	phone: "+528114906208",
	label: "Tavli operator",
	createdAt: 1700000000000,
	createdBy: "admin-user",
};

function mockRows(rows: unknown[]) {
	vi.mocked(useQuery).mockReturnValue({
		data: rows,
		isLoading: false,
		error: null,
		isError: false,
		refetch: vi.fn(),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any);
}

beforeEach(() => {
	calls.length = 0;
	addResult = () => ["allowlist-new", null];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useConvexAuth).mockReturnValue({ isLoading: false, isAuthenticated: true } as any);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	vi.mocked(useMutation).mockImplementation((options: any) => {
		const name = getFunctionName(options.mutationFn);
		return {
			mutateAsync: async (args: unknown) => {
				calls.push({ name, args });
				return name.endsWith(":add") ? addResult() : [null, null];
			},
			isPending: false,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;
	});
	mockRows([ROW]);
});

function typeInto(label: string, value: string) {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("SpendAllowlistTable", () => {
	it("lists an exempt number with the label that explains it", () => {
		render(<SpendAllowlistTable />);

		expect(screen.getByText("+528114906208")).toBeInTheDocument();
		expect(screen.getByText("Tavli operator")).toBeInTheDocument();
	});

	it("sends the phone and label exactly as typed, and lets the backend canonicalize", async () => {
		render(<SpendAllowlistTable />);

		typeInto("Phone", "+52 1 811 490 6208");
		typeInto("Label", "QA handset");
		fireEvent.click(screen.getByRole("button", { name: "Add to allowlist" }));

		await waitFor(() => expect(calls).toHaveLength(1));
		expect(calls[0].name).toMatch(/whatsappSpendAllowlist:add$/);
		expect(calls[0].args).toEqual({ phone: "+52 1 811 490 6208", label: "QA handset" });
	});

	it("clears the form after a successful add so the next entry starts empty", async () => {
		render(<SpendAllowlistTable />);

		typeInto("Phone", "+14155238886");
		typeInto("Label", "QA handset");
		fireEvent.click(screen.getByRole("button", { name: "Add to allowlist" }));

		await waitFor(() => expect(screen.getByLabelText("Phone")).toHaveValue(""));
		expect(screen.getByLabelText("Label")).toHaveValue("");
	});

	it("shows a localized message when the phone is already exempt", async () => {
		addResult = () => [null, { name: "CONFLICT", message: "ERROR_PHONE_ALREADY_ALLOWLISTED" }];
		render(<SpendAllowlistTable />);

		typeInto("Phone", "+528114906208");
		typeInto("Label", "Operator again");
		fireEvent.click(screen.getByRole("button", { name: "Add to allowlist" }));

		// The raw backend code must never reach the operator; it is mapped to an
		// i18n key, which this test's `t` renders as the key itself.
		await waitFor(() =>
			expect(screen.getByText("errors.ERROR_PHONE_ALREADY_ALLOWLISTED")).toBeInTheDocument()
		);
	});

	it("removes the row it names", async () => {
		render(<SpendAllowlistTable />);

		fireEvent.click(screen.getByRole("button", { name: "Remove Tavli operator" }));

		await waitFor(() => expect(calls).toHaveLength(1));
		expect(calls[0].name).toMatch(/whatsappSpendAllowlist:remove$/);
		expect(calls[0].args).toEqual({ allowlistId: "allowlist-1" });
	});

	it("says what an empty allowlist means rather than showing a bare table", () => {
		mockRows([]);
		render(<SpendAllowlistTable />);

		expect(screen.getByText("No phones are exempt")).toBeInTheDocument();
	});

	it("offers a one-click add for the operator's own number while it is missing", async () => {
		// Otherwise the seed is a CLI incantation someone has to remember, and a
		// fresh deployment silences the person testing after 25 messages.
		mockRows([]);
		render(<SpendAllowlistTable />);

		fireEvent.click(screen.getByRole("button", { name: "Add operator number" }));

		await waitFor(() => expect(calls).toHaveLength(1));
		expect(calls[0].name).toMatch(/whatsappSpendAllowlist:seedOperatorNumber$/);
	});

	it("drops the offer once that number is on the list", () => {
		render(<SpendAllowlistTable />);

		expect(screen.queryByRole("button", { name: "Add operator number" })).not.toBeInTheDocument();
	});
});
