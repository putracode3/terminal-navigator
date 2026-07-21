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

  // Debugger session 2026-07-22: `npm run tauri build`'s production bundle
  // (esbuild minification, Vite's default for `vite build`) corrupts
  // @xterm/xterm's InputHandler.requestMode() — valid, correct source
  // (verified by rebuilding with minify:false and reading the output: a
  // perfectly ordinary `requestMode(e, i) { let r; (...)(r || (r = {})); ...
  // return i ? ... }`, no undeclared variables) comes out of esbuild's
  // minifier throwing `ReferenceError: Can't find variable: i` at runtime —
  // every time, reproduced across multiple clean rebuilds. requestMode()
  // runs whenever PTY output includes a DECRQM "request mode" query, which
  // is near-universal startup terminal-capability negotiation for
  // full-screen TUIs (vim, htop, less, top, opencode, ...) — the exception
  // is thrown mid-parse inside the write pipeline
  // (_innerWrite → parse → parse → requestMode), corrupting the terminal's
  // parser state, leaving the pane blank and unresponsive to input for the
  // rest of that session. `npm run tauri dev` never hits this: Vite's dev
  // server uses esbuild for dependency *pre-bundling* only, a materially
  // different code path from `vite build`'s minification pass.
  // This is a bundler/minifier bug, not anything under this app's control —
  // disabling minification sidesteps it entirely. Cost is a larger local JS
  // bundle, irrelevant for a single-developer desktop app bundled into an
  // 18MB+ binary (no network transfer to optimize for). Revisit if a Vite
  // upgrade demonstrably fixes the minifier bug (verify by re-enabling
  // minify and confirming requestMode() still works via
  // docs/qa/test-plan.md's launch-environment charter §5.1, not just by
  // reading the changelog).
  build: { minify: false },

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
    // SvelteKit's vite plugin restricts dev-server file serving to src/,
    // .svelte-kit/, and node_modules/ by default. tokens.css lives in
    // docs/design/ (the design system's single source of truth — never
    // duplicated into src/, see docs/design/design.md §0), so it must be
    // explicitly allowed or every `var(--...)` in the app silently resolves
    // to nothing in `tauri dev` (production `tauri build` bundles it fine;
    // only the dev server's raw file serving was affected).
    fs: {
      allow: ["docs"],
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/lib/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{js,ts}"],
  },
}));
