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

## Addendum — 2026-09-25: output and exit are held until the frontend attaches

**Problem (reproduced 3/3 in the installed 0.2.1 build):** the decision above has the backend emit `pty://output/{session_id}` (and `pty://exit/{session_id}`) events as soon as the program writes. The pane's `listen()` calls are registered asynchronously *after* the pane mounts, and Tauri events emitted while no listener exists are not queued. Whatever a program printed in its first moments was lost, and a shell that died that early never closed its pane. A stand-in `$SHELL` printing three lines at t=0 and three at t=4 showed only the last three. Also why a full-screen program that entered the alternate screen at t=0 was never seen in the alternate buffer.

**Decision:** each session's output and exit notification pass through an `OutputGate` inside `pty_manager`.
- Until the frontend calls the new `attach_terminal(session_id)` command, chunks are **held** (in order) and the exit is remembered. On attach the gate flushes the held chunks, then a pending exit, then streams live. One mutex guards the sink, the `attached` flag and the buffer together and is held while flushing, so a chunk racing the attach is either held or emitted, never both, and never overtakes a held chunk.
- The frontend calls `attach_terminal` once, from a session's **first** mount, after **both** of its listeners have resolved. A remount reuses the session's handle and does not attach again (the gate is per session and already open).
- `attach_terminal` is **not an error for an unknown session**: `open_terminal` and `attach_terminal` are fired concurrently, so attach can arrive first. The request is remembered (bounded set, 256 entries; cleared when full) and `spawn` applies it under the same lock `attach` uses to look the session up. Idempotent.
- **Bounded:** at most 1 MiB is held. Past that the *oldest* whole chunks are dropped, so a flood before attach leaves the most recent output. Real early output is a prompt or a few lines; the cap only guards memory. Accepted edge cases: whole-chunk dropping can cut an escape sequence in half, and a single chunk larger than the cap (impossible in practice: one pty read is at most ~12 KB) would be dropped too.
- **Callbacks run under the gate lock,** so they must be quick and must not call back into `pty_manager`; today they only `emit` a Tauri event. `emit` does not wait on the main thread in this build, but would with Tauri's `tracing` feature — so `attach_terminal` is an `async` command and never runs on the main thread.
- **Never stuck muted:** if attach never arrives (listener registration failed, pane torn down mid-mount), the gate opens itself once 10 s have passed since the session was created — the next chunk or the exit releases it. Nothing is lost that was still held.
- `close` frees the gate with the session and forgets any pending attach for it.

**Consequences:** one new IPC command (takes only a session id, touches no project data, same class as `write_terminal`). Every caller of `pty_manager::spawn` now depends on `attach` for output to flow, which is why its own tests attach explicitly. Output emitted between the 10 s timeout and a listener that never registers is still lost, as before, but that is a failed frontend, not a race. Alternatives rejected: (a) sequencing the frontend so the pane mounts and listens before `open_terminal` is invoked — spreads a backend ordering guarantee across two components and still races on remount/split; (b) a polling replay buffer — more state, no stronger guarantee.
