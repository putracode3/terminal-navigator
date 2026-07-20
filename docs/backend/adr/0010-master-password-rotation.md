# ADR-0010: Master password rotation via verify-then-atomic-re-encrypt

- **Status:** accepted
- **Date:** 2026-07-20
- **Drivers:** NFR-3, FR-13

## Context

FR-13 adds the ability to change the master password from the Settings panel. `ProjectStore` (architecture.md §5.1) already holds the derived key, salt, and data file path in memory once unlocked (ADR-0005); rotating the password means deriving a new key and re-encrypting the existing project data under it, without the possibility of leaving the on-disk file corrupted if the app crashes or is killed mid-write. `ProjectStore::persist()` today writes the encrypted envelope directly to `self.data_file` via `std::fs::write` — this is **not atomic**: a crash between opening the file for write and the write completing can leave a truncated, unreadable file. This was an existing latent gap even for ordinary saves (add/update/delete), but FR-13's password-change flow is where the PRD explicitly calls out the risk (an interrupted rotation must not corrupt the data blob).

## Options considered

### Option A — Rotation-only atomic write, ordinary saves unchanged
Add a special-cased atomic write path used only by the new `change_password` method; leave `persist()` (used by add/update/delete) as-is.

### Option B — Make `persist()` itself atomic (write-to-temp + rename), used by everything including rotation
Change the one shared `persist()` method to write the new envelope to a temp file in the same directory, then `std::fs::rename` it over `self.data_file` (atomic on the same filesystem on both Linux and Windows/macOS). `change_password` calls the same `persist()` after swapping `key`/`salt` in memory — no separate code path.

Option A would leave ordinary saves exposed to the exact same class of corruption FR-13 is trying to rule out for rotation specifically, for no real benefit — the fix is the same few lines either way.

## Decision

Implement Option B, and add `ProjectStore::change_password(&mut self, current_password: &str, new_password: &str) -> Result<(), ProjectStoreError>`:

1. Derive a candidate key from `current_password` + `self.salt`; compare to `self.key`. Mismatch → return an error (e.g. `ProjectStoreError::WrongPassword`) without touching anything on disk or in memory.
2. On match: generate a fresh salt (`crypto::generate_salt()`), derive the new key from `new_password` + that salt.
3. Replace `self.key` and `self.salt` in memory, then call `self.persist()` — now atomic (temp file + rename) — to write the envelope re-encrypted under the new key.
4. If `persist()` fails, the in-memory `key`/`salt` swap must be rolled back (or the store treated as needing re-unlock) so memory and disk never disagree about which password is current — see Consequences.

## Consequences

- The same atomic-write fix protects every save path (`add`, `update`, `delete`, `change_password`), not just rotation — a crash mid-write now always leaves either the old file or the new file intact, never a partial one.
- One more filesystem call per save (temp write + rename vs. a single write) — negligible at this app's scale (NFR-4).
- Requires the temp file to be created in the *same directory* as `data_file` (not a system temp dir) — `rename` is only atomic within the same filesystem/mount.
- If `persist()` fails after the in-memory key/salt swap (step 4), the running process now holds a key that doesn't match what's on disk. Mitigation: on that failure, immediately re-derive and restore the old key/salt in memory (rotation aborted, on-disk file is untouched since the failed write never replaced it) rather than leaving the process in a half-rotated state.
- **Revisit trigger:** none expected under normal use; revisit only if a future requirement needs rotation to also re-key the exported/git-synced copies (`config_sync`, ADR-0008) automatically — out of scope here, since export/import already require re-running with the current password by design.
