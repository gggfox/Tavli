import {
	Body,
	Column,
	Container,
	Head,
	Heading,
	Html,
	Link,
	Preview,
	Row,
	Section,
	Text,
} from "@react-email/components";
import type { InviteEmailLocale } from "./locale";

/** One receipt line, preformatted by the caller (label "2x Pozole", amount "$100.00"). */
export type ReceiptEmailItem = {
	readonly label: string;
	readonly amount: string;
	/** 86'd after payment and refunded: struck-through with the refunded note. */
	readonly refunded: boolean;
};

/**
 * Restaurant-branded order receipt (ADR 008 / TAVLI-71 Phase 3C).
 *
 * All money and dates arrive PREFORMATTED strings — the email layer never does
 * arithmetic or locale math (mirrors how the invite email takes plain
 * strings). Nullable props toggle their block off. The not-a-CFDI footer is
 * mandatory and always rendered.
 */
export type ReceiptEmailProps = {
	readonly locale: InviteEmailLocale;
	readonly previewText: string;
	/** The restaurant's name — the receipt is branded as theirs, not Tavli's. */
	readonly restaurantName: string;
	/**
	 * Canonical `#rrggbb`, contrast-adjusted for a **light** surface, or null.
	 *
	 * Light only, and not because email dark mode does not exist — it does, and
	 * that is the problem. Gmail and Outlook invert *backgrounds* without
	 * reliably inverting inline text colours, so a colour chosen to work in
	 * both directions has to survive being flipped. The band and the rule below
	 * are the two places where that is true, because neither carries text.
	 *
	 * This is also a **one-way door**: changing the derivation changes every
	 * future receipt, with no preview and no per-restaurant rollback.
	 */
	readonly brandColor: string | null;
	readonly title: string;
	/** "Order #12 · June 6, 2026, 3:00 PM" (already localized + restaurant-timezone). */
	readonly orderLine: string;
	/** Rendered only when the restaurant configured at least one tax field. */
	readonly taxBlock: {
		readonly heading: string;
		readonly lines: readonly string[];
	} | null;
	readonly itemsHeading: string;
	readonly items: readonly ReceiptEmailItem[];
	readonly refundedNote: string;
	readonly subtotalLabel: string;
	readonly subtotalValue: string;
	/** Null on cash orders — no service fee is charged on in-person payments. */
	readonly feeLine: {
		readonly label: string;
		readonly attribution: string;
		readonly value: string;
	} | null;
	readonly totalLabel: string;
	readonly totalValue: string;
	/** Null when the caller paid no tips this session. */
	readonly tipLine: { readonly label: string; readonly value: string } | null;
	readonly paymentHint: string;
	readonly footerNotCfdi: string;
	/**
	 * The restaurant's contact details. Null when it has published none — the
	 * footer then uses the wording that doesn't promise any.
	 */
	readonly contactBlock: {
		readonly heading: string;
		readonly rows: readonly ReceiptContactRow[];
	} | null;
	readonly footerSentBy: string;
};

/** One "Email: hola@…" line in the receipt's contact block. */
export type ReceiptContactRow = {
	readonly label: string;
	readonly value: string;
	readonly href: string;
};

const colors = {
	bg: "#f7f6f3",
	text: "#37352f",
	textSecondary: "#787774",
	card: "#ffffff",
	border: "rgba(55, 53, 47, 0.09)",
};

const rowText = {
	color: colors.textSecondary,
	fontSize: "14px",
	lineHeight: "20px",
	margin: "0 0 4px",
} as const;

function AmountRow({
	label,
	value,
	bold,
}: Readonly<{ label: string; value: string; bold?: boolean }>) {
	const style = bold ? { ...rowText, color: colors.text, fontWeight: 700 as const } : rowText;
	return (
		<Row>
			<Column>
				<Text style={style}>{label}</Text>
			</Column>
			<Column align="right">
				<Text style={style}>{value}</Text>
			</Column>
		</Row>
	);
}

export default function ReceiptEmail({
	previewText,
	restaurantName,
	brandColor,
	title,
	orderLine,
	taxBlock,
	itemsHeading,
	items,
	refundedNote,
	subtotalLabel,
	subtotalValue,
	feeLine,
	totalLabel,
	totalValue,
	tipLine,
	paymentHint,
	footerNotCfdi,
	contactBlock,
	footerSentBy,
}: Readonly<ReceiptEmailProps>) {
	return (
		<Html lang="en">
			<Head />
			<Preview>{previewText}</Preview>
			<Body
				style={{
					backgroundColor: colors.bg,
					margin: 0,
					padding: "32px 16px",
					fontFamily: "Arial, sans-serif",
				}}
			>
				<Container
					style={{
						backgroundColor: colors.card,
						borderRadius: "8px",
						border: `1px solid ${colors.border}`,
						padding: "32px",
						maxWidth: "520px",
					}}
				>
					{/*
					 * The brand band. A background, never text.
					 *
					 * Every text colour in this template stays on the platform
					 * palette on purpose: email dark-mode inversion recolours
					 * backgrounds without recolouring inline text, so branded text
					 * is legible in exactly one of the two renderings and nobody
					 * can tell which one a given recipient will see. A band has no
					 * such failure mode — worst case it is a slightly different
					 * shade of the restaurant's colour.
					 */}
					{brandColor ? (
						<Section
							style={{
								backgroundColor: brandColor,
								height: "6px",
								lineHeight: "6px",
								fontSize: "1px",
								borderRadius: "3px",
								margin: "0 0 20px",
							}}
						>
							{/* Outlook collapses an empty element regardless of its
							    height, so the band needs a character to hold it open. */}
							&nbsp;
						</Section>
					) : null}

					<Heading
						as="h1"
						style={{
							color: colors.text,
							fontSize: "22px",
							fontWeight: 700,
							margin: "0 0 4px",
						}}
					>
						{restaurantName}
					</Heading>

					<Text
						style={{ color: colors.text, fontSize: "16px", lineHeight: "24px", margin: "0 0 4px" }}
					>
						{title}
					</Text>

					<Text
						style={{
							color: colors.textSecondary,
							fontSize: "13px",
							lineHeight: "20px",
							margin: "0 0 16px",
						}}
					>
						{orderLine}
					</Text>

					{taxBlock ? (
						<Section
							style={{
								marginBottom: "16px",
								borderTop: `1px solid ${colors.border}`,
								paddingTop: "12px",
							}}
						>
							<Text
								style={{
									color: colors.textSecondary,
									fontSize: "12px",
									fontWeight: 700,
									lineHeight: "18px",
									margin: "0 0 4px",
									textTransform: "uppercase" as const,
								}}
							>
								{taxBlock.heading}
							</Text>
							{taxBlock.lines.map((line) => (
								<Text
									key={line}
									style={{
										color: colors.textSecondary,
										fontSize: "13px",
										lineHeight: "19px",
										margin: "0 0 2px",
									}}
								>
									{line}
								</Text>
							))}
						</Section>
					) : null}

					<Section style={{ borderTop: `1px solid ${colors.border}`, paddingTop: "12px" }}>
						<Text
							style={{
								color: colors.text,
								fontSize: "14px",
								fontWeight: 700,
								lineHeight: "20px",
								margin: "0 0 8px",
							}}
						>
							{itemsHeading}
						</Text>
						{items.map((item) =>
							item.refunded ? (
								<Row key={`${item.label}-${item.amount}`}>
									<Column>
										<Text style={rowText}>
											<s>{item.label}</s>
										</Text>
									</Column>
									<Column align="right">
										<Text style={rowText}>
											<s>{item.amount}</s> · {refundedNote}
										</Text>
									</Column>
								</Row>
							) : (
								<AmountRow
									key={`${item.label}-${item.amount}`}
									label={item.label}
									value={item.amount}
								/>
							)
						)}
					</Section>

					<Section
						style={{
							// The second and last place the brand colour appears: the
							// rule above the money. Two pixels rather than one so it
							// reads as deliberate rather than as the default hairline
							// that every other divider in this template uses.
							borderTop: brandColor ? `2px solid ${brandColor}` : `1px solid ${colors.border}`,
							marginTop: "12px",
							paddingTop: "12px",
						}}
					>
						<AmountRow label={subtotalLabel} value={subtotalValue} />
						{feeLine ? (
							<>
								<AmountRow label={feeLine.label} value={feeLine.value} />
								<Text
									style={{
										color: colors.textSecondary,
										fontSize: "12px",
										lineHeight: "16px",
										margin: "0 0 4px",
									}}
								>
									{feeLine.attribution}
								</Text>
							</>
						) : null}
						<AmountRow label={totalLabel} value={totalValue} bold />
						{tipLine ? <AmountRow label={tipLine.label} value={tipLine.value} /> : null}
						<Text
							style={{
								color: colors.textSecondary,
								fontSize: "13px",
								lineHeight: "19px",
								margin: "8px 0 0",
							}}
						>
							{paymentHint}
						</Text>
					</Section>

					{/* The disclaimer comes first: its copy says "using the details
					    below", so the contact rows have to follow it, not precede it. */}
					<Text
						style={{
							color: colors.textSecondary,
							fontSize: "12px",
							lineHeight: "18px",
							margin: "24px 0 0",
							borderTop: `1px solid ${colors.border}`,
							paddingTop: "16px",
						}}
					>
						{footerNotCfdi}
					</Text>

					{contactBlock ? (
						<Section style={{ margin: "12px 0 0" }}>
							<Text
								style={{
									color: colors.text,
									fontSize: "13px",
									fontWeight: 600,
									lineHeight: "19px",
									margin: "0 0 6px",
								}}
							>
								{contactBlock.heading}
							</Text>
							{contactBlock.rows.map((row) => (
								<Text
									key={row.href}
									style={{
										color: colors.textSecondary,
										fontSize: "13px",
										lineHeight: "19px",
										margin: "0 0 2px",
									}}
								>
									{`${row.label}: `}
									<Link href={row.href} style={{ color: colors.text }}>
										{row.value}
									</Link>
								</Text>
							))}
						</Section>
					) : null}

					<Text
						style={{
							color: colors.textSecondary,
							fontSize: "12px",
							lineHeight: "18px",
							margin: "8px 0 0",
						}}
					>
						{footerSentBy}
					</Text>
				</Container>
			</Body>
		</Html>
	);
}
