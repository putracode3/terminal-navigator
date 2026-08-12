# ADR-0014: Remove master-password encryption; one-time migration to plaintext storage

- **Status:** accepted
- **Date:** 2026-08-12
- **Drivers:** direct product decision (routed via project-navigator → system-architect), supersedes NFR-3, ADR-0005, ADR-0010
- **Supersedes:** ADR-0005 (Master password with Argon2id + AES-256-GCM), ADR-0010 (Master password rotation)

## Context

ADR-0005 committed to a master password entered on every launch, explicitly accepting that friction over an OS-keychain auto-unlock, in service of NFR-3 ("stored data may contain credentials; must be encrypted at rest"). In practice, after living with the app as a daily driver, the author reports the password prompt is not efficient to use day-to-day — the friction ADR-0005 knowingly accepted has turned out to cost more than the confidentiality guarantee is worth for this single-user, single-machine tool.

Two narrower alternatives were discussed first (project-navigator → system-architect intake, 2026-08-11/12) before landing here:
1. An enable/disable toggle for password protection, with the disabled state either storing plaintext or encrypting under an app-managed (non-secret) key.
2. Keeping the master password mandatory but adding a 5-minute in-memory session grace period so it isn't re-requested on every unlock-gated action.

The author's final decision, once the actual scope of what the password protects was clarified (it only ever gated one file — the project list's paths/setup-commands/notes; `settings.json` and PTY output were already unencrypted/unpersisted respectively), was simpler than either: remove the master password and encryption layer entirely. There is exactly one real file that needs handling — the author's own live `projects.enc` — which must not become unreadable when this ships.

## Options considered

### Option A — Enable/disable toggle, disabled state = plaintext
Keep `crypto`/`project_store`'s encrypted path as the default, add a `settings_store` boolean the user can flip to skip it. Rejected: keeps the full crypto module, the unlock screen, and a second on-disk format alive indefinitely for a feature the author has already decided isn't worth the friction even in its "on" state — two storage code paths to maintain for a single-user app with no one else who'd want the "on" state.

### Option B — Enable/disable toggle, disabled state = app-managed fixed key
Same as Option A but the "disabled" state still writes AES-GCM ciphertext, keyed by a locally generated, non-secret key stored alongside the data file. Rejected for the same reason as Option A, plus: this only protects against the data file being copied without its adjacent key file — a distinction with no practical value for one person's local machine — while still carrying the full crypto/atomic-rotation machinery for zero real confidentiality gain.

### Option C — Keep master password mandatory, add 5-minute session grace period
Reduces prompt frequency but does not address the author's actual complaint (the password step itself, not its frequency) and adds new state to reason about (timer reset semantics, what "expiry" does mid-session, interaction with the existing lock-gated IPC commands audited in `docs/security/audit-2026-07-20.md`). Rejected: solves a problem adjacent to the one the author has, not the one they have.

### Option D — Remove the master password and encryption entirely (chosen)
Delete the unlock flow. `project_store` reads/writes a plain (uncompressed, unencrypted) `bincode`/`serde_json` file directly, same as `settings_store` already does for preferences. One-time migration on first load of the new version: if the existing data file is still in the old encrypted envelope format, prompt for the master password exactly once, decrypt with the existing (retained-for-this-purpose) `crypto` module, and immediately rewrite the file in the new plaintext format. Every subsequent load sees the plaintext format and never prompts again.

## Decision

Implement Option D.

**Migration mechanism** — reuse the magic-byte version marker already established by ADR-0011 (which distinguishes the pre-FR-11 unmarked `Vec<Project>` shape from the current `StoreData` shape) rather than inventing a new versioning mechanism:
- Add a new marker value meaning "plaintext `StoreData`, no encryption envelope."
- On load: if the file has no marker or the pre-FR-11 marker, or the AES-GCM-envelope marker, treat it as needing migration — the pre-FR-11/AES-GCM cases both already require a "read old shape, upgrade, immediately re-persist in the new format" step, so this is the same pattern ADR-0011 established, applied one more time.
- Migration from the encrypted envelope specifically requires the master password once (last time, ever) to derive the key and decrypt — this is the only remaining call site for `crypto::derive_key`/`crypto::decrypt` in the whole app.
- After a successful migration write, the file carries the new plaintext marker and is never treated as encrypted again.
- If no data file exists at all (fresh install), skip migration and the password prompt entirely — there was never anything to decrypt.

**What gets removed:**
- `unlock_screen` (frontend) and the `unlock`/lock-gating concept in `commands/mod.rs` — every IPC command that was gated on `locked` state becomes ungated (there is no more locked state).
- `change_master_password` command and its Settings UI sub-form (part of FR-13).
- `ProjectStore::change_password` (ADR-0010's rotation logic) — nothing left to rotate.
- The `crypto` module's encrypt/key-derivation-for-writing paths. Its decrypt path is retained *only* to serve the one-time migration described above.
- `config_sync`'s dependency on `crypto` for import validation — import now just reads the plaintext format directly (still replace-only, per ADR-0008, unaffected by this decision).

**What is explicitly deferred, not decided here:** once the author confirms their own live data file has migrated successfully (i.e., after running the new version once), the `crypto` module, the `argon2`/`aes-gcm`/`subtle` dependencies, and the migration branch itself can be deleted outright — there is exactly one real file that will ever need migrating, and keeping dead migration code alive indefinitely past that point would be exactly the kind of speculative future-proofing this project avoids elsewhere. That cleanup is a small follow-up, not part of this ADR's required scope, since deleting it prematurely (before the author's live file is confirmed migrated) would be the actual risk.

## Consequences

- **NFR-3 is repealed as written.** It previously read "stored data... must be encrypted at rest." That guarantee no longer holds — the project data file (paths, setup commands, and any credentials/API keys the author chooses to put in notes or commands) is now plaintext on disk, protected only by OS filesystem permissions (the 0600/0700 permissions M3 already established in `docs/security/audit-2026-07-20.md` still apply and still matter — they're now the *only* protection, not a defense-in-depth layer). This is a conscious, informed trade the author made after seeing exactly what was and wasn't protected; it must be reflected in the PRD (NFR-3 rewrite) and re-evaluated by `security-auditor`, since it removes a control that audit previously verified sound.
- **US-05 ("I want my notes and commands stored encrypted") is no longer satisfied by design** — must be marked removed/superseded in the PRD, not left looking un-implemented.
- **NFR-5 (portability) improves incidentally** — a plaintext file is trivially diffable/mergeable via git, unlike an opaque ciphertext blob; this was never the driving reason, but it's a genuine side benefit worth noting for future `config_sync`/ADR-0008 revisits.
- **Simplification.** The lock/unlock state machine disappears from both backend (`commands/mod.rs` guard clauses) and frontend (`unlock_screen`, `appStore.locked` gating across `TitleBar.svelte`, `Sidebar.svelte`, etc.) — a real reduction in surface area, not just moved complexity.
- **One-time risk window.** The migration path is new code that runs exactly once against the author's one real file; if it has a bug, the author's existing project list is what's at stake. Mitigate the same way ADR-0010's rotation did: write the new plaintext file to a temp path in the same directory and atomically rename over the original only after a successful write, and do not delete/overwrite the original encrypted bytes until the new file is confirmed written — see `docs/backend/architecture.md` §6's existing atomic-write pattern (already used for every `persist()` call since ADR-0010).
- **Revisit trigger:** none expected under normal single-user use. If this app is ever shared with or run by anyone other than the author on a machine they don't fully control, encryption-at-rest should be reconsidered from scratch rather than resurrected from this ADR's deleted code.
