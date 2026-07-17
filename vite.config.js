import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit()],

  // Under Vitest, force the "browser" package export condition so Svelte
  // components compile for the client (not SSR) — otherwise
  // @testing-library/svelte's client-side mount() hits Svelte's server-only
  // stub and throws lifecycle_function_unavailable.
  // @ts-expect-error process is a nodejs global
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/lib/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{js,ts}"],
  },
}));
