import { existsSync, readFileSync } from "node:fs";
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

// Device testing must be served over TLS: http://bs-local.com is an insecure
// context, so crypto.subtle is missing and clerk-js never initializes — auth
// flows can't be exercised on-device at all. `pnpm dev:device` generates a
// self-signed cert via scripts/ensure-dev-cert.mjs; Automate runs accept it
// with the acceptInsecureCerts capability.
const devCert = "tmp/dev-certs/cert.pem";
const devKey = "tmp/dev-certs/key.pem";
const deviceHttps =
  deviceTesting && existsSync(devCert) && existsSync(devKey)
    ? { cert: readFileSync(devCert), key: readFileSync(devKey) }
    : undefined;

// Vite 7 always serves https via http2.createSecureServer, but nitro's dev
// middleware (srvx) writes HTTP/1 connection-specific headers ("keep-alive"),
// which HTTP/2 forbids — the first request kills the whole dev server with
// ERR_HTTP2_INVALID_CONNECTION_HEADERS. There is no config switch back to
// HTTPS/1.1 anymore, so this plugin (registered ahead of nitro()) wraps the
// response and drops the forbidden headers on h2 requests.
const stripH2ForbiddenHeaders = () => {
  const FORBIDDEN = /^(connection|keep-alive|proxy-connection|transfer-encoding|upgrade)$/i;
  return {
    name: "device-testing:strip-h2-forbidden-headers",
    apply: "serve" as const,
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if ((req.httpVersionMajor ?? 1) >= 2) {
          const writeHead = res.writeHead.bind(res);
          res.writeHead = (status: number, arg2?: unknown, arg3?: unknown) => {
            const filter = (h: unknown) => {
              if (h && typeof h === "object") {
                for (const k of Object.keys(h)) {
                  if (FORBIDDEN.test(k)) delete (h as Record<string, unknown>)[k];
                }
              }
              return h;
            };
            if (arg2 && typeof arg2 === "object") return writeHead(status, filter(arg2) as never);
            return writeHead(status, arg2 as never, filter(arg3) as never);
          };
          const setHeader = res.setHeader.bind(res);
          res.setHeader = (name: string, value: never) =>
            FORBIDDEN.test(name) ? res : setHeader(name, value);
        }
        next();
      });
    },
  };
};

const config = defineConfig({
  // fsevents on macOS intermittently fails to deliver change notifications to
  // chokidar inside this dev stack (concurrently → vite under TanStack Start +
  // Nitro), so HMR silently dies even though the server is up. Polling is
  // ~10x more reliable in practice and the CPU cost on this repo is negligible.
  server: {
    ...(deviceTesting && {
      host: true,
      // bs-local.com: BrowserStackLocal tunnel. .trycloudflare.com: cloudflared
      // quick tunnel (real cert — iOS Safari can't be automated past the
      // self-signed interstitial, so device auth flows go through this).
      allowedHosts: ["bs-local.com", ".trycloudflare.com"],
      ...(deviceHttps && { https: deviceHttps }),
    }),
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
  plugins: [
    ...(deviceHttps ? [stripH2ForbiddenHeaders()] : []),
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
