"use node";

/**
 * Inbound WhatsApp processing pipeline (Milestone 2: menu Q&A).
 *
 * Scheduled by the `/whatsapp/inbound` HTTP route after the signature is
 * verified, so it runs off the request path — Twilio's ~15s webhook timeout does
 * not bound the LLM turn. Node action because the AI SDK provider (`llm.ts`)
 * runs under `"use node"`.
 *
 * Flow: dedupe on MessageSid → consent (opt-out state and STOP/START keywords)
 * → resolve the restaurant → record inbound → charge the spend budgets →
 * redeem a confirmation code if the body carries one → otherwise run the LLM
 * turn → send the reply (model prose plus server-composed fact lines) → record
 * outbound. Any failure sends a fixed localized apology — never a silent
 * failure (AC #6).
 *
 * **Gate order (TAVLI-95), and why it is this order:**
 *   1. Twilio signature (`http.ts`) — nothing unverified gets further.
 *   2. Opt-out state and opt-out/opt-in keywords — cheapest, and a policy
 *      duty: an opted-out phone must cost nothing and receive nothing, so it
 *      sits above every budget and every reply. What sits above the budgets is
 *      the *drop* and the recording of the revocation, never a send: the
 *      confirmation a transition earns is a billed Twilio message and is
 *      metered like any other (`confirmConsentTransition`).
 *   3. Confirmation codes — authorizing a cancellation must not depend on the
 *      model, and must survive the refusals below it.
 *   4. Routing.
 *   5. Restaurant status (deleted / inactive) — a dead restaurant answers
 *      honestly instead of chatting.
 *   6. Subscription gate — a lapsed restaurant must not spend Tavli's money on
 *      model turns.
 *   7. Spend budgets, then the model.
 *
 * **Routing (ADR 012).** Tavli is the sender on one shared number, so the
 * Twilio "To" identifies nobody. The restaurant comes from the short code in
 * the wa.me deep-link text; failing that, from this phone's own recent history,
 * but only when that history names exactly one restaurant; failing that, from a
 * live confirmation code Tavli minted for this exact phone, so the second
 * message ADR 011 requires to authorize a cancellation can still land. Anything
 * else gets a fixed reply with no model call — Tavli deliberately does NOT try
 * to match a restaurant name the diner typed against every restaurant it knows,
 * because that is an enumeration and spoofing surface.
 *
 * The confirmation-code check deliberately sits BEFORE the LLM: authorizing a
 * cancellation must not depend on the model reading intent correctly. It sits
 * before the spend refusals for the same reason — see `spendControls.ts`.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { buildIntegrationErrorLog } from "../_shared/integrationLogging";
import {
	WHATSAPP_COLD_START_WINDOW_MS,
	WHATSAPP_CONFIRMATION_CODE_DIGITS,
	WHATSAPP_CONTEXT_MESSAGE_LIMIT,
	WHATSAPP_MAX_OUTBOUND_BODY_CHARS,
	WHATSAPP_MAX_REPLY_PARTS,
	WHATSAPP_MESSAGE_SENDER,
	WHATSAPP_OPT_IN_SOURCE,
	type WhatsappMessageSender,
	type WhatsappOptInSource,
} from "../constants";
import {
	getBotCopy,
	getOptInConfirmation,
	getOptOutConfirmation,
	getUnroutableGuidance,
	resolveLocale,
} from "./copy";
import { formatLocalDateTime } from "./datetime";
import { splitOutboundBody } from "./format";
import { runBotTurn } from "./llm";
import { OPT_KEYWORD, matchOptKeyword } from "./optOut";
import { sendWhatsappMessage } from "./outbound";
import { normalizePhone, toCanonicalE164 } from "./phone";
import { extractShortCodeCandidates, stripShortCode } from "./shortCode";

/**
 * Pull a confirmation code out of a raw inbound body.
 *
 * Accepts a bare code, or one with surrounding words, so "CANCEL 481920",
 * "481920" and "el código es 481920" all work — customers do not follow
 * instructions precisely. Requires the exact digit count so a party size ("4")
 * or a phone number is never mistaken for a code.
 */
export function extractConfirmationCode(body: string): string | null {
	const matches = body.match(
		new RegExp(`(?<!\\d)\\d{${WHATSAPP_CONFIRMATION_CODE_DIGITS}}(?!\\d)`, "g")
	);
	// Exactly one candidate, or we cannot tell which was meant.
	return matches?.length === 1 ? matches[0] : null;
}

/**
 * Send a reply and record it, clamped, with delivery failure marked.
 *
 * Every outbound path goes through here so the clamp and the `deliveryFailedAt`
 * bookkeeping can't be forgotten on a new branch — the reason the assistant used
 * to insist it had already sent a menu it never delivered.
 */
async function sendAndRecord(
	ctx: ActionCtx,
	args: {
		conversationId: Id<"whatsappConversations">;
		restaurantId: Id<"restaurants">;
		to: string;
		/**
		 * Canonical E.164 identity of the customer, for the outbound spend budget.
		 * Deliberately not derived from `to`: that is a transport address, and for
		 * a Mexican mobile the two spellings differ by WhatsApp's legacy 1.
		 */
		phone: string;
		body: string;
		/** The model's own prose, without the appended notices. "" = none. */
		modelBody: string;
		/**
		 * Who is speaking. Applies to the whole reply, every part of it — a long
		 * assistant answer split across three WhatsApp messages is one utterance
		 * by the assistant, even though only the first part keeps `modelBody`.
		 */
		sentBy: WhatsappMessageSender;
		mediaUrl?: string;
	}
): Promise<void> {
	// Consent, checked structurally at the point of send — not only at the top
	// of the inbound path — so no future caller (a staff reply, a scheduled
	// notice) can message an opted-out phone by forgetting to ask. Same
	// reasoning as the budget check in the loop below: make the forbidden send
	// unproducible instead of relying on callers to remember.
	const consent = await ctx.runQuery(internal.whatsapp.data.getOptOutState, {
		phone: args.phone,
	});
	if (consent.optedOut) {
		console.warn("[whatsapp.processing] dropping reply to an opted-out phone.", {
			conversationId: args.conversationId,
		});
		return;
	}

	// A reply longer than one WhatsApp message becomes several, in order. Any
	// media rides on the first part only — repeating it would send the customer
	// the same dish photo once per chunk.
	const parts = splitOutboundBody(
		args.body,
		WHATSAPP_MAX_OUTBOUND_BODY_CHARS,
		WHATSAPP_MAX_REPLY_PARTS
	);
	for (const [index, body] of parts.entries()) {
		// Charged per part, because each part is its own billed Twilio message.
		// Checked here so no send path can be added that skips the budget.
		const budget = await ctx.runMutation(internal.whatsapp.spendControls.internalConsumeOutbound, {
			phone: args.phone,
		});
		if (!budget.allowed) {
			console.warn("[whatsapp.processing] outbound daily budget exhausted; dropping reply part.", {
				conversationId: args.conversationId,
				partIndex: index,
			});
			break;
		}
		const mediaUrl = index === 0 ? args.mediaUrl : undefined;
		// Only the first part carries the model's prose: the notices are appended
		// after it, so every later part is server-composed by construction.
		const modelBody = index === 0 ? args.modelBody : "";
		const sid = await sendWhatsappMessage({ to: args.to, body, mediaUrl });
		await ctx.runMutation(internal.whatsapp.data.recordOutbound, {
			conversationId: args.conversationId,
			restaurantId: args.restaurantId,
			body,
			modelBody,
			sentBy: args.sentBy,
			mediaUrl,
			messageSid: sid,
			// `sendWhatsappMessage` never throws; a missing SID is how it reports failure.
			deliveryFailedAt: sid ? undefined : Date.now(),
		});
		// A failed part means the rest will fail too (bad number, closed window);
		// stop rather than logging three identical failures.
		if (!sid) break;
	}
}

/**
 * Send the single confirmation a consent transition earns — metered, like every
 * other reply Tavli pays for.
 *
 * The transition itself is never gated on this: `recordOptOut` has already run
 * unconditionally by the time this is called, because honoring a STOP is a
 * policy duty. What is gated is the *message*, and only the message.
 *
 * It has to be. A consent confirmation is a billed Twilio send to a number that
 * has proved nothing beyond a valid Twilio signature — which "proves nothing
 * about whether a real customer sent it" (`spendControls.ts`) — on one shared
 * number anyone in the world can write to (ADR 012). Unmetered, alternating
 * STOP and START would be one free send per inbound message, forever, from any
 * phone: the same open relay `getUnroutableGuidance` is metered to prevent.
 *
 * Two gates, and deliberately not a third:
 *
 * - **The platform ceiling.** During a spend emergency that has already shut off
 *   every model turn and every reply platform-wide, a fixed confirmation to a
 *   stranger is not the exception.
 * - **The phone's outbound cap.** 75 sends a day is an absolute brake on what
 *   one number can cost, whatever it says.
 * - **NOT the phone's inbound cap.** That one reads like a third brake and is
 *   not one, because the alternation it looks like it bounds is already bounded
 *   above it: an opt-out confirmation is only ever earned by a transition
 *   (`recordOptOut` returns `transitioned: false` when the row exists), so a
 *   second one requires an opt-in first — and the opt-in branch refuses outright
 *   once the inbound cap is spent. Past the cap a phone can therefore buy at
 *   most ONE more confirmation and then stays opted out. Adding the condition
 *   here bounds nothing further; it only silences the STOP of the person 25
 *   messages deep — precisely the one most likely to send it, and the one the
 *   policy most needs to reach with how to come back.
 *
 * Deliberately NOT routed through `sendAndRecord`: there is no conversation and
 * no restaurant to record a consent message against — opting out is opting out
 * of the NUMBER, across every restaurant it reaches.
 */
async function confirmConsentTransition(
	ctx: ActionCtx,
	args: {
		/** Canonical E.164 identity, for the budgets. Not the transport address. */
		phone: string;
		to: string;
		body: string;
		/**
		 * Whether the message that caused this transition found the platform past
		 * its daily ceiling. Only that half of the inbound verdict: see above for
		 * why `allowed` is deliberately not consulted.
		 */
		globalCeilingReached: boolean;
	}
): Promise<void> {
	if (args.globalCeilingReached) {
		console.warn("[whatsapp.processing] past the platform ceiling; consent reply dropped.");
		return;
	}
	const budget = await ctx.runMutation(internal.whatsapp.spendControls.internalConsumeOutbound, {
		phone: args.phone,
	});
	if (!budget.allowed) {
		console.warn("[whatsapp.processing] outbound daily budget exhausted; consent reply dropped.");
		return;
	}
	await sendWhatsappMessage({ to: args.to, body: args.body });
}

/**
 * Which restaurant this message is for, and the body with the routing token
 * removed.
 *
 * Three inputs, in order, and no fourth. The short code in the deep-link text is
 * the primary route. Its absence falls back to this phone's own recent history,
 * and only when that history names exactly one enabled restaurant — two
 * restaurants is genuinely ambiguous, and picking the most recent would silently
 * send a diner's question to the wrong kitchen. Last, and only for a message
 * that is a confirmation code, a code Tavli itself minted for this exact phone —
 * see `getRouteByPendingCode` for why that is not a fourth general input.
 */
async function resolveRoute(
	ctx: ActionCtx,
	args: { body: string; customerPhone: string }
): Promise<{
	restaurantId: Id<"restaurants">;
	channelId: Id<"whatsappChannels">;
	defaultLocale?: string;
	body: string;
	/**
	 * The consent provenance `ingestInbound` stamps if this message creates the
	 * conversation: a short code means the diner came through the wa.me deep
	 * link; everything else is a cold start.
	 */
	optInSource: WhatsappOptInSource;
} | null> {
	const candidates = extractShortCodeCandidates(args.body);
	if (candidates.length > 0) {
		const match = await ctx.runQuery(internal.whatsapp.data.getEnabledChannelByShortCode, {
			candidates,
		});
		if (match) {
			return {
				restaurantId: match.channel.restaurantId,
				channelId: match.channel._id,
				defaultLocale: match.channel.defaultLocale,
				// Stripped only now that the token has actually resolved: a word that
				// merely looked like a code stays in the diner's own words.
				body: stripShortCode(args.body, match.matchedCode),
				optInSource: WHATSAPP_OPT_IN_SOURCE.DEEP_LINK,
			};
		}
		// An unrecognized code is not an error the diner can act on — fall through
		// to the same cold-start path a codeless message takes.
	}

	const routes = await ctx.runQuery(internal.whatsapp.data.getRecentRoutesForPhone, {
		customerPhone: args.customerPhone,
		sinceMs: Date.now() - WHATSAPP_COLD_START_WINDOW_MS,
	});
	if (routes.length === 1) {
		return { ...routes[0], body: args.body, optInSource: WHATSAPP_OPT_IN_SOURCE.COLD_START };
	}

	// Ambiguous history, or none. Before giving up: is this the confirmation
	// code the assistant asked for? Its copy says "reply with this code: 481920"
	// — six bare digits, no short code — so for a diner who has talked to two
	// restaurants that reply lands here, and dropping it would mean the
	// cancellation they were told to confirm silently never happens.
	const code = extractConfirmationCode(args.body);
	if (code) {
		const route = await ctx.runQuery(internal.whatsapp.data.getRouteByPendingCode, {
			customerPhone: args.customerPhone,
			code,
		});
		if (route) return { ...route, body: args.body, optInSource: WHATSAPP_OPT_IN_SOURCE.COLD_START };
	}
	return null;
}

export const handleInboundMessage = internalAction({
	args: {
		messageSid: v.string(),
		from: v.string(),
		body: v.string(),
		profileName: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		// Fast-path dedupe: Twilio retries deliver the same MessageSid.
		const existing = await ctx.runQuery(internal.whatsapp.data.getMessageBySid, {
			messageSid: args.messageSid,
		});
		if (existing) return;

		// Two different things, deliberately kept apart. `replyAddress` is the
		// transport address Twilio used and is the only thing safe to send to;
		// `customerPhone` is the canonical E.164 identity everything else keys on
		// (see `toCanonicalE164` — WhatsApp's Mexican mobiles carry a legacy 1 that
		// would otherwise fork one human into two customers).
		const replyAddress = normalizePhone(args.from);
		const customerPhone = toCanonicalE164(args.from);

		// Consent, directly after the signature (WhatsApp Business Messaging
		// Policy) and deliberately ABOVE routing and the spend budgets: an
		// opted-out phone must cost nothing and receive nothing, and honoring a
		// STOP is a policy duty, not a discretionary spend. The transitions are
		// matched like `extractConfirmationCode` — deterministically, before any
		// model — because consent must never be a language-understanding problem.
		//
		// Tracks whether this branch already claimed the MessageSid, so the
		// unroutable branch below doesn't mistake its own claim for a redelivery.
		let sidClaimedByConsentGate = false;
		const optKeyword = matchOptKeyword(args.body);
		if (optKeyword === OPT_KEYWORD.OPT_OUT) {
			// The revocation itself is written unconditionally, above every budget:
			// honoring a STOP is a policy duty, not a discretionary spend. Nothing
			// below may refuse it.
			const { transitioned } = await ctx.runMutation(internal.whatsapp.data.recordOptOut, {
				phone: customerPhone,
				messageSid: args.messageSid,
			});
			// Repeating STOP while already opted out (or a Twilio redelivery of this
			// one) writes nothing, sends nothing and charges nothing: replying to a
			// phone that asked for silence is the exact thing being switched off.
			if (!transitioned) return;
			// A transition is an inbound message that ends here having written
			// permanent state and earned a billed reply, so it is charged like any
			// other — see `confirmConsentTransition` for why that matters.
			const inbound = await ctx.runMutation(internal.whatsapp.spendControls.internalCheckInbound, {
				phone: customerPhone,
			});
			// The transition earns the ONE confirmation the policy expects — it must
			// say how to come back, and it is owed even to a phone that has spent
			// its inbound cap, which is the phone most likely to be sending STOP.
			// Unrecorded, like the unroutable guidance: this send belongs to no
			// restaurant.
			await confirmConsentTransition(ctx, {
				phone: customerPhone,
				to: replyAddress,
				body: getOptOutConfirmation(),
				globalCeilingReached: inbound.globalCeilingReached,
			});
			return;
		}
		if (optKeyword === OPT_KEYWORD.OPT_IN) {
			// Claimed first: an opt-in transition stores no `whatsappMessages` row,
			// so without this a Twilio redelivery of the same START would fall
			// through below as an ordinary message and reach the model.
			const { claimed } = await ctx.runMutation(internal.whatsapp.data.claimUnroutedMessage, {
				messageSid: args.messageSid,
			});
			if (!claimed) return;
			// Read before writing, because the two outcomes are charged differently:
			// a transition ends here and pays for itself, while "START" from a phone
			// that never opted out is an ordinary message and is charged below, after
			// `ingestInbound` — the authoritative dedupe. Charging both here would
			// bill that second case twice.
			const { optedOut } = await ctx.runQuery(internal.whatsapp.data.getOptOutState, {
				phone: customerPhone,
			});
			if (optedOut) {
				const inbound = await ctx.runMutation(
					internal.whatsapp.spendControls.internalCheckInbound,
					{ phone: customerPhone }
				);
				// Unlike a STOP, an opt-in IS refusable, and refusing it is the only
				// thing that bounds STOP, START, STOP, START…: every transition writes
				// a permanent `allEvents` row (append-only, no purge path, exempt from
				// the restaurant purge) and a fresh unrouted claim, so an unbounded
				// alternation grows tables nothing ever reclaims. Leaving the phone
				// opted out is the silent direction and costs Tavli nothing; honoring
				// the revocation is the policy duty, guaranteeing an immediate
				// re-subscription to a phone that has already spent its whole daily
				// inbound cap is not. The window rolls in a day.
				if (!inbound.allowed) {
					console.warn("[whatsapp.processing] inbound daily budget exhausted; deferring opt-in.");
					return;
				}
				const { transitioned } = await ctx.runMutation(internal.whatsapp.data.recordOptIn, {
					phone: customerPhone,
					messageSid: args.messageSid,
				});
				// One confirmation, and nothing else processed from this message.
				if (transitioned) {
					await confirmConsentTransition(ctx, {
						phone: customerPhone,
						to: replyAddress,
						body: getOptInConfirmation(),
						globalCeilingReached: inbound.globalCeilingReached,
					});
				}
				return;
			}
			// Never opted out: "START"/"ALTA" is just a message — process normally.
			sidClaimedByConsentGate = true;
		} else {
			const { optedOut } = await ctx.runQuery(internal.whatsapp.data.getOptOutState, {
				phone: customerPhone,
			});
			// Permanent silence: dropped before any budget, routing, or model work.
			if (optedOut) return;
		}

		const route = await resolveRoute(ctx, { body: args.body, customerPhone });
		if (!route) {
			// Nothing to attach this to — no restaurant means no conversation and no
			// row to record against, so this send is deliberately unlogged. It is a
			// fixed string and NOT a model call: an unroutable message is exactly the
			// case where there is no menu, no restaurant name and no locale to ground
			// a model in, and spending a turn guessing is how a first responder
			// starts inventing restaurants.
			//
			// Claimed BEFORE anything is charged or sent. Unlogged also means
			// undeduped: the fast path above reads the `whatsappMessages` row this
			// branch never writes, so without a claim every Twilio redelivery of
			// this MessageSid is another billed message to a stranger and another
			// permanent counter increment.
			//
			// The consent gate may already hold this SID's claim (a "START" from a
			// phone that was never opted out) — that is this same delivery, not a
			// redelivery.
			if (!sidClaimedByConsentGate) {
				const { claimed } = await ctx.runMutation(internal.whatsapp.data.claimUnroutedMessage, {
					messageSid: args.messageSid,
				});
				if (!claimed) return;
			}

			// Replying to a stranger still costs money, and on one shared number an
			// unroutable message can come from anyone at all (ADR 012) — an unmetered
			// fixed reply to every one of them is an open relay on Tavli's own Twilio
			// account. So the guidance is metered like any other reply.
			//
			// Over budget, or past the platform ceiling: silence, not a notice.
			// There is no conversation to record one against and no relationship to
			// preserve with a number that has no restaurant, and answering a flood
			// is paying for it.
			const strangerBudget = await ctx.runMutation(
				internal.whatsapp.spendControls.internalCheckInbound,
				{ phone: customerPhone }
			);
			if (strangerBudget.allowed && !strangerBudget.globalCeilingReached) {
				await sendWhatsappMessage({ to: replyAddress, body: getUnroutableGuidance() });
			}
			return;
		}

		const {
			conversationId,
			locale: conversationLocale,
			isDuplicate,
		} = await ctx.runMutation(internal.whatsapp.data.ingestInbound, {
			channelId: route.channelId,
			restaurantId: route.restaurantId,
			customerPhone,
			body: route.body,
			messageSid: args.messageSid,
			profileName: args.profileName,
			optInSource: route.optInSource,
		});
		if (isDuplicate) return;

		// Charged after `ingestInbound`, which is the authoritative dedupe — the
		// fast path above can miss a redelivery that arrives while the first
		// delivery is still in flight. Charging ahead of it would bill that race
		// twice for one customer message. Every branch below still charges exactly
		// once, and a refused hit does not increment its counter.
		const budget = await ctx.runMutation(internal.whatsapp.spendControls.internalCheckInbound, {
			phone: customerPhone,
		});

		const restaurant = await ctx.runQuery(internal.whatsapp.data.getRestaurantContext, {
			restaurantId: route.restaurantId,
		});
		const locale = resolveLocale(
			conversationLocale,
			route.defaultLocale,
			restaurant?.defaultLanguage
		);

		// Confirmation codes are matched HERE, before the model is involved at all.
		// The authorization decision for a destructive action is therefore a string
		// comparison against a server-generated, single-use, expiring value — not a
		// language-understanding problem. Injected text (forwarded messages, a
		// poisoned menu description, an instruction stored in history) can steer one
		// turn's tool calls, but none of it can produce this second inbound message.
		const code = extractConfirmationCode(route.body);
		if (code) {
			const outcome = await ctx.runMutation(
				internal.whatsapp.reservations.internalConsumeCancelCode,
				{ conversationId, phone: customerPhone, code }
			);
			const applied = outcome.cancelled || outcome.rescheduled;
			if (applied || outcome.reason !== "ERROR_CODE_NOT_FOUND") {
				const copy = getBotCopy(locale);
				const when = (ms: number) =>
					formatLocalDateTime(ms, restaurant?.timezone ?? undefined, locale);
				let body: string;
				if (outcome.rescheduled) {
					body = copy.rescheduleConfirmed(when(outcome.startsAt));
				} else if (outcome.cancelled) {
					body = copy.cancelConfirmed(when(outcome.startsAt));
				} else if (outcome.kind === "reschedule") {
					// The code was good; the slot went while it was outstanding. Say
					// exactly that, because "invalid code" would send the customer round
					// the loop again for a booking that never changed.
					body = copy.rescheduleNoLongerAvailable;
				} else {
					body = copy.cancelCodeInvalid;
				}
				await sendAndRecord(ctx, {
					conversationId,
					restaurantId: route.restaurantId,
					to: replyAddress,
					phone: customerPhone,
					body,
					// Entirely server-composed: the model was never consulted for the
					// authorization decision and must not be shown this as its own line.
					modelBody: "",
					sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM,
				});
				return;
			}
			// Not one of our codes — fall through and let the model answer normally,
			// since a bare number is just as likely to be a party size.
			//
			// Note this is also why the spend refusals below must not be skipped for
			// every code-shaped message: "481920" would otherwise be an unlimited
			// free pass to the model. Only a code we actually minted returns above.
		}

		// Restaurant status: a soft-deleted or deactivated restaurant no longer
		// speaks — not even to greet. Routing already refuses to bind NEW traffic
		// to a dead restaurant (see `data.ts`); this is the backstop for a thread
		// that outlived its restaurant, so the answer is honest fixed copy rather
		// than an assistant cheerfully taking questions for a business that is
		// gone. Below the confirmation codes on purpose: cancelling a booking at
		// a just-deleted restaurant is the one thing still worth doing there.
		// Metered like any reply.
		if (!restaurant || restaurant.unavailable) {
			await sendAndRecord(ctx, {
				conversationId,
				restaurantId: route.restaurantId,
				to: replyAddress,
				phone: customerPhone,
				body: getBotCopy(locale).restaurantUnavailable,
				modelBody: "",
				sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM,
			});
			return;
		}

		// Subscription gate: an enrolled restaurant whose platform subscription
		// has lapsed must not keep spending Tavli's money on model turns — the
		// billing semantics live in `getRestaurantContext` /
		// `isBillingInGoodStanding`, not here. Fixed copy through the normal
		// metered path (the spend budgets in `sendAndRecord` still apply): never
		// silence, because the diner did nothing wrong, and never a model call,
		// because the model call is the thing not being paid for.
		if (restaurant.subscriptionLapsed) {
			await sendAndRecord(ctx, {
				conversationId,
				restaurantId: route.restaurantId,
				to: replyAddress,
				phone: customerPhone,
				body: getBotCopy(locale).subscriptionLapsed,
				modelBody: "",
				sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM,
			});
			return;
		}

		// The phone has spent its daily budget. Say so exactly once, then go
		// quiet: every reply to a flood is another message Tavli pays Twilio for.
		if (!budget.allowed) {
			const notice = await ctx.runMutation(
				internal.whatsapp.spendControls.internalConsumeLimitNotice,
				{ phone: customerPhone }
			);
			if (notice.allowed) {
				await sendAndRecord(ctx, {
					conversationId,
					restaurantId: route.restaurantId,
					to: replyAddress,
					phone: customerPhone,
					body: getBotCopy(locale).dailyLimitReached,
					modelBody: "",
					sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM,
				});
			}
			return;
		}

		// The whole platform has spent its daily budget. Answer with fixed copy
		// and do not call the model — the ceiling exists to stop exactly that
		// spend. Checked after the per-phone refusal so a flooding number stays
		// silenced rather than collecting an apology per message.
		if (budget.globalCeilingReached) {
			await sendAndRecord(ctx, {
				conversationId,
				restaurantId: route.restaurantId,
				to: replyAddress,
				phone: customerPhone,
				body: getBotCopy(locale).platformBusy,
				modelBody: "",
				sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM,
			});
			return;
		}

		// The whole message was the routing code — the diner opened the deep link
		// and deleted the sentence. There is no question to answer, and an empty
		// turn would leave the model with no user message at all, so greet them
		// from fixed copy instead of spending a model call on nothing. After the
		// spend refusals above, so a flooding number does not collect a greeting
		// per message.
		if (!route.body.trim()) {
			await sendAndRecord(ctx, {
				conversationId,
				restaurantId: route.restaurantId,
				to: replyAddress,
				phone: customerPhone,
				body: getBotCopy(locale).deepLinkWelcome(restaurant?.name ?? "Tavli"),
				modelBody: "",
				// Fixed copy, not a model turn — the same as every other
				// deterministic reply on this path.
				sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM,
			});
			return;
		}

		try {
			const history = await ctx.runQuery(internal.whatsapp.data.getConversationContext, {
				conversationId,
				limit: WHATSAPP_CONTEXT_MESSAGE_LIMIT,
			});
			const bookingContext = await ctx.runQuery(
				internal.whatsapp.reservations.internalGetBookingContextForBot,
				{ restaurantId: route.restaurantId }
			);
			// Resolved here, once, rather than inside `send_menu_link`: the tool's
			// once-per-turn claim must not sit across an await (the AI SDK runs a
			// step's tool calls concurrently), and the slug is already in hand from
			// `getRestaurantContext` above.
			const { menuLinkEnabled } = await ctx.runQuery(internal.whatsapp.data.getBotFeatureFlags, {});

			const result = await runBotTurn(ctx, {
				// Built here, from the Twilio-verified webhook fields, and frozen. The
				// assistant's identity must not be derivable from anything the model or
				// the customer's text can influence.
				actor: Object.freeze({
					restaurantId: route.restaurantId,
					customerPhone,
					conversationId,
					messageSid: args.messageSid,
				}),
				restaurantName: restaurant?.name ?? "the restaurant",
				locale,
				timezone: restaurant?.timezone ?? undefined,
				// Absent unless the menu page is actually reachable by the diner who
				// receives the link — see `isMenuLinkEnabled`. Absent also disarms
				// the tool: `runBotTurn` does not register it.
				menuLinkSlug: menuLinkEnabled ? (restaurant?.slug ?? undefined) : undefined,
				bookingContext,
				history,
			});

			// Server-composed facts go last, after the model's prose. A reply that
			// says "your booking is cancelled" when it is not is worse than the
			// mutation itself, because the customer acts on the wrong belief.
			const composed = [result.text, ...result.notices].filter(Boolean).join("\n\n");
			await sendAndRecord(ctx, {
				conversationId,
				restaurantId: route.restaurantId,
				to: replyAddress,
				phone: customerPhone,
				body: composed || getBotCopy(locale).genericError,
				modelBody: result.text,
				// Attributed by whether the MODEL wrote prose, not by whether the
				// reply has a body. A turn that ends on a tool step — the step budget
				// ran out, or redaction emptied a one-line reply — sends a body made
				// entirely of notice lines: a confirmation, a cap notice, a menu link,
				// all deterministic server copy. So is the fallback apology when there
				// is neither prose nor a notice. The assistant wrote none of it, and
				// `sentBy` is permanent, so signing it "assistant" would put the
				// assistant's name on the one line it provably did not say — in the
				// view staff read to adjudicate "but your bot told me it was booked".
				// A mixed prose+notice reply still belongs to the assistant.
				sentBy: result.text ? WHATSAPP_MESSAGE_SENDER.ASSISTANT : WHATSAPP_MESSAGE_SENDER.SYSTEM,
				mediaUrl: result.mediaUrl,
			});
		} catch (error) {
			console.error(
				"[whatsapp.processing]",
				buildIntegrationErrorLog(error, {
					integration: "twilio-webhook",
					operation: "handleInboundMessage",
				})
			);
			// Never fail silently — send a fixed localized apology (AC #6).
			await sendAndRecord(ctx, {
				conversationId,
				restaurantId: route.restaurantId,
				to: replyAddress,
				phone: customerPhone,
				body: getBotCopy(locale).genericError,
				modelBody: "",
				sentBy: WHATSAPP_MESSAGE_SENDER.SYSTEM,
			});
		}
	},
});
