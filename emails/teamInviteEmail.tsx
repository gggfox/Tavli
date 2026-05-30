import TeamInviteEmailComponent, {
	type TeamInviteEmailProps,
} from "../convex/emails/teamInviteEmail";

export default function TeamInviteEmail(props: Readonly<TeamInviteEmailProps>) {
	return <TeamInviteEmailComponent {...props} />;
}

TeamInviteEmail.PreviewProps = {
	locale: "en",
	greeting: "Hi Alex,",
	bodyIntro: "You've been invited to join Acme Restaurants on Tavli.",
	bodyRole: "Role: Restaurant manager",
	bodyRestaurants: "Restaurants: Downtown, Midtown",
	bodyInviter: "Invited by jane@example.com",
	ctaLabel: "Accept invitation",
	acceptUrl: "http://localhost:3000/invites/sample-token",
	expiresLine: "This invitation expires on June 6, 2026 at 3:00 PM.",
	footerIgnore: "If you didn't expect this invitation, you can safely ignore this email.",
	footerSentBy: "Sent by Tavli",
	previewText: "Accept your invitation to join the team on Tavli",
} satisfies TeamInviteEmailProps;
