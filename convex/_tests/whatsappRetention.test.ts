import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import {
	WHATSAPP_MESSAGE_RETENTION_MS,
	WHATSAPP_MESSAGE_RETENTION_PURGE_BATCH,
} from "../constants";

/**
 * WhatsApp message retention (TAVLI-95, Mexico LFPDPPP data minimization).
 *
 * Message BODIES age out after the retention period; Conversations stay —
 * they carry the opt-in consent record and are the spine of the staff view.
 * The sweep is batched like `purgeExpiredUnroutedClaims`: index on the
 * timestamp, take a batch, delete, let the next hourly run continue.
 */
const modules = import.meta.glob("../**/*.ts");

async function seedConversation(t: ReturnType<typeof convexTest>): Promise<{
	restaurantId: Id<"restaurants">;
	conversationId: Id<"whatsappConversations">;
}> {
	return await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "WA Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-wa",
			organizationId,
			name: "Vernáculo",
			slug: `wa-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const channelId = await ctx.db.insert("whatsappChannels", {
			restaurantId,
			shortCode: "VRN8F3",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		const at = Date.now();
		const conversationId = await ctx.db.insert("whatsappConversations", {
			channelId,
			restaurantId,
			customerPhone: "+15551230000",
			status: "active",
			lastMessageAt: at,
			lastInboundAt: at,
			createdAt: at,
			updatedAt: at,
		});
		return { restaurantId, conversationId };
	});
}

async function seedMessage(
	t: ReturnType<typeof convexTest>,
	seeded: { restaurantId: Id<"restaurants">; conversationId: Id<"whatsappConversations"> },
	args: { ageMs: number; body?: string }
) {
	await t.run(async (ctx) => {
		await ctx.db.insert("whatsappMessages", {
			conversationId: seeded.conversationId,
			restaurantId: seeded.restaurantId,
			direction: "inbound",
			body: args.body ?? "hola",
			createdAt: Date.now() - args.ageMs,
		});
	});
}

describe("whatsapp message retention", () => {
	it("deletes a message older than the retention period and keeps a younger one", async () => {
		const t = convexTest(schema, modules);
		const seeded = await seedConversation(t);
		await seedMessage(t, seeded, {
			ageMs: WHATSAPP_MESSAGE_RETENTION_MS + 60_000,
			body: "too old",
		});
		await seedMessage(t, seeded, {
			ageMs: WHATSAPP_MESSAGE_RETENTION_MS - 60_000,
			body: "still young",
		});

		const { deleted } = await t.mutation(internal.whatsapp.data.purgeExpiredMessages, {});

		expect(deleted).toBe(1);
		const remaining = await t.run((ctx) => ctx.db.query("whatsappMessages").collect());
		expect(remaining).toHaveLength(1);
		expect(remaining[0].body).toBe("still young");
	});

	it("keeps the conversation — it carries the consent record and the staff view", async () => {
		const t = convexTest(schema, modules);
		const seeded = await seedConversation(t);
		await seedMessage(t, seeded, { ageMs: WHATSAPP_MESSAGE_RETENTION_MS + 60_000 });

		await t.mutation(internal.whatsapp.data.purgeExpiredMessages, {});

		expect(await t.run((ctx) => ctx.db.query("whatsappMessages").collect())).toHaveLength(0);
		expect(await t.run((ctx) => ctx.db.query("whatsappConversations").collect())).toHaveLength(1);
	});

	it("respects the batch cap and finishes on the next run", async () => {
		const t = convexTest(schema, modules);
		const seeded = await seedConversation(t);
		const extra = 5;
		for (let i = 0; i < WHATSAPP_MESSAGE_RETENTION_PURGE_BATCH + extra; i++) {
			await seedMessage(t, seeded, { ageMs: WHATSAPP_MESSAGE_RETENTION_MS + 60_000 + i });
		}

		const first = await t.mutation(internal.whatsapp.data.purgeExpiredMessages, {});
		expect(first.deleted).toBe(WHATSAPP_MESSAGE_RETENTION_PURGE_BATCH);

		const second = await t.mutation(internal.whatsapp.data.purgeExpiredMessages, {});
		expect(second.deleted).toBe(extra);

		expect(await t.run((ctx) => ctx.db.query("whatsappMessages").collect())).toHaveLength(0);
	});
});
