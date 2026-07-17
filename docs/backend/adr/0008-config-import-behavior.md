# ADR-0008: MVP config import is replace-only, not merge

- **Status:** accepted
- **Date:** 2026-07-17
- **Drivers:** NFR-5, ADR-0004

## Context

FR-07 requires importing a config file (from export or a git-synced copy) on another device. Because storage is a single encrypted file holding the entire project list as one unit (ADR-0004), the app needs to decide what "import" does when local data already exists: merge the incoming list with the existing one, or replace the existing one wholesale. This was left as an open question (PRD §10, Q2) at PRD time.

## Options considered

### Option A — Replace-only
Importing a file fully replaces the current local data with the imported file's contents (after validating it decrypts correctly with the current master password). No merge logic.

### Option B — Merge
Importing attempts to reconcile the incoming project list with the existing one (e.g. by project path or ID), asking the user to resolve conflicts where entries differ. Requires designing a conflict-resolution UX and diffing logic.

## Decision

MVP import is replace-only. Given the single-file storage model (ADR-0004), "the file is the whole state" is the natural and simplest semantic — it matches how the user already thinks about syncing via git (a git pull replaces the file; import should behave the same way).

## Consequences

- Trivial to implement and reason about: import = decrypt-validate, then overwrite.
- Risk of accidental data loss if a user imports an older file over newer local changes without realizing it — mitigate at the UI level (design-implementer/ui-ux-designer) with a clear warning before overwrite, and by recommending export-before-import as a habit.
- No conflict-resolution UX needed for MVP.
- **Revisit trigger:** if the user actually experiences the two-devices-diverged problem in practice (e.g. added different projects on two machines between syncs) — add merge logic as a next-iteration feature at that point, not speculatively now.
