import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

// Real-device testing (BrowserStack Live) reaches the dev server through the
// BrowserStackLocal tunnel, which resolves bs-local.com to 127.0.0.1 and sends
// that Host header. Vite's defaults break both halves: it binds [::1] only, so
// the IPv4 connection is refused, and its host check 403s bs-local.com. Opt in
// via `pnpm dev:device` rather than always — a plain `pnpm dev` should stay on
// loopback instead of being exposed to whatever network you're on.
const deviceTesting = process.env.DEVICE_TESTING === "1";

const config = defineConfig({
  // fsevents on macOS intermittently fails to deliver change notifications to
  // chokidar inside this dev stack (concurrently → vite under TanStack Start +
  // Nitro), so HMR silently dies even though the server is up. Polling is
  // ~10x more reliable in practice and the CPU cost on this repo is negligible.
  server: {
    ...(deviceTesting && {
      host: true,
      allowedHosts: ["bs-local.com"],
    }),
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
    nitro(),
    viteReact({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
  ],
});

export default config;
