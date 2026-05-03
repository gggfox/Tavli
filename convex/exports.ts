import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { TABLE } from "./constants";

function csvEscape(cell: string): string {
	if (/[",\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
	return cell;
}

function toCsv(headers: string[], rows: string[][]): string {
	const lines = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
	return `${lines.join("\n")}\n`;
}

export const exportAttendanceCsv = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const events = await ctx.runQuery(internal.attendance.internalListClockEventsForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
			fromMs: args.fromMs,
			toMs: args.toMs,
		});

		const rows = events.map((e: { _id: string; memberId: string; type: string; at: number }) => [
			e._id,
			e.memberId,
			e.type,
			String(e.at),
		]);
		return toCsv(["id", "memberId", "type", "atMs"], rows);
	},
});

export const exportShiftsCsv = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const shifts = await ctx.runQuery(internal.shifts.internalListShiftsForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
			fromMs: args.fromMs,
			toMs: args.toMs,
		});

		const rows = shifts.map(
			(s: { _id: string; memberId: string; startsAt: number; endsAt: number; status: string }) => [
				s._id,
				s.memberId,
				String(s.startsAt),
				String(s.endsAt),
				s.status,
			]
		);
		return toCsv(["id", "memberId", "startsAt", "endsAt", "status"], rows);
	},
});

export const exportTipsCsv = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromBusinessDate: v.optional(v.string()),
		toBusinessDate: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const entries = await ctx.runQuery(internal.tips.internalListTipEntriesForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
			fromBusinessDate: args.fromBusinessDate,
			toBusinessDate: args.toBusinessDate,
		});

		const rows = entries.map(
			(e: {
				_id: string;
				businessDate: string;
				source: string;
				amountCents: number;
				memberId?: string;
				notes?: string;
			}) => [
				e._id,
				e.businessDate,
				e.source,
				String(e.amountCents),
				e.memberId ?? "",
				e.notes ?? "",
			]
		);
		return toCsv(["id", "businessDate", "source", "amountCents", "memberId", "notes"], rows);
	},
});

export const exportAbsencesCsv = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromDate: v.optional(v.string()),
		toDate: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const rowsDoc = await ctx.runQuery(internal.attendance.internalListAbsencesForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
			fromDate: args.fromDate,
			toDate: args.toDate,
		});

		const rows = rowsDoc.map(
			(r: {
				_id: string;
				memberId: string;
				date: string;
				type: string;
				status: string;
				reason?: string;
			}) => [r._id, r.memberId, r.date, r.type, r.status, r.reason ?? ""]
		);
		return toCsv(["id", "memberId", "date", "type", "status", "reason"], rows);
	},
});
