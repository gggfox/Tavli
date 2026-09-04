import { QrCode, qrSvgMarkup } from "@/features/whatsapp/components/QrCode";
import { WhatsappKeys } from "@/global/i18n";
import { Copy, Check, MessageCircle, Printer } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface WhatsappAssistantPanelProps {
	readonly restaurantName: string;
	/** Display form of the short code, e.g. `VRN-8F3`. */
	readonly formattedShortCode: string;
	/** `null` when Tavli has no sender number on this deployment. */
	readonly deepLinkUrl: string | null;
	/** The sentence the link prefills into the diner's message box. */
	readonly deepLinkText: string;
	readonly className?: string;
}

/**
 * The distribution surface for one restaurant's WhatsApp assistant: the deep
 * link, the code, and a QR meant to be printed and taped to a table (ADR 012).
 *
 * Shared by staff Settings and the diner-facing public page, because they want
 * the same three things. The prefilled sentence is shown, not hidden, since
 * WhatsApp puts it in the diner's message box where they can read and edit it —
 * staff should know exactly what their diners are about to send.
 *
 * With no Tavli number configured the panel says so instead of rendering a
 * `wa.me/` link to nowhere and a QR that scans to a 404.
 */
export function WhatsappAssistantPanel({
	restaurantName,
	formattedShortCode,
	deepLinkUrl,
	deepLinkText,
	className,
}: WhatsappAssistantPanelProps) {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);

	if (!deepLinkUrl) {
		return (
			<p className="text-xs text-faint-foreground">{t(WhatsappKeys.ASSISTANT_NUMBER_MISSING)}</p>
		);
	}

	const qrTitle = t(WhatsappKeys.ASSISTANT_QR_ALT, { name: restaurantName });

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(deepLinkUrl);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			// No clipboard permission (or an insecure context). The link is on
			// screen and selectable, so there is nothing to recover from.
		}
	};

	return (
		<div className={`flex flex-col gap-4 sm:flex-row sm:items-start ${className ?? ""}`}>
			<div className="shrink-0 self-center rounded-lg bg-white p-2 sm:self-start">
				<QrCode value={deepLinkUrl} title={qrTitle} testId="whatsapp-qr" className="h-36 w-36" />
			</div>

			<div className="min-w-0 flex-1 space-y-3">
				<div className="space-y-1">
					<p className="text-xs text-faint-foreground">{t(WhatsappKeys.ASSISTANT_CODE_LABEL)}</p>
					<p className="font-mono text-lg font-semibold tracking-widest text-foreground">
						{formattedShortCode}
					</p>
				</div>

				<div className="space-y-1">
					<p className="text-xs text-faint-foreground">{t(WhatsappKeys.ASSISTANT_PREFILL_LABEL)}</p>
					<p className="break-words rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
						{deepLinkText}
					</p>
				</div>

				{/* Consent line (WhatsApp Business Messaging Policy): the diner's own
				    message is the opt-in, and the surface that invites the message is
				    where that has to be said. */}
				<p className="text-xs text-faint-foreground">{t(WhatsappKeys.ASSISTANT_CONSENT_NOTE)}</p>

				<div className="flex flex-wrap items-center gap-2">
					<a
						href={deepLinkUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium hover-btn-primary"
					>
						<MessageCircle size={14} aria-hidden />
						{t(WhatsappKeys.ASSISTANT_OPEN_LINK)}
					</a>
					<button
						type="button"
						onClick={handleCopy}
						className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover-secondary"
					>
						{copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
						{copied ? t(WhatsappKeys.ASSISTANT_COPIED) : t(WhatsappKeys.ASSISTANT_COPY_LINK)}
					</button>
					<button
						type="button"
						onClick={() =>
							printQrSheet({
								url: deepLinkUrl,
								restaurantName,
								formattedShortCode,
								instruction: t(WhatsappKeys.ASSISTANT_SCAN_INSTRUCTION),
								qrTitle,
							})
						}
						className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover-secondary"
					>
						<Printer size={14} aria-hidden />
						{t(WhatsappKeys.ASSISTANT_PRINT_QR)}
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * Open a print-only window holding just the table tent: name, QR, code,
 * instruction.
 *
 * A `@media print` stylesheet on this panel would have to fight every ancestor
 * layout it can be mounted inside — the settings canvas and the diner's menu
 * page have nothing in common. A dedicated window has exactly one thing on it,
 * which is also what makes the output predictable on a restaurant's printer.
 *
 * Built through the DOM rather than an HTML string: `restaurantName` is
 * operator-supplied text, and `textContent` is what keeps it text. Only the QR
 * markup goes in as HTML, and that is machine-generated by `qrSvgMarkup`.
 */
function printQrSheet(args: {
	url: string;
	restaurantName: string;
	formattedShortCode: string;
	instruction: string;
	qrTitle: string;
}): void {
	const win = window.open("", "_blank", "width=520,height=720");
	// Blocked by a popup blocker: nothing to recover from, the on-screen QR is
	// still there.
	if (!win) return;

	const doc = win.document;
	doc.title = args.restaurantName;

	const style = doc.createElement("style");
	style.textContent = [
		"@page { margin: 16mm; }",
		"body { font-family: system-ui, sans-serif; text-align: center; color: #000; background: #fff; }",
		"h1 { font-size: 20pt; margin: 0 0 4mm; }",
		"p { font-size: 12pt; margin: 0 0 4mm; }",
		".code { font-family: ui-monospace, monospace; font-size: 18pt; letter-spacing: 0.2em; }",
		"svg { width: 70mm; height: 70mm; }",
	].join("\n");
	doc.head.appendChild(style);

	const heading = doc.createElement("h1");
	heading.textContent = args.restaurantName;

	const instruction = doc.createElement("p");
	instruction.textContent = args.instruction;

	const figure = doc.createElement("div");
	figure.setAttribute("role", "img");
	figure.setAttribute("aria-label", args.qrTitle);
	figure.innerHTML = qrSvgMarkup(args.url);

	const code = doc.createElement("p");
	code.className = "code";
	code.textContent = args.formattedShortCode;

	doc.body.append(heading, instruction, figure, code);
	win.focus();
	win.print();
}
