/**
 * PROTOTYPE — standalone SPA for src/features/menus/prototype-editor.
 * No TanStack Start, Nitro, Clerk or Convex: mock data only, so it runs
 * without Infisical. `pnpm proto:menu`. Branch proto/* only.
 */
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	root: "src/features/menus/prototype-editor",
	server: { port: 3101, strictPort: true, open: false },
	plugins: [viteTsConfigPaths({ projects: ["../../../../tsconfig.json"] }), tailwindcss(), viteReact()],
});
