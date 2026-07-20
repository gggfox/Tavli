import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const config = defineConfig(({ command }) => {
  // When no Clerk publishable key is configured, Clerk silently provisions a
  // throwaway "keyless" instance instead of failing. Sign-in then *succeeds*
  // against that instance — but it has no `convex` JWT template and its issuer
  // is not the one the Convex deployment trusts (CLERK_JWT_ISSUER_DOMAIN), so
  // Convex never authenticates and the app renders as signed out. The visible
  // symptom is "sign in bounces me back to the landing page".
  //
  // Dev servers must therefore be started with real keys (`pnpm dev` pulls them
  // from Infisical `dev`). Disabling keyless turns a missing key into a loud
  // "Clerk: no secret key provided" SSR error instead of fake auth.
  if (command === "serve") {
    process.env.VITE_CLERK_KEYLESS_DISABLED ??= "1";
  }

  return {
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
      nitro(),
      viteReact({
        babel: {
          plugins: [["babel-plugin-react-compiler", {}]],
        },
      }),
    ],
  };
});

export default config;
