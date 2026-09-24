/**
 * PROTOTYPE — standalone SPA for src/features/restaurants/prototype-settings.
 * No TanStack Start, Nitro, Clerk or Convex: mock data only, so it runs
 * without Infisical. `pnpm proto:settings`. Branch proto/* only.
 */
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	root: "src/features/restaurants/prototype-settings",
	server: { port: 3100, strictPort: true, open: false },
	plugins: [viteTsConfigPaths({ projects: ["../../../../tsconfig.json"] }), tailwindcss(), viteReact()],
});
