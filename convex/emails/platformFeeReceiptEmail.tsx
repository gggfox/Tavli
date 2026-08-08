import {
	Body,
	Button,
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

/**
 * Tavli's receipt to a RESTAURANT for the monthly platform subscription
 * (ADR 008 / TAVLI-71 Phase 4B).
 *
 * Deliberately branded as Tavli, not as the restaurant: Tavli is the issuer
 * here and the restaurant is the customer. (`receiptEmail.tsx` is the mirror
 * image — the restaurant's brand, sent to a diner.)
 *
 * Every money value and date arrives PREFORMATTED, so the email layer never
 * does arithmetic or locale math, and the amount always comes from the Stripe
 * invoice rather than the display constant.
 */
export type PlatformFeeReceiptEmailProps = {
	readonly locale: InviteEmailLocale;
	readonly previewText: string;
	readonly issuer: string;
	readonly title: string;
	/** "Thanks — we received your monthly Tavli subscription payment for X." */
	readonly intro: string;
	readonly periodLabel: string;
	/** "June 1 – July 1, 2026", already localized. */
	readonly periodValue: string;
	readonly amountLabel: string;
	/** "$2,000.00 MXN", straight off the invoice. */
	readonly amountValue: string;
	readonly planLabel: string;
	readonly planValue: string;
	/** Null when Stripe has not numbered the invoice yet. */
	readonly invoiceLine: { readonly label: string; readonly value: string } | null;
	/** Null when the invoice has no hosted page (rare, but it is nullable). */
	readonly invoiceUrl: string | null;
	readonly ctaLabel: string;
	/** Mandatory: keeps the subscription apart from the diner-paid service fee. */
	readonly notServiceFee: string;
	readonly footerQuestions: string;
	readonly footerSentBy: string;
};

const colors = {
	bg: "#f7f6f3",
	text: "#37352f",
	textSecondary: "#787774",
	card: "#ffffff",
	border: "rgba(55, 53, 47, 0.09)",
	cta: "#37352f",
	ctaText: "#ffffff",
};

const rowText = {
	color: colors.textSecondary,
	fontSize: "14px",
	lineHeight: "20px",
	margin: "0 0 4px",
} as const;

function DetailRow({
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

export default function PlatformFeeReceiptEmail({
	locale,
	previewText,
	issuer,
	title,
	intro,
	periodLabel,
	periodValue,
	amountLabel,
	amountValue,
	planLabel,
	planValue,
	invoiceLine,
	invoiceUrl,
	ctaLabel,
	notServiceFee,
	footerQuestions,
	footerSentBy,
}: Readonly<PlatformFeeReceiptEmailProps>) {
	return (
		<Html lang={locale}>
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
						{issuer}
					</Heading>

					<Text
						style={{ color: colors.text, fontSize: "16px", lineHeight: "24px", margin: "0 0 12px" }}
					>
						{title}
					</Text>

					<Text
						style={{
							color: colors.textSecondary,
							fontSize: "14px",
							lineHeight: "21px",
							margin: "0 0 16px",
						}}
					>
						{intro}
					</Text>

					<Section style={{ borderTop: `1px solid ${colors.border}`, paddingTop: "12px" }}>
						<DetailRow label={planLabel} value={planValue} />
						<DetailRow label={periodLabel} value={periodValue} />
						{invoiceLine ? <DetailRow label={invoiceLine.label} value={invoiceLine.value} /> : null}
						<DetailRow label={amountLabel} value={amountValue} bold />
					</Section>

					{invoiceUrl ? (
						<Section style={{ marginTop: "20px" }}>
							<Button
								href={invoiceUrl}
								style={{
									backgroundColor: colors.cta,
									borderRadius: "6px",
									color: colors.ctaText,
									display: "inline-block",
									fontSize: "15px",
									fontWeight: 600,
									padding: "12px 24px",
									textDecoration: "none",
								}}
							>
								{ctaLabel}
							</Button>
						</Section>
					) : null}

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
						{notServiceFee}
					</Text>

					<Text
						style={{
							color: colors.textSecondary,
							fontSize: "12px",
							lineHeight: "18px",
							margin: "8px 0 0",
						}}
					>
						{footerQuestions}
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
