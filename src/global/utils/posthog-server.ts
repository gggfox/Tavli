import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

export function getPostHogClient(): PostHog {
	if (!posthogClient) {
		posthogClient = new PostHog(
			process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN ||
				import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN!,
			{
				host:
					process.env.VITE_PUBLIC_POSTHOG_HOST ||
					import.meta.env.VITE_PUBLIC_POSTHOG_HOST ||
					"https://us.i.posthog.com",
				flushAt: 1,
				flushInterval: 0,
			}
		);
	}
	return posthogClient;
}
