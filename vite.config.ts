import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const config = defineConfig({
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
