/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	view: null as any,
	start: vi.fn(async () => [{ jobId: "j1", attempt: 1, remainingThisMonth: 99 }, null]),
	approve: vi.fn(async () => [null, null]),
	reject: vi.fn(async () => [null, null]),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: any) => ({ ref, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: hoisted.view }) }));
vi.mock("convex/_generated/api", () => ({
	api: {
		menuAIImageGen: {
			getItemGeneration: { name: "getItemGeneration" },
			startGeneration: { name: "startGeneration" },
			approveDraft: { name: "approveDraft" },
			rejectDraft: { name: "rejectDraft" },
		},
	},
}));
vi.mock("@/global/hooks", () => ({
	useConvexMutate: (ref: any) => {
		const fn =
			ref.name === "startGeneration"
				? hoisted.start
				: ref.name === "approveDraft"
					? hoisted.approve
					: hoisted.reject;
		return { mutateAsync: fn, isPending: false };
	},
}));

import { AIImageGenerationPanel } from "./AIImageGenerationPanel";

const ITEM = "menuItems:1" as any;

describe("AIImageGenerationPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.view = {
			activeJob: null,
			pendingDraft: null,
			attemptCount: 0,
			remainingThisMonth: 100,
			monthlyLimit: 100,
		};
	});

	it("offers to generate and starts an attempt on click", async () => {
		render(<AIImageGenerationPanel itemId={ITEM} />);
		fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
		await waitFor(() => expect(hoisted.start).toHaveBeenCalledWith({ menuItemId: ITEM }));
	});

	it("shows progress with the attempt number while a job runs", () => {
		hoisted.view = { ...hoisted.view, activeJob: { jobId: "j", status: "running", attempt: 2 } };
		render(<AIImageGenerationPanel itemId={ITEM} />);
		expect(screen.getByText(/generating/i)).toBeTruthy();
		expect(screen.getByText(/attempt 2/i)).toBeTruthy();
		expect(screen.queryByRole("button", { name: /generate with ai/i })).toBeNull();
	});

	it("previews a pending draft with use / generate another / discard", async () => {
		hoisted.view = {
			...hoisted.view,
			attemptCount: 1,
			pendingDraft: { draftId: "d1", imageUrl: "https://x/d1.jpg", attempt: 1, prompt: "p" },
		};
		render(<AIImageGenerationPanel itemId={ITEM} />);
		expect((screen.getByRole("img") as HTMLImageElement).src).toBe("https://x/d1.jpg");

		fireEvent.click(screen.getByRole("button", { name: /use this image/i }));
		await waitFor(() => expect(hoisted.approve).toHaveBeenCalledWith({ draftId: "d1" }));

		fireEvent.click(screen.getByRole("button", { name: /generate another/i }));
		await waitFor(() => expect(hoisted.start).toHaveBeenCalledWith({ menuItemId: ITEM }));

		fireEvent.click(screen.getByRole("button", { name: /discard/i }));
		await waitFor(() => expect(hoisted.reject).toHaveBeenCalledWith({ draftId: "d1" }));
	});

	it("explains a recent failure and offers a retry", () => {
		hoisted.view = {
			...hoisted.view,
			activeJob: { jobId: "j", status: "failed", attempt: 1, error: "credits_exhausted" },
		};
		render(<AIImageGenerationPanel itemId={ITEM} />);
		expect(screen.getByText(/credits are exhausted/i)).toBeTruthy();
		expect(screen.getByRole("button", { name: /generate with ai/i })).toBeTruthy();
	});

	it("shows what is left once it is scarce and disables the button at zero", () => {
		hoisted.view = { ...hoisted.view, remainingThisMonth: 3 };
		const { unmount } = render(<AIImageGenerationPanel itemId={ITEM} />);
		expect(screen.getByText(/3 left this month/i)).toBeTruthy();
		unmount();

		hoisted.view = { ...hoisted.view, remainingThisMonth: 0 };
		render(<AIImageGenerationPanel itemId={ITEM} />);
		expect(
			(screen.getByRole("button", { name: /generate with ai/i }) as HTMLButtonElement).disabled
		).toBe(true);
	});

	it("says generation is switched off when the limit is zero", () => {
		hoisted.view = { ...hoisted.view, remainingThisMonth: 0, monthlyLimit: 0 };
		render(<AIImageGenerationPanel itemId={ITEM} />);
		expect(screen.getByText(/switched off/i)).toBeTruthy();
	});
});
