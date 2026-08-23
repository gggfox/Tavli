import { useMemo } from "react";
import { renderSVG } from "uqr";

/**
 * The one place QR encoding settings live, so the panel on screen and the sheet
 * that comes out of the printer can never drift apart.
 *
 * Medium error correction: a table tent picks up grease and creases, and `M`
 * recovers 15% of the symbol at almost no size cost at a `wa.me` link's length.
 *
 * **Deliberately not themed.** Every other surface takes its colours from the
 * theme tokens; a QR is read by a camera looking for maximum contrast, and a
 * muted dark-mode QR is a QR that does not scan.
 */
export function qrSvgMarkup(value: string): string {
	return renderSVG(value, { ecc: "M", border: 2 });
}

interface QrCodeProps {
	/** What the code encodes. Usually a `wa.me` deep link. */
	readonly value: string;
	readonly title: string;
	readonly className?: string;
	readonly testId?: string;
}

/**
 * A QR code as inline SVG.
 *
 * `renderSVG` returns a complete `<svg>` string with a `viewBox` and no fixed
 * width, so the code scales to whatever box it is given. Its markup is
 * machine-generated — the only interpolation is the URL, and it lands in path
 * data, not in markup — which is what makes `dangerouslySetInnerHTML` safe.
 */
export function QrCode({ value, title, className, testId }: QrCodeProps) {
	const { inner, viewBox } = useMemo(() => {
		const svg = qrSvgMarkup(value);
		return {
			// Strip the generated wrapper so the props below (role, label, sizing)
			// belong to the element React owns.
			inner: svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, ""),
			viewBox: /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 100 100",
		};
	}, [value]);

	return (
		<svg
			viewBox={viewBox}
			role="img"
			aria-label={title}
			data-testid={testId}
			className={className}
			xmlns="http://www.w3.org/2000/svg"
			dangerouslySetInnerHTML={{ __html: inner }}
		/>
	);
}
