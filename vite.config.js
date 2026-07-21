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

  // Minify with terser instead of Vite's default (esbuild). Debugger session
  // 2026-07-22: esbuild's minifier miscompiles @xterm/xterm's
  // InputHandler.requestMode(). The source is an ordinary TS enum-shim
  // pattern —
  //     requestMode(e, i) { let r; ((P) => (...))(r || (r = {})); ... }
  // — but esbuild's minifier constant-folds the *read* of the never-
  // previously-assigned `r` to `void 0`, drops the `let r` declaration as
  // dead, yet leaves the *write* as an assignment to a bare `i`
  // (`(void 0 || (i = {}))`) — a name no longer in scope (the `i` param was
  // renamed to `t`). In an ES module (strict mode) that throws
  // `ReferenceError: Can't find variable: i` at runtime. requestMode() runs
  // whenever PTY output includes a DECRQM "request mode" query — near-
  // universal startup terminal-capability negotiation for full-screen TUIs
  // (vim, htop, less, top, opencode, ...) — so the exception is thrown mid-
  // parse inside the write pipeline (_innerWrite → parse → requestMode),
  // corrupting the parser and leaving the pane blank and unresponsive to
  // input for the rest of that session. `npm run tauri dev` never hit this:
  // Vite's dev server runs esbuild only for dependency *pre-bundling*, a
  // different code path from `vite build`'s minify pass.
  //
  // terser (verified: rebuilt, grepped the output, and ran the actual .deb
  // with a real TUI) minifies the same method correctly — it keeps the
  // enum-var declaration (`let i; var s; (s = i || (i = {}))`), so the
  // assignment target is declared and nothing throws. Bundle size is
  // identical to esbuild's (~512 KB, vs ~812 KB unminified) — so this keeps
  // full minification / NFR-7 (lightweight, memory-friendly), unlike the
  // earlier stop-gap of disabling minification entirely (commit c10a2f5,
  // superseded by this). Requires the `terser` devDependency.
  //
  // Revisit only if a future Vite/esbuild upgrade is confirmed to fix the
  // esbuild bug — verify by switching back to esbuild AND running a real
  // full-screen TUI in the built .deb per docs/qa/test-plan.md §5.1a, never
  // by reading a changelog alone.
  // JSDoc cast (this is a .js file, so no `as const`): without pinning the
  // literal, TS widens "terser" to `string`, which doesn't match Vite's
  // `minify: 'esbuild' | 'terser' | boolean` union and makes svelte-check
  // error on the config-function overload.
  build: { minify: /** @type {"terser"} */ ("terser") },

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
