/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	setMock: vi.fn(async () => null),
	clearMock: vi.fn(async () => null),
	encodeMock: vi.fn(async () => ({
		ok: true as const,
		bytes: new ArrayBuffer(8),
		width: 512,
		height: 512,
	})),
}));

vi.mock("@convex-dev/react-query", () => ({
	useConvexAction: (ref: any) =>
		String(ref?.name ?? "").includes("clear") ? hoisted.clearMock : hoisted.setMock,
}));

vi.mock("convex/_generated/api", () => ({
	api: {
		branding: {
			setBrandingImage: { name: "branding:setBrandingImage" },
			clearBrandingImage: { name: "branding:clearBrandingImage" },
		},
	},
}));

vi.mock("@/features/restaurants/utils/brandingImageEncode", () => ({
	encodeBrandingImage: hoisted.encodeMock,
}));

import { BrandingImageUploader } from "./BrandingImageUploader";

const RESTAURANT_ID = "restaurants:1" as any;

function renderUploader(props: Record<string, any> = {}) {
	return render(
		<BrandingImageUploader
			restaurantId={RESTAURANT_ID}
			slot="logo"
			label="Logo"
			image={undefined}
			onChanged={() => {}}
			{...props}
		/>
	);
}

/** The paste surface is the slot itself — see the component's focus note. */
function pasteTarget(): HTMLElement {
	return screen.getByTestId("branding-slot-logo");
}

function imageClipboard(file: File) {
	return {
		items: [{ type: file.type, getAsFile: () => file }],
	};
}

function pngFile(name = "logo.png") {
	return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

describe("BrandingImageUploader clipboard paste", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uploads an image pasted onto the slot", async () => {
		renderUploader();

		fireEvent.paste(pasteTarget(), { clipboardData: imageClipboard(pngFile()) });

		await waitFor(() => expect(hoisted.setMock).toHaveBeenCalledTimes(1));
		expect(hoisted.setMock).toHaveBeenCalledWith(
			expect.objectContaining({ restaurantId: RESTAURANT_ID, slot: "logo" })
		);
	});

	it("fans a pasted image out to the slots it also fills", async () => {
		renderUploader({
			slot: "headerDesktop",
			alsoFill: ["headerTablet", "headerPhone"],
		});

		fireEvent.paste(screen.getByTestId("branding-slot-headerDesktop"), {
			clipboardData: imageClipboard(pngFile("header.png")),
		});

		await waitFor(() => expect(hoisted.setMock).toHaveBeenCalledTimes(3));
		expect(hoisted.setMock.mock.calls.map((c: any) => c[0].slot)).toEqual([
			"headerDesktop",
			"headerTablet",
			"headerPhone",
		]);
	});

	it("tells the manager the slot takes a paste", () => {
		// Focus-scoped paste is invisible without this line: nothing about a
		// file-picker button suggests the surface around it accepts ⌘V.
		renderUploader();

		expect(screen.getByText(/paste/i)).toBeTruthy();
	});

	it("ignores a paste that carries no image", async () => {
		renderUploader();

		fireEvent.paste(pasteTarget(), {
			clipboardData: { items: [{ type: "text/plain", getAsFile: () => null }] },
		});

		await Promise.resolve();
		expect(hoisted.setMock).not.toHaveBeenCalled();
	});

	it("ignores a paste that lands while an upload is still in flight", async () => {
		let release: () => void = () => {};
		hoisted.setMock.mockImplementationOnce(
			() => new Promise<null>((resolve) => (release = () => resolve(null)))
		);
		renderUploader();

		fireEvent.paste(pasteTarget(), { clipboardData: imageClipboard(pngFile()) });
		await waitFor(() => expect(hoisted.setMock).toHaveBeenCalledTimes(1));

		fireEvent.paste(pasteTarget(), { clipboardData: imageClipboard(pngFile("second.png")) });
		await Promise.resolve();

		expect(hoisted.setMock).toHaveBeenCalledTimes(1);

		// Let the in-flight upload settle inside the test, or its state update
		// lands after teardown and React warns about an unwrapped act().
		await act(async () => {
			release();
		});
	});
});
