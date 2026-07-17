# ADR-0003: Use `portable-pty` for PTY management

- **Status:** accepted
- **Date:** 2026-07-17
- **Drivers:** NFR-6, CON-5

## Context

`pty_manager` needs to spawn a real pseudo-terminal per pane (FR-03, FR-08) that behaves like a normal interactive shell — colors, control sequences, interactive programs (e.g. `vim`, `docker-compose up` with live output) must all work. The author is new to Rust (NFR-6) and wants the door left open for optional future Windows/macOS support (CON-5).

## Options considered

### Option A — `portable-pty`
Part of the WezTerm project; mature, actively maintained, cross-platform (Linux/macOS/Windows via ConPTY), proven in a real production terminal emulator used by many people. Synchronous-style API, straightforward to wrap in a thread per session.

### Option B — `pty-process`
Newer crate with a Tokio-async-native API — arguably more idiomatic if the rest of the app is async-heavy, but smaller community, less battle-tested, and cross-platform (especially Windows) support is less proven.

## Decision

Use `portable-pty`. Its production pedigree (WezTerm) and built-in cross-platform support directly serve NFR-6 (mature, well-documented, less risk of obscure bugs for a Rust beginner) and CON-5 (Windows support arrives for free later, no rework needed).

## Consequences

- One well-trodden path for spawning/reading/writing PTYs across all three major OSes.
- Synchronous-style API means `pty_manager` will run each session's read loop on its own OS thread rather than as a Tokio task — a small deviation from an all-async design, acceptable at this app's scale (a handful of concurrent sessions, not thousands).
- **Revisit trigger:** if the app's overall architecture becomes heavily async/Tokio-based elsewhere and the sync/async mismatch becomes a real maintenance friction — not expected at this project's scale.
