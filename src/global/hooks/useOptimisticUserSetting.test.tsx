import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useOptimisticUserSetting } from "./useOptimisticUserSetting";

interface HarnessProps {
	readonly serverValue: string[] | null;
	readonly persist: (next: string[]) => Promise<unknown>;
	readonly fallback: string[];
	readonly onPersistError?: (error: unknown) => void;
	readonly nextValue?: string[];
}

function Harness({
	serverValue,
	persist,
	fallback,
	onPersistError,
	nextValue = ["next"],
}: HarnessProps) {
	const [value, update] = useOptimisticUserSetting({
		serverValue,
		persist,
		fallback,
		onPersistError,
	});
	return (
		<div>
			<output data-testid="value">{value.join(",")}</output>
			<button type="button" onClick={() => update(nextValue)}>
				update
			</button>
		</div>
	);
}

describe("useOptimisticUserSetting", () => {
	it("returns the fallback when the server value is null", () => {
		render(
			<Harness
				serverValue={null}
				persist={() => Promise.resolve()}
				fallback={["a", "b"]}
			/>
		);
		expect(screen.getByTestId("value")).toHaveTextContent("a,b");
	});

	it("returns the server value once it arrives", () => {
		const { rerender } = render(
			<Harness
				serverValue={null}
				persist={() => Promise.resolve()}
				fallback={["fallback"]}
			/>
		);
		expect(screen.getByTestId("value")).toHaveTextContent("fallback");

		rerender(
			<Harness
				serverValue={["from-server"]}
				persist={() => Promise.resolve()}
				fallback={["fallback"]}
			/>
		);
		expect(screen.getByTestId("value")).toHaveTextContent("from-server");
	});

	it("reflects user updates immediately and calls persist", () => {
		const persist = vi.fn().mockResolvedValue(undefined);
		render(
			<Harness
				serverValue={["server"]}
				persist={persist}
				fallback={[]}
				nextValue={["next"]}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "update" }));

		expect(screen.getByTestId("value")).toHaveTextContent("next");
		expect(persist).toHaveBeenCalledWith(["next"]);
	});

	it("forwards persist errors to onPersistError without throwing", async () => {
		const error = new Error("boom");
		const persist = vi.fn().mockRejectedValue(error);
		const onPersistError = vi.fn();

		render(
			<Harness
				serverValue={null}
				persist={persist}
				fallback={["fallback"]}
				onPersistError={onPersistError}
				nextValue={["next"]}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "update" }));

		expect(screen.getByTestId("value")).toHaveTextContent("next");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(onPersistError).toHaveBeenCalledWith(error);
	});

	it("preserves the local value when the server confirms the same pick", () => {
		const { rerender } = render(
			<Harness
				serverValue={["initial"]}
				persist={() => Promise.resolve()}
				fallback={["fallback"]}
				nextValue={["user-pick"]}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "update" }));
		expect(screen.getByTestId("value")).toHaveTextContent("user-pick");

		rerender(
			<Harness
				serverValue={["user-pick"]}
				persist={() => Promise.resolve()}
				fallback={["fallback"]}
				nextValue={["user-pick"]}
			/>
		);

		expect(screen.getByTestId("value")).toHaveTextContent("user-pick");
	});
});
