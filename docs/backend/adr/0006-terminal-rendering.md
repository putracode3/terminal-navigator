# ADR-0006: Use xterm.js with the WebGL renderer addon

- **Status:** superseded (see "2026-07-21 revisit" below) — xterm.js's default renderer is now used app-wide
- **Date:** 2026-07-17
- **Drivers:** NFR-7, FR-08

## Context

Each pane (FR-08) needs a terminal emulator UI component running inside the Svelte frontend, rendering PTY output with full support for colors, control sequences, and interactive programs. The user explicitly asked for a lightweight, fast, memory-friendly app (NFR-7), and FR-08 means potentially several terminal instances rendering simultaneously in a grid.

## Options considered

### Option A — xterm.js, default DOM renderer
The industry-standard terminal frontend (used by VS Code, Hyper, and most Electron/web-based terminals). Default renderer draws to the DOM/canvas per character cell — correct and simple, but comparatively CPU/memory-heavy when multiple instances render concurrently.

### Option B — xterm.js with `@xterm/addon-webgl`
Same library, with an official addon that renders via WebGL instead of the default renderer — substantially lower CPU usage and better frame performance, particularly noticeable with multiple simultaneous terminal instances (exactly FR-08's scenario).

xterm.js itself was effectively uncontested as the base library (no serious competing alternative offers its maturity and ecosystem); the real decision is which of its renderers to use.

## Decision

Use `xterm.js` as the terminal component, with the `@xterm/addon-webgl` renderer enabled by default. Fall back to the default renderer only if WebGL context creation fails on the user's system (architecture.md §9, risk 2).

## Consequences

- Meaningfully lower CPU/memory cost per rendered pane, directly serving NFR-7 as pane count grows.
- Adds a runtime dependency on WebGL context availability in the webview (WebKitGTK on Linux) — must be verified early in implementation; a fallback path to the default renderer is cheap insurance.
- **Revisit trigger:** if WebGL proves unreliable across the author's actual target systems, fall back to the default DOM renderer app-wide — a one-line change in `terminal_view`, not an architectural change.

## 2026-07-21 revisit — WebGL disabled app-wide

The revisit trigger above fired. A debugging session (bug report: a full-screen TUI CLI rendering completely blank in a pane, later found to reproduce with *any* CLI at all — vim, htop, less, top, all of them) isolated the defect to `@xterm/addon-webgl` itself, independent of this app's PTY/env handling:

- Reproduced outside Tauri entirely, in a standalone harness (`xterm.js` + `@xterm/addon-webgl` wired up exactly as `TerminalPane.svelte` does), ruling out PTY/TERM/environment causes (the `ec19eff` bug class) from the start.
- The WebGL2 context itself is healthy — `isContextLost()` is `false`, `gl.getError()` is `0`, canvas/drawing-buffer dimensions are correct — but `gl.readPixels()` on the framebuffer shows it is **never actually painted to**: 100% black, for any content (plain text, not just alt-screen/full-redraw content), regardless of whether the addon is loaded before or after `term.open()`, and regardless of an explicit `term.refresh()` call after every write.
- A raw hand-written WebGL2 draw call in the same browser/GPU environment renders correctly (confirmed via `readPixels`), ruling out a GPU/driver/environment limitation — the defect is specific to `@xterm/addon-webgl`'s internal render pipeline.
- `@xterm/addon-webgl@0.19.0` and `@xterm/xterm@6.0.0` are each the `latest` dist-tag on npm and were published together (monorepo release, 2026-12-22) — this isn't a version-mismatch mistake in this app's `package.json`, it looks like a regression in that release pairing itself.
- The existing `try { … } catch {}` fallback (architecture.md §9 risk 2) does not catch this failure mode: addon construction and context creation both succeed without throwing, so the guard never triggers. §5.2's charter in `docs/qa/test-plan.md` (written to test exactly the *context-creation-fails* case) would not have caught this either — the fix and reasoning are recorded here and in that charter instead.

**New decision:** stop loading `WebglAddon` and use xterm.js's default renderer app-wide, per this ADR's own pre-approved revisit trigger. Revert to WebGL only once a `@xterm/addon-webgl` release newer than 0.19.0 is confirmed (via the same read-pixels method used here, not just "no console errors") to actually paint.

**Consequence:** NFR-7's original motivation for choosing WebGL (lower CPU/memory with several simultaneous panes) is no longer met by rendering — worth a lightweight check if FR-08's multi-pane scenario is ever reported as sluggish, but not a blocker; the default renderer is xterm.js's own well-exercised path, same as most Electron-based terminals (Hyper, VS Code's non-WebGL fallback) run by default.
