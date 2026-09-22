import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Html,
	Preview,
	Section,
	Text,
} from "@react-email/components";
import type { InviteEmailLocale } from "./locale";

/**
 * The payout email (TAVLI-103), used for both "it did not reach your bank" and
 * "payouts are flowing again".
 *
 * One component for both because the shape is identical and the tone must be:
 * the reassurance line comes first, in the accent colour rather than the alarm
 * colour, then the amount, then the reason, then the fix. A restaurant reading
 * "payout failed" assumes the money is gone; the layout is what stops that
 * assumption before the reader reaches the word "failed".
 */
export type PayoutEmailProps = {
	readonly locale: InviteEmailLocale;
	/** The reassurance line. Rendered first, above the heading. */
	readonly safeLine: string;
	readonly heading: string;
	readonly amountLine: string;
	readonly restaurantLine: string | null;
	readonly reasonLabel: string;
	readonly reason: string;
	readonly fixLabel: string;
	readonly fix: string;
	readonly ctaLabel: string;
	readonly payoutsUrl: string;
	readonly footerWhy: string;
	readonly footerSentBy: string;
	readonly previewText: string;
};

const colors = {
	bg: "#f7f6f3",
	text: "#37352f",
	textSecondary: "#787774",
	cta: "#2383e2",
	ctaText: "#ffffff",
	card: "#ffffff",
	border: "rgba(55, 53, 47, 0.09)",
	reassure: "#0f7b6c",
};

const labelStyle = {
	color: colors.textSecondary,
	fontSize: "12px",
	fontWeight: 700 as const,
	letterSpacing: "0.04em",
	textTransform: "uppercase" as const,
	margin: "16px 0 4px",
};

const bodyStyle = {
	color: colors.text,
	fontSize: "15px",
	lineHeight: "23px",
	margin: 0,
};

export default function PayoutEmail({
	locale,
	safeLine,
	heading,
	amountLine,
	restaurantLine,
	reasonLabel,
	reason,
	fixLabel,
	fix,
	ctaLabel,
	payoutsUrl,
	footerWhy,
	footerSentBy,
	previewText,
}: Readonly<PayoutEmailProps>) {
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
						style={{ color: colors.text, fontSize: "22px", fontWeight: 700, margin: "0 0 16px" }}
					>
						Tavli
					</Heading>

					<Text
						style={{
							color: colors.reassure,
							fontSize: "17px",
							fontWeight: 700,
							lineHeight: "25px",
							margin: "0 0 12px",
						}}
					>
						{safeLine}
					</Text>

					<Heading
						as="h2"
						style={{ color: colors.text, fontSize: "18px", fontWeight: 700, margin: "0 0 12px" }}
					>
						{heading}
					</Heading>

					<Text style={{ ...bodyStyle, fontSize: "16px", margin: "0 0 4px" }}>{amountLine}</Text>

					{restaurantLine ? (
						<Text
							style={{
								color: colors.textSecondary,
								fontSize: "14px",
								lineHeight: "21px",
								margin: 0,
							}}
						>
							{restaurantLine}
						</Text>
					) : null}

					<Text style={labelStyle}>{reasonLabel}</Text>
					<Text style={bodyStyle}>{reason}</Text>

					<Text style={labelStyle}>{fixLabel}</Text>
					<Text style={bodyStyle}>{fix}</Text>

					<Section style={{ marginTop: "24px" }}>
						<Button
							href={payoutsUrl}
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
						{footerWhy}
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
