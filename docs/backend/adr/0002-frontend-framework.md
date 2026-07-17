# ADR-0002: Use Svelte for the frontend

- **Status:** accepted
- **Date:** 2026-07-17
- **Drivers:** NFR-6, NFR-7, FR-08

## Context

The frontend renders a project list, a tab + split-pane terminal grid (FR-08 — potentially several `xterm.js` instances live at once), and settings/notes views. The author is new to Rust and Tauri (NFR-6) and explicitly asked for the app to be lightweight, fast, and memory-friendly (NFR-7) — a concern sharpened by FR-08's multi-pane rendering.

## Options considered

### Option A — React
Largest Tauri-specific tutorial/community base by far, which helps NFR-6. But ships a virtual-DOM runtime and generally larger bundle/memory footprint than compile-time frameworks — works against NFR-7, especially with many simultaneous terminal panes each holding component state.

### Option B — Svelte
Compiles components to vanilla JS at build time — no virtual DOM, smaller runtime, lower memory footprint. Directly serves NFR-7. Smaller Tauri-specific tutorial base than React, but Tauri's official `create-tauri-app` scaffolding supports it fully, keeping NFR-6 risk manageable.

### Option C — Vanilla TypeScript (no framework)
Lightest possible option for NFR-7, but pushes all tab/pane state management (FR-08) onto hand-rolled code — adds a second large "figure it out myself" surface on top of learning Rust/Tauri, working against NFR-6.

## Decision

Use Svelte for the frontend. Initially React was the working default for NFR-6 alone; once the user raised NFR-7 explicitly, Svelte's structural advantage (no virtual DOM, smaller runtime) outweighed React's larger tutorial base, given FR-08 makes rendering-many-panes a real, not hypothetical, concern.

## Consequences

- Lower baseline memory/CPU use, especially as pane count grows (NFR-7).
- Official Tauri + Svelte template exists, so scaffolding risk is low despite Svelte's smaller community versus React (NFR-6 partially preserved).
- Fewer Svelte-specific answers to lean on if the author gets stuck versus React's ecosystem size — mitigate by leaning on Tauri's own docs/Discord first.
- **Revisit trigger:** if the author finds Svelte-specific blockers unresolvable within a reasonable session or two, React remains a viable fallback — the module boundary between frontend and backend (§5) means switching frameworks does not touch Rust code.
