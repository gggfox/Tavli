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
 * The dispute email (TAVLI-102), used for all three phases a restaurant hears
 * about: opened, won, lost.
 *
 * One component, because the shape is identical and the tone must be: a calm
 * lead line, then the money and the order it belongs to, then what happened,
 * then what happens next. The lead line is NOT tinted red on a loss — a
 * chargeback is a bank's decision about a diner's card, not a failure by the
 * person reading the mail, and colouring it as an alarm is how a routine event
 * turns into a phone call.
 *
 * `toneAccent` is the one thing that varies: green when the restaurant keeps
 * the money, neutral otherwise.
 */
export type DisputeEmailProps = {
	readonly locale: InviteEmailLocale;
	/** The opening line. Rendered first, above the heading. */
	readonly leadLine: string;
	/** True when the news is good — tints the lead line, nothing else. */
	readonly isFavourable: boolean;
	readonly heading: string;
	readonly amountLine: string;
	readonly restaurantLine: string | null;
	readonly orderLine: string | null;
	readonly whatHappenedLabel: string;
	readonly whatHappened: string;
	readonly whatNextLabel: string;
	readonly whatNext: string;
	readonly ctaLabel: string;
	readonly paymentsUrl: string;
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
	favourable: "#0f7b6c",
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

export default function DisputeEmail({
	locale,
	leadLine,
	isFavourable,
	heading,
	amountLine,
	restaurantLine,
	orderLine,
	whatHappenedLabel,
	whatHappened,
	whatNextLabel,
	whatNext,
	ctaLabel,
	paymentsUrl,
	footerWhy,
	footerSentBy,
	previewText,
}: Readonly<DisputeEmailProps>) {
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
							color: isFavourable ? colors.favourable : colors.text,
							fontSize: "17px",
							fontWeight: 700,
							lineHeight: "25px",
							margin: "0 0 12px",
						}}
					>
						{leadLine}
					</Text>

					<Heading
						as="h2"
						style={{ color: colors.text, fontSize: "18px", fontWeight: 700, margin: "0 0 12px" }}
					>
						{heading}
					</Heading>

					<Text style={{ ...bodyStyle, fontSize: "16px", margin: "0 0 4px" }}>{amountLine}</Text>

					{orderLine ? (
						<Text
							style={{
								color: colors.textSecondary,
								fontSize: "14px",
								lineHeight: "21px",
								margin: 0,
							}}
						>
							{orderLine}
						</Text>
					) : null}

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

					<Text style={labelStyle}>{whatHappenedLabel}</Text>
					<Text style={bodyStyle}>{whatHappened}</Text>

					<Text style={labelStyle}>{whatNextLabel}</Text>
					<Text style={bodyStyle}>{whatNext}</Text>

					<Section style={{ marginTop: "24px" }}>
						<Button
							href={paymentsUrl}
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
