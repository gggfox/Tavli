/**
 * Spend controls for the WhatsApp assistant (TAVLI-91).
 *
 * A valid Twilio signature proves Twilio delivered a message; it proves nothing
 * about whether a real customer sent it. Everything that gets past the signature
 * check runs an LLM turn with tool calls on Tavli's OpenRouter key and can be
 * answered with up to three Twilio messages, all billed to Tavli. The only limit
 * that existed before this module covered *writes*
 * (`WHATSAPP_WRITE_RATE_LIMIT`), which is a data-integrity control, not a
 * spend one.
 *
 * Three controls, in the order the pipeline applies them:
 *
 * 1. **Per-phone daily caps** — 25 inbound, 75 outbound, per phone per 24h. Per
 *    phone IN TOTAL, never per (phone, restaurant): the phone is the thing that
 *    costs money, and a per-restaurant budget would simply multiply by the
 *    number of channels one number can reach.
 * 2. **Platform daily ceiling** — 5,000 inbound a day across every restaurant,
 *    with a warning email to ops at 80%. This is the case the per-phone caps
 *    cannot see: thousands of distinct numbers, each politely under 25.
 * 3. **Admin allowlist** — `whatsappSpendAllowlist` waives (1) for a listed
 *    phone. It waives neither (2) nor either write budget.
 *
 * Two properties are worth stating because they are easy to break later:
 *
 * - **Keys are stable per phone.** `whatsapp_inbound:+528114906208`, with no
 *   date in it. `rateLimits` rows are never deleted and the table is exempt from
 *   the restaurant purge, so a date in the key would add a permanent row per
 *   phone per day. The fixed window in the counter already does the expiring.
 * - **Phones are normalized first.** WhatsApp reports Mexican mobiles with a
 *   legacy 1 (`+5218114906208`), so without `normalizeContactPhone` one human
 *   would hold two budgets and could spend both.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { DatabaseReader } from "../_generated/server";
import { internalAction, internalMutation } from "../_generated/server";
import { parseResendErrorSummary } from "../_shared/integrationLogging";
import { normalizeContactPhone } from "../_util/phone";
import { consumeRateLimit } from "../_util/rateLimit";
import {
	TABLE,
	WHATSAPP_GLOBAL_ALERT_FRACTION,
	WHATSAPP_GLOBAL_ALERT_LIMIT,
	WHATSAPP_GLOBAL_DAILY_LIMIT,
	WHATSAPP_INBOUND_DAILY_LIMIT,
	WHATSAPP_LIMIT_NOTICE_LIMIT,
	WHATSAPP_OUTBOUND_DAILY_LIMIT,
	WHATSAPP_SPEND_ALERT_EMAIL,
} from "../constants";

// ============================================================================
// Keys
// ============================================================================

/** Inbound message budget for one phone. */
export function inboundBudgetKey(phone: string): string {
	return `whatsapp_inbound:${phone}`;
}

/** Outbound message budget for one phone. */
export function outboundBudgetKey(phone: string): string {
	return `whatsapp_outbound:${phone}`;
}

/** "You have hit your cap" notice budget for one phone — one per window. */
export function limitNoticeKey(phone: string): string {
	return `whatsapp_limit_notice:${phone}`;
}

/** The whole platform's daily inbound counter. */
export const GLOBAL_BUDGET_KEY = "whatsapp_global";

/** The ops warning email's own budget, so a runaway cannot become a mail flood. */
export const GLOBAL_ALERT_KEY = "whatsapp_global_alert";

/** Count at which crossing the platform ceiling is still avoidable — 80% of it. */
export function globalAlertThreshold(): number {
	return Math.ceil(WHATSAPP_GLOBAL_DAILY_LIMIT.max * WHATSAPP_GLOBAL_ALERT_FRACTION);
}

/**
 * Canonical form of a phone for every key and allowlist lookup here. Twilio
 * always delivers a `+`-prefixed number, so no restaurant timezone is needed to
 * place it.
 */
function canonical(phone: string): string {
	return normalizeContactPhone(phone, undefined);
}

// ============================================================================
// Allowlist
// ============================================================================

/**
 * Is this phone exempt from the per-phone daily caps?
 *
 * Only those. The hourly write budget and the per-turn write budget still apply
 * to an allowlisted number, deliberately: they protect reservation data, not
 * spend, and a bug that only appears once they bite has to stay reachable from
 * the number the operator tests with.
 */
export async function isSpendAllowlisted(
	ctx: { db: Pick<DatabaseReader, "query"> },
	phone: string
): Promise<boolean> {
	const row = await ctx.db
		.query(TABLE.WHATSAPP_SPEND_ALLOWLIST)
		.withIndex("by_phone", (q) => q.eq("phone", canonical(phone)))
		.first();
	return row !== null;
}

// ============================================================================
// Inbound admission
// ============================================================================

/**
 * Charge one inbound message to the phone's budget — and, if that passes, to the
 * platform's — and report what the pipeline may do with it.
 *
 * Call exactly once per inbound message, whatever the caller then decides: a
 * refused hit does not increment its counter (see `evaluateRateLimit`), so a
 * flood cannot push a window forward by being refused.
 *
 * The caller decides what to do about `allowed` — in particular the confirmation
 * -code path in `processing.ts` ignores it. A code is matched by string
 * comparison before the model runs, costs no LLM spend, and dies in ten minutes
 * if unanswered; refusing one would leave a diner mid-cancellation with a
 * booking that silently was not cancelled, which is the exact failure ADR-011
 * exists to prevent.
 */
export const internalCheckInbound = internalMutation({
	args: { phone: v.string() },
	handler: async (ctx, args): Promise<{ allowed: boolean; globalCeilingReached: boolean }> => {
		const phone = canonical(args.phone);
		const exempt = await isSpendAllowlisted(ctx, phone);

		const phoneBudget = await consumeRateLimit(
			ctx,
			inboundBudgetKey(phone),
			WHATSAPP_INBOUND_DAILY_LIMIT
		);
		// The per-phone cap shields the platform counter, not just the model. If a
		// refused message still charged the global budget, one number that keeps
		// sending past its own cap would burn the 5,000-message ceiling and take
		// every restaurant's assistant down with it — the cap would bound Tavli's
		// LLM spend and cause a platform-wide outage in the same breath.
		if (!exempt && !phoneBudget.allowed) {
			return { allowed: false, globalCeilingReached: false };
		}

		const global = await consumeRateLimit(ctx, GLOBAL_BUDGET_KEY, WHATSAPP_GLOBAL_DAILY_LIMIT);
		if (global.state.count >= globalAlertThreshold()) {
			const alert = await consumeRateLimit(ctx, GLOBAL_ALERT_KEY, WHATSAPP_GLOBAL_ALERT_LIMIT);
			if (alert.allowed) {
				await ctx.scheduler.runAfter(
					0,
					internal.whatsapp.spendControls.sendGlobalCeilingAlertEmail,
					{ count: global.state.count, ceiling: WHATSAPP_GLOBAL_DAILY_LIMIT.max }
				);
			}
		}

		return { allowed: true, globalCeilingReached: !global.allowed };
	},
});

/**
 * Claim the single refusal notice this phone is allowed per window.
 *
 * Separate from {@link internalCheckInbound} so the token is spent only when a
 * notice is actually about to be sent — a customer who is over their cap but
 * redeems a confirmation code got an answer and must not burn it.
 */
export const internalConsumeLimitNotice = internalMutation({
	args: { phone: v.string() },
	handler: async (ctx, args): Promise<{ allowed: boolean }> => {
		const decision = await consumeRateLimit(
			ctx,
			limitNoticeKey(canonical(args.phone)),
			WHATSAPP_LIMIT_NOTICE_LIMIT
		);
		return { allowed: decision.allowed };
	},
});

/**
 * Charge one outbound WhatsApp message to the phone's daily budget.
 *
 * Per message, not per reply: a menu answer split into three parts is three
 * Twilio sends at three times the price. Called from `sendAndRecord` so no send
 * path can skip it.
 */
export const internalConsumeOutbound = internalMutation({
	args: { phone: v.string() },
	handler: async (ctx, args): Promise<{ allowed: boolean }> => {
		const phone = canonical(args.phone);
		if (await isSpendAllowlisted(ctx, phone)) return { allowed: true };

		const decision = await consumeRateLimit(
			ctx,
			outboundBudgetKey(phone),
			WHATSAPP_OUTBOUND_DAILY_LIMIT
		);
		return { allowed: decision.allowed };
	},
});

// ============================================================================
// Ops alert
// ============================================================================

function alertSubject(count: number, ceiling: number): string {
	return `Tavli WhatsApp assistant at ${Math.round((count / ceiling) * 100)}% of its daily ceiling`;
}

function alertText(count: number, ceiling: number): string {
	return [
		`The WhatsApp assistant has processed ${count} inbound messages today, against a daily ceiling of ${ceiling}.`,
		"",
		"At the ceiling every further message is answered with a fixed apology and the model is not called, so spend stops there — but so does the assistant, for every restaurant.",
		"",
		"Worth checking: whether one number is responsible (per-phone caps are 25 inbound / 75 outbound per day), whether traffic is spread across many new numbers, and whether the ceiling now needs raising.",
		"",
		"This alert is sent at most once a day.",
	].join("\n");
}

/**
 * Warn ops that the platform ceiling is close.
 *
 * Fire-and-forget, like the invite and receipt emails: a failed warning must not
 * fail the inbound message that triggered it. Plain text rather than a React
 * Email template — this goes to operators, not customers, and staying in the
 * default Convex runtime keeps it off the `"use node"` path.
 */
export const sendGlobalCeilingAlertEmail = internalAction({
	args: { count: v.number(), ceiling: v.number() },
	handler: async (_ctx, args): Promise<void> => {
		const apiKey = process.env.RESEND_API_KEY;
		const from = process.env.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM;
		if (!apiKey || !from) {
			console.warn(
				"[whatsapp.spendControls] RESEND_API_KEY or RESEND_FROM_ADDRESS missing; skipping ceiling alert.",
				{ count: args.count, ceiling: args.ceiling }
			);
			return;
		}

		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				from,
				to: [WHATSAPP_SPEND_ALERT_EMAIL],
				subject: alertSubject(args.count, args.ceiling),
				text: alertText(args.count, args.ceiling),
			}),
		});

		if (!res.ok) {
			const responseText = await res.text();
			console.error("[whatsapp.spendControls] Resend error:", {
				integration: "resend",
				operation: "sendGlobalCeilingAlertEmail",
				...parseResendErrorSummary(res.status, responseText),
			});
		}
	},
});
