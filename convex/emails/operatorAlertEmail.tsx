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

export type OperatorAlertEmailProps = {
	readonly locale: InviteEmailLocale;
	readonly heading: string;
	readonly alertTitle: string;
	readonly explanation: string;
	readonly severityLine: string;
	readonly restaurantLine: string | null;
	readonly referenceLine: string | null;
	readonly ctaLabel: string;
	readonly alertsUrl: string;
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
	severe: "#b3261e",
};

export default function OperatorAlertEmail({
	heading,
	alertTitle,
	explanation,
	severityLine,
	restaurantLine,
	referenceLine,
	ctaLabel,
	alertsUrl,
	footerWhy,
	footerSentBy,
	previewText,
}: Readonly<OperatorAlertEmailProps>) {
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
							margin: "0 0 8px",
						}}
					>
						Tavli
					</Heading>

					<Text
						style={{
							color: colors.severe,
							fontSize: "13px",
							fontWeight: 700,
							letterSpacing: "0.04em",
							textTransform: "uppercase",
							margin: "0 0 16px",
						}}
					>
						{heading}
					</Text>

					<Heading
						as="h2"
						style={{
							color: colors.text,
							fontSize: "18px",
							fontWeight: 700,
							margin: "0 0 12px",
						}}
					>
						{alertTitle}
					</Heading>

					<Text
						style={{ color: colors.text, fontSize: "16px", lineHeight: "24px", margin: "0 0 16px" }}
					>
						{explanation}
					</Text>

					<Text
						style={{
							color: colors.textSecondary,
							fontSize: "15px",
							lineHeight: "22px",
							margin: "0 0 8px",
						}}
					>
						{severityLine}
					</Text>

					{restaurantLine ? (
						<Text
							style={{
								color: colors.textSecondary,
								fontSize: "15px",
								lineHeight: "22px",
								margin: "0 0 8px",
							}}
						>
							{restaurantLine}
						</Text>
					) : null}

					{referenceLine ? (
						<Text
							style={{
								color: colors.textSecondary,
								fontSize: "15px",
								lineHeight: "22px",
								margin: "0 0 24px",
							}}
						>
							{referenceLine}
						</Text>
					) : (
						<Section style={{ marginBottom: "24px" }} />
					)}

					<Button
						href={alertsUrl}
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
