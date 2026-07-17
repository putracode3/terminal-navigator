# ADR-0007: One PTY session per pane, addressed by session ID over Tauri IPC/events

- **Status:** accepted
- **Date:** 2026-07-17
- **Drivers:** FR-08, NFR-7

## Context

FR-08 requires tabs and split-panes, each running an independent terminal. The frontend (`layout_manager`, `terminal_view`) and backend (`pty_manager`) need a shared, simple contract for how a pane maps to a running shell process, and how output/input flow between them across the Tauri IPC boundary.

## Options considered

### Option A — One `PtySession` per pane, keyed by a session ID
Frontend requests `spawn_pty(path, session_id)`; backend creates and tracks a `PtySession` under that ID; output streams back via a Tauri event scoped to that ID; input goes back via `invoke` calls scoped to that ID. Each pane's `terminal_view` instance owns exactly one session ID and knows nothing about any other pane.

### Option B — A single multiplexed backend session with virtual sub-channels
One backend-managed multiplexer fans a single connection out to multiple logical terminals (shell-multiplexer style, akin to how `tmux` itself works internally). More "efficient" in theory, but adds a custom multiplexing protocol to build and debug — real complexity with no NFR asking for it.

Option B was considered because it's how tools like tmux/Tilix work under the hood, but it was rejected: Tauri's IPC already provides per-event addressing for free, so a custom multiplexing layer would only add risk (working against NFR-6) for no measurable benefit at this app's scale.

## Decision

Each pane maps 1:1 to its own `PtySession`, identified by a session ID generated when the pane is created. `pty_manager` owns the full lifecycle (spawn → stream → teardown) of each session independently; there is no shared state between sessions beyond both existing in the same `pty_manager` module.

## Consequences

- Simple mental model: closing a pane tears down exactly one session; a hang or crash in one pane's shell cannot affect any other pane.
- Scales fine for FR-08's realistic pane counts (a handful per tab); would not be the right model for hundreds of simultaneous sessions, which is not this app's use case (NFR-4).
- **Revisit trigger:** none expected; this is a stable, low-risk pattern for the app's entire realistic lifetime.
