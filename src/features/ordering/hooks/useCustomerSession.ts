import { OrderingKeys } from "@/global/i18n";
import { useAuth } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { restoreSession, useSessionStore } from "./useSession";

export function getSessionErrorKey(err: unknown): string {
	let raw = "";
	if (err instanceof Error) raw = err.message;
	else if (typeof err === "string") raw = err;

	if (raw.includes("Restaurant not found")) {
		return OrderingKeys.SESSION_ERROR_NOT_FOUND;
	}
	if (raw.includes("NOT_AUTHENTICATED")) {
		return OrderingKeys.SESSION_SIGN_IN_REQUIRED;
	}
	return OrderingKeys.SESSION_ERROR_GENERIC;
}

interface CustomerSession {
	/** Clerk has resolved the auth state. */
	isLoaded: boolean;
	isSignedIn: boolean;
	sessionId: Id<"sessions"> | null;
	/** i18n key for a failed bootstrap, or null. */
	errorKey: string | null;
	/**
	 * Clear the failure and let the bootstrap effect run once more.
	 *
	 * Deliberately explicit rather than automatic: the effect below refuses to
	 * re-fire while `errorKey` is set, which is what stops a failed handshake
	 * from re-issuing the mutation on every render. A diner pressing "try again"
	 * is a real input, so it is allowed to lift that guard exactly once.
	 */
	retry: () => void;
}

/**
 * Bootstraps the diner's ordering session for `/r/:slug`: restores the one held
 * in sessionStorage when it is still active, otherwise creates a fresh one.
 * Signed-out visitors get no session — the caller renders a sign-in prompt.
 */
export function useCustomerSession(slug: string): CustomerSession {
	const { isLoaded, isSignedIn } = useAuth();
	// Selectors, not a whole-store destructure: subscribing to the entire store
	// re-renders this hook's owner on every write and re-runs the effect below.
	const sessionId = useSessionStore((s) => s.sessionId);
	const setSession = useSessionStore((s) => s.setSession);
	const clearSession = useSessionStore((s) => s.clearSession);
	const [errorKey, setErrorKey] = useState<string | null>(null);
	// A ref, not state: the flag only guards the effect, and keeping it out of
	// the dependency array keeps the effect driven by real inputs.
	const creatingSessionRef = useRef(false);

	// Stable identity across renders (memoized by Convex), unlike a
	// useMutation() wrapper object, so it is safe as an effect dependency.
	const createSession = useConvexMutation(api.sessions.create);

	const restoredFromStorage = useMemo(
		() => (!sessionId && isSignedIn ? restoreSession() : null),
		[sessionId, isSignedIn]
	);

	const { data: restoredSession, isPending: validatingRestore } = useQuery({
		...convexQuery(
			api.sessions.getActive,
			restoredFromStorage?.sessionId
				? { sessionId: restoredFromStorage.sessionId as Id<"sessions"> }
				: "skip"
		),
		enabled: isLoaded && isSignedIn && !sessionId && !!restoredFromStorage?.sessionId,
	});

	useEffect(() => {
		if (!isLoaded) return;

		if (!isSignedIn) {
			clearSession();
			setErrorKey(null);
			return;
		}

		if (sessionId) return;
		// A failed attempt stays failed until something meaningful changes
		// (sign-out, a new slug, an explicit clearSession); otherwise the effect
		// would fire the mutation again on every render.
		if (errorKey) return;
		if (creatingSessionRef.current) return;

		if (restoredFromStorage && validatingRestore) return;

		if (restoredFromStorage && restoredSession) {
			setSession({
				sessionId: restoredSession._id,
				restaurantId: restoredSession.restaurantId,
			});
			return;
		}

		if (restoredFromStorage && restoredSession === null) {
			clearSession();
		}

		creatingSessionRef.current = true;
		createSession({ restaurantSlug: slug })
			.then((result) => {
				setSession({
					sessionId: result.sessionId,
					restaurantId: result.restaurantId,
				});
			})
			.catch((err: unknown) => {
				setErrorKey(getSessionErrorKey(err));
			})
			.finally(() => {
				creatingSessionRef.current = false;
			});
	}, [
		isLoaded,
		isSignedIn,
		slug,
		sessionId,
		errorKey,
		restoredFromStorage,
		restoredSession,
		validatingRestore,
		setSession,
		clearSession,
		createSession,
	]);

	const retry = useCallback(() => setErrorKey(null), []);

	return { isLoaded, isSignedIn: !!isSignedIn, sessionId, errorKey, retry };
}
