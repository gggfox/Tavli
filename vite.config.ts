import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const config = defineConfig({
  // fsevents on macOS intermittently fails to deliver change notifications to
  // chokidar inside this dev stack (concurrently → vite under TanStack Start +
  // Nitro), so HMR silently dies even though the server is up. Polling is
  // ~10x more reliable in practice and the CPU cost on this repo is negligible.
  server: {
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
  plugins: [
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart({
      router: {
        // Test files colocated with route files (e.g. routes/foo.test.tsx)
        // are not routes — exclude them so the router-generator stops touching
        // routeTree.gen.ts on every test edit, which otherwise spams HMR and
        // can crash the dev server in a regenerate loop.
        routeFileIgnorePattern: String.raw`\.(test|spec)\.`,
      },
    }),
    nitro({
      // Rollup 4.53.3's native parser on Linux fails on React's long
      // hydration error strings. Externalizing React from Nitro's bundling
      // step avoids parsing those files entirely -- the server loads them
      // from node_modules at runtime via require().
      rollupConfig: {
        external: [/^react(\/.*)?$/, /^react-dom(\/.*)?$/],
      },
    }),
    viteReact({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
  ],
});

export default config;
