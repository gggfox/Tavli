import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ language: "es" }));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (k: string) => k, i18n: { language: hoisted.language } }),
}));

import { MoneyCurrencyProvider, useCurrencySymbol, useFormatMoney } from "./useFormatMoney";

function Price({
	cents,
	currency,
	override,
}: Readonly<{ cents: number; currency?: string; override?: string }>) {
	const formatMoney = useFormatMoney(currency);
	const symbol = useCurrencySymbol(currency);
	return (
		<>
			<span data-testid="price">{formatMoney(cents, override)}</span>
			<span data-testid="symbol">{symbol}</span>
		</>
	);
}

describe("useFormatMoney", () => {
	it("defaults to MXN outside any provider", () => {
		render(<Price cents={12345} />);
		expect(screen.getByTestId("price").textContent).toBe("$123.45");
		expect(screen.getByTestId("symbol").textContent).toBe("$");
	});

	it("uses the surrounding restaurant's currency", () => {
		render(
			<MoneyCurrencyProvider currency="EUR">
				<Price cents={12345} />
			</MoneyCurrencyProvider>
		);
		expect(screen.getByTestId("price").textContent).toBe("€123.45");
		expect(screen.getByTestId("symbol").textContent).toBe("€");
	});

	it("lets the hook argument pin a currency over the provider (platform billing)", () => {
		render(
			<MoneyCurrencyProvider currency="EUR">
				<Price cents={200000} currency="MXN" />
			</MoneyCurrencyProvider>
		);
		expect(screen.getByTestId("price").textContent).toBe("$2,000.00");
	});

	it("lets a per-call currency win over both (a Stripe payout's own currency)", () => {
		render(
			<MoneyCurrencyProvider currency="MXN">
				<Price cents={500} currency="MXN" override="gbp" />
			</MoneyCurrencyProvider>
		);
		expect(screen.getByTestId("price").textContent).toBe("£5.00");
	});

	it("treats an empty provider currency as absent", () => {
		render(
			<MoneyCurrencyProvider currency="">
				<Price cents={100} />
			</MoneyCurrencyProvider>
		);
		expect(screen.getByTestId("price").textContent).toBe("$1.00");
	});
});
