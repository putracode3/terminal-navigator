# ADR-0001: Use a single Tauri desktop app, modular monolith

- **Status:** accepted
- **Date:** 2026-07-17
- **Drivers:** NFR-2, NFR-4, CON-1, CON-2

## Context

Terminal Navigator is a single-user tool: one person, one machine, no concurrent access, no network exposure. There is no availability requirement (NFR-2), no scale beyond a personal project list (NFR-4), and the author is a solo developer new to this stack (CON-1, CON-2) who benefits from the fewest moving parts possible.

## Options considered

### Option A — Modular monolith (single Tauri app)
Rust backend organized into cohesive modules (project storage, crypto, PTY management) behind one process, paired with a webview frontend. One binary, one install.

### Option B — Split backend service + frontend app
A separate long-running backend process (e.g. local HTTP/gRPC server) that the Tauri frontend talks to over a socket, allowing the backend to be reused by other frontends later.

Only Option A was ever realistically viable here: there is no second frontend, no multi-machine access, and no NFR that asks for the backend to run independently of the UI. Option B would add process management, IPC-over-network complexity, and a whole class of "backend running / not running" bugs with zero benefit.

## Decision

Build Terminal Navigator as a single Tauri application: Rust backend split into cohesive, single-responsibility modules (§5 of architecture.md), talking to a Svelte frontend purely through Tauri's built-in IPC (`invoke` + events). No separate backend process.

## Consequences

- Simplest possible deployment: one installed app, one process, no daemon to manage.
- Module boundaries are enforced by convention/code review, not by process isolation — a bug in one module can in principle affect the whole process (acceptable given local-only, single-user risk profile).
- If a genuine need for a standalone backend ever appears (e.g. wanting a CLI that shares logic with the GUI), revisit — the module boundaries in §5 are already drawn as if they could be extracted, minimizing future cost.
- **Revisit trigger:** a real requirement emerges for something other than the Tauri GUI to use this data/logic (e.g. a companion CLI).
