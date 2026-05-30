import { describe, expect, it } from "vitest";
import { renderTeamInviteEmail } from "./renderTeamInviteEmail";

const baseContext = {
	inviteeEmail: "alex@example.com",
	inviteeFirstName: "Alex",
	organizationName: "Acme Restaurants",
	restaurantNames: ["Downtown", "Midtown"] as string[],
	inviterDisplayName: "Jane Doe",
	acceptUrl: "http://localhost:3000/invites/test-token",
	expiresAt: new Date("2026-06-06T15:00:00Z").getTime(),
};

describe("renderTeamInviteEmail", () => {
	it("renders English invite with org name, role label, and accept URL", async () => {
		const { subject, html, text } = await renderTeamInviteEmail({
			...baseContext,
			locale: "en",
			role: "manager",
		});

		expect(subject).toContain("Acme Restaurants");
		expect(subject).toContain("Tavli");
		expect(html).toContain("Restaurant manager");
		expect(html).toContain("http://localhost:3000/invites/test-token");
		expect(html).toContain("Downtown");
		expect(text).toContain("http://localhost:3000/invites/test-token");
		expect(text).toContain("Jane Doe");
	});

	it("renders Spanish invite with localized role label", async () => {
		const { subject, html, text } = await renderTeamInviteEmail({
			...baseContext,
			locale: "es",
			role: "employee",
		});

		expect(subject).toContain("Acme Restaurants");
		expect(subject).toContain("Tavli");
		expect(html).toContain("Empleado");
		expect(html).toContain("Aceptar invitación");
		expect(text).toContain("http://localhost:3000/invites/test-token");
	});

	it("uses email as greeting when first name is missing", async () => {
		const { html } = await renderTeamInviteEmail({
			...baseContext,
			locale: "en",
			role: "owner",
			inviteeFirstName: undefined,
		});

		expect(html).toContain("alex@example.com");
		expect(html).toContain("Organization owner");
	});

	it("omits restaurant and inviter lines when not provided", async () => {
		const { html } = await renderTeamInviteEmail({
			...baseContext,
			locale: "en",
			role: "owner",
			restaurantNames: [],
			inviterDisplayName: null,
		});

		expect(html).not.toContain("Restaurants:");
		expect(html).not.toContain("Invited by");
	});
});
