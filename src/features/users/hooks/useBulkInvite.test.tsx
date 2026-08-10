/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The chunked commit.
 *
 * `commitBulkInvitations` refuses more than `INVITE_BULK_COMMIT_MAX_ROWS` per
 * call, so a full-size upload is several transactions that must be tied
 * together by one `bulkImportId` — otherwise the audit trail says several
 * unrelated runs happened. And when a chunk fails, the invitations the earlier
 * chunks already sent are real: the report has to carry them, not reset to an
 * error screen.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Id } from "convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	commitMock: vi.fn(
		async (_args: any) => [{ bulkImportId: "bulk-1", results: [], counts: {} }, null] as any
	),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (ref: any, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
	useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
	useConvexAction: () => vi.fn(),
	useConvexMutation: (ref: any) =>
		getFunctionName(ref).includes("commitBulkInvitations") ? hoisted.commitMock : vi.fn(),
}));

import { useBulkInvite, type BulkInviteSubmission } from "./useBulkInvite";

const ORG = "organizations:a" as Id<"organizations">;

function submissions(count: number): BulkInviteSubmission[] {
	return Array.from({ length: count }, (_, index) => ({
		rowNumber: index + 1,
		email: `person${index + 1}@example.com`,
		role: "owner" as const,
		organizationId: ORG,
		restaurantIds: [],
	}));
}

function createdResults(rows: BulkInviteSubmission[]) {
	return rows.map((row) => ({
		rowNumber: row.rowNumber,
		email: row.email,
		outcome: "created" as const,
		status: "ok",
		code: null,
		invitationId: `invitations:${row.rowNumber}`,
	}));
}

beforeEach(() => {
	hoisted.commitMock = vi.fn(async (args: any) => [
		{
			bulkImportId: args.bulkImportId ?? "bulk-generated",
			results: createdResults(args.rows),
			counts: { requested: args.rows.length, created: args.rows.length, skipped: 0, failed: 0 },
		},
		null,
	]);
});

describe("useBulkInvite — chunked commit", () => {
	it("splits a 250-row run into chunks of 100 under one bulk import id", async () => {
		const { result } = renderHook(() => useBulkInvite());

		await act(async () => {
			await result.current.commit(submissions(250));
		});

		await waitFor(() => expect(result.current.step).toBe("report"));

		expect(hoisted.commitMock).toHaveBeenCalledTimes(3);
		expect(hoisted.commitMock.mock.calls.map(([args]) => args.rows.length)).toEqual([100, 100, 50]);
		// The first call lets the server mint the id; every later one reuses it.
		expect(hoisted.commitMock.mock.calls[0][0].bulkImportId).toBeUndefined();
		expect(hoisted.commitMock.mock.calls[1][0].bulkImportId).toBe("bulk-generated");
		expect(hoisted.commitMock.mock.calls[2][0].bulkImportId).toBe("bulk-generated");

		expect(result.current.report?.counts).toEqual({
			requested: 250,
			created: 250,
			skipped: 0,
			failed: 0,
		});
		expect(result.current.report?.results).toHaveLength(250);
		expect(result.current.report?.stoppedEarly).toBeNull();
	});

	it("keeps the first chunk's invitations when the second one fails", async () => {
		hoisted.commitMock = vi
			.fn()
			.mockImplementationOnce(async (args: any) => [
				{
					bulkImportId: "bulk-1",
					results: createdResults(args.rows),
					counts: { requested: args.rows.length, created: args.rows.length, skipped: 0, failed: 0 },
				},
				null,
			])
			.mockImplementationOnce(async () => [
				null,
				{ name: "RATE_LIMITED", message: "ERROR_INVITE_RATE_LIMITED" },
			]);

		const { result } = renderHook(() => useBulkInvite());

		await act(async () => {
			await result.current.commit(submissions(150));
		});

		await waitFor(() => expect(result.current.step).toBe("report"));

		expect(hoisted.commitMock).toHaveBeenCalledTimes(2);
		// 100 real invitations went out; the report must not pretend otherwise.
		expect(result.current.report?.results).toHaveLength(100);
		expect(result.current.report?.counts.created).toBe(100);
		expect(result.current.report?.requestedTotal).toBe(150);
		expect(result.current.report?.stoppedEarly).toEqual({
			code: "ERROR_INVITE_RATE_LIMITED",
			detail: null,
		});
	});

	it("does nothing at all when no row was accepted", async () => {
		const { result } = renderHook(() => useBulkInvite());

		await act(async () => {
			await result.current.commit([]);
		});

		expect(hoisted.commitMock).not.toHaveBeenCalled();
		expect(result.current.step).toBe("idle");
		expect(result.current.report).toBeNull();
	});
});
