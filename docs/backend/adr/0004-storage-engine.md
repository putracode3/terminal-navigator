# ADR-0004: Use a single encrypted file as the storage engine

- **Status:** accepted
- **Date:** 2026-07-17
- **Drivers:** NFR-3, NFR-4, NFR-5, NFR-6, CON-2, CON-4

## Context

`project_store` needs to persist the project list (path, commands, notes) across restarts, encrypted at rest (NFR-3), portable across devices via git or export/import (NFR-5), at personal scale only — tens to low hundreds of entries (NFR-4). The author is new to Rust (NFR-6, CON-2) and dependencies must stay free/open-source (CON-4).

## Options considered

### Option A — Single encrypted file
Serialize the whole project list (e.g. via `serde` to JSON or `bincode`), encrypt the resulting bytes as one blob with AES-256-GCM, write/read as a single file. No query engine involved.

### Option B — SQLite + SQLCipher
Structured relational storage, easy to extend with queries/indexes as the data model grows (e.g. future FR-11 grouping/folders). Requires SQLCipher (or app-level per-field encryption) for NFR-3, which typically means linking a C library (OpenSSL or similar) — a real source of cross-platform build pain, especially for someone building their first Rust project.

## Decision

Use a single encrypted file. At this app's realistic scale (NFR-4), the entire dataset comfortably fits in memory and serializes near-instantly, so SQLite's query advantages buy nothing yet. The file format is also a direct, zero-extra-work fit for NFR-5: the encrypted blob itself is the exportable, git-trackable artifact — no separate export/import format needs to be designed. Avoiding SQLCipher's C-library linking removes a real beginner pitfall (NFR-6, CON-2), and both `serde`/`bincode` and `aes-gcm` are free, pure-Rust, actively maintained crates (CON-4).

## Consequences

- Zero database engine, zero C-library linking — simplest possible build/dependency story for a first Rust project.
- The data file doubles as the export/sync artifact (FR-07) with no extra format work.
- No indexed queries, no partial reads/writes — every save rewrites the whole file. Acceptable at NFR-4's scale; would become a real cost far beyond it.
- Committing an encrypted binary blob to git (NFR-5's git-sync path) means diffs are opaque — the user only ever sees "changed" or "unchanged," not what changed. Accepted as a reasonable trade for simplicity and security.
- **Revisit trigger:** if the project list genuinely grows well beyond personal scale (NFR-4's ceiling), or the data model needs relational queries (e.g. filtering by tag/group across a very large list) — at that point, migrate `project_store`'s persistence backend to SQLite; no other module is coupled to the storage format (architecture.md §8).
