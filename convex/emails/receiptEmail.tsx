import {
	Body,
	Column,
	Container,
	Head,
	Heading,
	Html,
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
	readonly footerSentBy: string;
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
							borderTop: `1px solid ${colors.border}`,
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
