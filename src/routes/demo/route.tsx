import { config } from "@/global/utils/config";
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/demo")({
	beforeLoad: () => {
		if (!config.isDev) {
			throw notFound();
		}
	},
	component: () => <Outlet />,
});
