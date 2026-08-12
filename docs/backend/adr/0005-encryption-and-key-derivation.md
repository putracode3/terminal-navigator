# ADR-0005: Master password with Argon2id + AES-256-GCM

- **Status:** superseded by [ADR-0014](0014-remove-master-password-encryption.md) (2026-08-12) — the author decided the password-every-launch friction accepted below cost more than the confidentiality guarantee was worth for a single-user local tool. Retained here as historical record of why encryption was adopted in the first place.
- **Date:** 2026-07-17
- **Drivers:** NFR-3, NFR-6, CON-2, CON-4

## Context

Stored data (paths, commands, notes) may contain credentials/API keys (NFR-3), so it must be encrypted at rest with a real key-derivation and encryption scheme — not something hand-rolled. The author chose a master password (entered on app launch) over an OS-keychain-backed key, for explicit, portable control. The author is new to Rust (NFR-6, CON-2), so the chosen crates matter as much as the algorithm choice.

## Options considered

### Option A — OS keychain-backed key
Key stored in the OS Secret Service/keychain; app auto-unlocks with no password prompt. Convenient, but was explicitly rejected by the user in favor of explicit control and portability across devices (a keychain entry doesn't travel with a git-synced file the way a password-derived key does).

### Option B — Master password → Argon2id → AES-256-GCM
User enters a password on launch; Argon2id derives a symmetric key from it (with a random salt stored alongside the encrypted data); AES-256-GCM encrypts/decrypts the single data file (ADR-0004) using that key. Both `argon2` and `aes-gcm` are pure-Rust crates from well-maintained sources (RustCrypto org for `aes-gcm`), avoiding any C-library linking.

Only Option B matches the user's explicit choice; Option A is recorded here because it was the other real candidate discussed, not as a strawman.

## Decision

Derive the encryption key from a user-entered master password using Argon2id, and encrypt the single data file (ADR-0004) with AES-256-GCM. The `crypto` module (architecture.md §5.2) is the only module that ever holds the derived key in memory.

## Consequences

- No dependency on any OS-specific keychain service — the app behaves identically across Linux/Windows/macOS (supports CON-5's optional future goal) and the encrypted file remains meaningfully portable (NFR-5): decrypt it with the same password on any device.
- User must enter the master password every launch — accepted friction, per the user's explicit preference over keychain auto-unlock.
- If the master password is lost, the data is unrecoverable by design (no backdoor) — this is the correct trade-off for NFR-3, but should be surfaced clearly in the UI (a design-implementer/ui-ux-designer concern, not architecture).
- Pure-Rust crates (`argon2`, `aes-gcm`) avoid C-library linking issues that would otherwise complicate cross-platform builds for a Rust beginner (NFR-6, CON-2).
- **Revisit trigger:** none expected under normal use; revisit only if a future requirement demands multi-device auto-sync without re-entering the password each time (would need a different key-escrow approach).
