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

export type TeamInviteEmailProps = {
	readonly locale: InviteEmailLocale;
	readonly greeting: string;
	readonly bodyIntro: string;
	readonly bodyRole: string;
	readonly bodyRestaurants: string | null;
	readonly bodyInviter: string | null;
	readonly ctaLabel: string;
	readonly acceptUrl: string;
	readonly expiresLine: string;
	readonly footerIgnore: string;
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
};

export default function TeamInviteEmail({
	greeting,
	bodyIntro,
	bodyRole,
	bodyRestaurants,
	bodyInviter,
	ctaLabel,
	acceptUrl,
	expiresLine,
	footerIgnore,
	footerSentBy,
	previewText,
}: Readonly<TeamInviteEmailProps>) {
	return (
		<Html lang="en">
			<Head />
			<Preview>{previewText}</Preview>
			<Body style={{ backgroundColor: colors.bg, margin: 0, padding: "32px 16px", fontFamily: "Arial, sans-serif" }}>
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
							margin: "0 0 24px",
						}}
					>
						Tavli
					</Heading>

					<Text style={{ color: colors.text, fontSize: "16px", lineHeight: "24px", margin: "0 0 16px" }}>
						{greeting}
					</Text>

					<Text style={{ color: colors.text, fontSize: "16px", lineHeight: "24px", margin: "0 0 12px" }}>
						{bodyIntro}
					</Text>

					<Text style={{ color: colors.textSecondary, fontSize: "15px", lineHeight: "22px", margin: "0 0 8px" }}>
						{bodyRole}
					</Text>

					{bodyRestaurants ? (
						<Text style={{ color: colors.textSecondary, fontSize: "15px", lineHeight: "22px", margin: "0 0 8px" }}>
							{bodyRestaurants}
						</Text>
					) : null}

					{bodyInviter ? (
						<Text style={{ color: colors.textSecondary, fontSize: "15px", lineHeight: "22px", margin: "0 0 24px" }}>
							{bodyInviter}
						</Text>
					) : (
						<Section style={{ marginBottom: "24px" }} />
					)}

					<Button
						href={acceptUrl}
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
							fontSize: "13px",
							lineHeight: "20px",
							margin: "24px 0 0",
						}}
					>
						{expiresLine}
					</Text>

					<Text
						style={{
							color: colors.textSecondary,
							fontSize: "12px",
							lineHeight: "18px",
							margin: "16px 0 0",
							borderTop: `1px solid ${colors.border}`,
							paddingTop: "16px",
						}}
					>
						{footerIgnore}
					</Text>

					<Text style={{ color: colors.textSecondary, fontSize: "12px", lineHeight: "18px", margin: "8px 0 0" }}>
						{footerSentBy}
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export type { InviteEmailRole } from "./copy";
