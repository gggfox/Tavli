import { configDefaults, defineConfig } from "vitest/config";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    viteReact(),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Git worktrees are full duplicate checkouts — without excluding them vitest
    // discovers every test twice, and the copies resolve `@/` aliases back to
    // this checkout while reading their own stale fixtures, which surfaces as
    // phantom failures. Agent worktrees land in .claude/worktrees/.
    exclude: [
      ...configDefaults.exclude,
      "e2e/**/*",
      "**/e2e/**",
      "**/.worktrees/**",
      "**/.claude/worktrees/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
    },
  },
});
