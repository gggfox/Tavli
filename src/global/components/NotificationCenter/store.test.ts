import { afterEach, describe, expect, it } from "vitest";
import { pushToast, useNotificationStore } from "./store";

afterEach(() => {
	useNotificationStore.getState().clearAll();
});

describe("notification store", () => {
	it("pushes a toast and exposes it via the store", () => {
		pushToast({ id: "t1", kind: "info", title: "Hello" });
		expect(useNotificationStore.getState().toasts).toHaveLength(1);
		expect(useNotificationStore.getState().toasts[0].title).toBe("Hello");
	});

	it("dedupes by id (the listener pattern)", () => {
		pushToast({ id: "t1", kind: "info", title: "Hello" });
		pushToast({ id: "t1", kind: "info", title: "Hello again" });
		expect(useNotificationStore.getState().toasts).toHaveLength(1);
		expect(useNotificationStore.getState().toasts[0].title).toBe("Hello");
	});

	it("dismisses a toast by id", () => {
		pushToast({ id: "t1", kind: "info", title: "First" });
		pushToast({ id: "t2", kind: "info", title: "Second" });
		useNotificationStore.getState().dismissToast("t1");
		expect(useNotificationStore.getState().toasts).toHaveLength(1);
		expect(useNotificationStore.getState().toasts[0].id).toBe("t2");
	});

	it("clearAll removes everything", () => {
		pushToast({ id: "t1", kind: "info", title: "First" });
		pushToast({ id: "t2", kind: "info", title: "Second" });
		useNotificationStore.getState().clearAll();
		expect(useNotificationStore.getState().toasts).toHaveLength(0);
	});

	it("auto-fills createdAt when omitted", () => {
		const before = Date.now();
		pushToast({ id: "t1", kind: "reservation", title: "New booking" });
		const after = Date.now();
		const toast = useNotificationStore.getState().toasts[0];
		expect(toast.createdAt).toBeGreaterThanOrEqual(before);
		expect(toast.createdAt).toBeLessThanOrEqual(after);
	});
});
