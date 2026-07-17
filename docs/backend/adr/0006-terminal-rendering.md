# ADR-0006: Use xterm.js with the WebGL renderer addon

- **Status:** accepted
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
