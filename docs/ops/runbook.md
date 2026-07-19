# Runbook — Terminal Navigator

> Version 1.0 · 2026-07-20 · Infra: none — local desktop app (Tauri), installed manually as a `.deb` on the author's own Debian 12 machine. No server, no CI, no remote users.
> Rehearsal log: pre-flight gate + build ✅ 2026-07-20 (all 3 gate commands + `tauri build -- --bundles deb` run clean, produced `Terminal Navigator_0.1.0_amd64.deb`) · install + dual-launch verify (§2 steps 3–5) ✅ 2026-07-20, done directly by the author while diagnosing the TERM bug this runbook documents · restore (config export/import) ✅ 2026-07-20 · rollback — not yet rehearsed

This app has no server-side deployment. "Deploy" here means: build a `.deb` locally, verify it, and install it to replace the copy you use every day. Sections below are scoped to that reality — see §9 for what a normal server runbook would have that doesn't apply here, and why.

## 1. System map

- **Where it runs:** the author's own Debian 12 desktop. No other environment exists (no staging, no production server).
- **Installed binary:** `/usr/bin/terminal-navigator` (installed by the `.deb`; `dpkg -L terminal-navigator` lists all installed files).
- **Desktop launcher:** `/usr/share/applications/Terminal Navigator.desktop` — this is a *second, independent launch path* with its own process environment (see §2 pre-flight rules; this is exactly what caused the TERM-env bug fixed in commit `ec19eff`).
- **User data (per-user, not part of the app package):** `~/.local/share/com.dennysetiawisnugraha.terminal-navigator/projects.enc` — the single encrypted file holding the project list, notes, and setup commands (AES-GCM, key derived from the master password via Argon2 — see ADR-0005). PTY sessions themselves are runtime-only and never persisted (ADR-0007).
- **Source of truth for what's installed:** `git log --oneline -1` in this repo at build time, plus the version in `src-tauri/tauri.conf.json` / `package.json` / `src-tauri/Cargo.toml` (kept in sync manually — see §2 versioning).
- **No secrets to manage:** this app has no API keys, no server credentials, nothing in a `.env`. The only secret is the user's own master password, which is never stored (only used to derive the encryption key at unlock time).

## 2. Build & release ("deploy")

**Trigger:** manual, whenever you want to cut a new build to replace your daily-driver install. No CI — `npm run tauri build` always runs on your own machine.

### Pre-flight gate (must be green before building)
```bash
cd src-tauri && cargo test && cd ..
npx vitest run
npm run check
```
All three must pass with zero failures/errors before proceeding. A red suite blocks the release — don't build on top of failing tests.

### Versioning
Bump the version number in all three places together (they must match — nothing enforces this automatically today, so check by eye):
- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`
- `src-tauri/Cargo.toml` → `version =`

Then tag the commit so this exact build state is always recoverable:
```bash
git tag v<X.Y.Z>
```

### Build
```bash
npm run tauri build -- --bundles deb
```
Output: `src-tauri/target/release/bundle/deb/*.deb`. This runs a **release** Rust build (`cargo build --release` under the hood) — meaningfully faster/different runtime characteristics than `tauri dev`'s debug build. Don't treat a `tauri dev` session as equivalent verification of a release build; test the actual `.deb` (see below).

### Before installing: save the current build as your rollback point
```bash
mkdir -p ~/terminal-navigator-releases
cp src-tauri/target/release/bundle/deb/*.deb ~/terminal-navigator-releases/terminal-navigator-$(date +%Y%m%d-%H%M%S)-previous-build.deb 2>/dev/null || true
```
(If this is your very first install, skip — there's nothing to save yet.)

### Install
```bash
sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb
```

### Verify — do NOT skip this, especially step 3
1. Launch from a terminal: `/usr/bin/terminal-navigator` — confirm it opens, unlock with your master password, open a project's terminal, type a few commands.
2. **Launch from the GNOME application launcher** (search "Terminal Navigator" in the activities overview, or click its icon) — **not** from a terminal this time. This is the launch path that has no parent terminal and therefore a different process environment (this is exactly how the TERM-unset bug was found — a fix that only gets exercised by this specific launch path).
3. In the launcher-launched instance: open a fresh terminal pane, type a letter, press Backspace, type another letter. Confirm the display matches what you actually typed — no duplicated/garbled characters, no phantom spaces. This is the regression check for the class of bug fixed in `ec19eff`.
4. Try a split pane, closing a pane, and switching between two open project tabs — quick smoke pass on FR-08.
5. If anything in steps 1–4 looks wrong: **do not keep using this build.** Go to §3.

If all four pass, this build is now your verified daily driver. Keep the `.deb` you just saved in `~/terminal-navigator-releases/` — that's your rollback point if a *future* build breaks something.

## 3. Rollback

**When:** verification (§2) fails, or you notice a regression days later while using the app normally.

1. Find the last known-good `.deb`:
   ```bash
   ls -t ~/terminal-navigator-releases/
   ```
2. Reinstall it:
   ```bash
   sudo dpkg -i ~/terminal-navigator-releases/<the-good-one>.deb
   ```
3. Relaunch (both from a terminal and from the GNOME launcher) and confirm it's back to the working behavior.

**Data caveat:** rollback only replaces the app binary — `~/.local/share/.../projects.enc` (your project list) is untouched by install/rollback either way, so there's nothing to restore on the data side for a simple binary rollback.

**Rehearsal status:** not yet actually rehearsed (no bad build has happened since this runbook was written). Rehearse this the next time a build fails verification, and record the outcome here.

## 4. Backup (your project data)

This app has a built-in export feature (FR-07) — that *is* the backup mechanism. No separate backup infrastructure exists or is needed at this scale.

- **What:** `~/.local/share/com.dennysetiawisnugraha.terminal-navigator/projects.enc` — encrypted; exporting does not leak plaintext.
- **How:** in the sidebar, click **Export** → choose a destination file. Recommended: export into a location you already back up or sync elsewhere (e.g., a git dotfiles repo, a synced folder) — the file is encrypted at rest, so it's safe to commit/sync even to a non-private location.
- **Schedule:** manual, whenever your project list changes meaningfully (new project added, setup commands edited). No automation exists for this today — a "remind me to export" habit is the current mitigation.
- **Off-site copy:** whatever you export to (git remote, cloud-synced folder) — if you only ever export to another folder on the same disk, you don't have real off-site coverage. Worth doing at least once to a git remote or cloud storage.

## 5. Restore

1. Open the app, get to the unlock screen.
2. Click **Import**, pick your previously-exported file.
3. Enter the master password that was active when that export was made.
4. Confirm the replace-and-import dialog (import **replaces** the current project list wholesale — it does not merge, per ADR-0008).
5. Verify: the project list matches what you expect; open one project's terminal to confirm setup commands still run correctly.

**Rehearsal status:** ✅ rehearsed 2026-07-20 — export/import round-trip confirmed working by the author.

## 6. Incident first moves

There's no "site down" here — the closest equivalents:

1. **App won't unlock / crashes on unlock** → check you're using the current master password; check the data file isn't corrupted: `file ~/.local/share/com.dennysetiawisnugraha.terminal-navigator/projects.enc` should report it as data, not zero-length. If corrupted and you have an export, restore it (§5). If you have no valid export, the data is unrecoverable — a real gap, see §9.
2. **A terminal pane shows garbled/wrong input after a normal-looking build** → this is the bug class fixed in `ec19eff`. First check: does it happen when launched from a terminal AND from the desktop launcher? If only from the launcher, suspect the process environment again (compare `env` between the two launch methods, same technique used to find the TERM issue) before assuming a code regression.
3. **Build fails** → re-run the pre-flight gate (§2) individually (`cargo test`, `vitest run`, `svelte-check`) to isolate which one is red; don't force a build past a failing gate.
4. **Something else looks broken** → superpowers:systematic-debugging / the `debugger` skill, not this runbook.

## 7. Routine operations

- **Dependency updates:** no fixed cadence yet (personal project, casual pace per the PRD). When you do update (`cargo update`, `npm update`), re-run the full pre-flight gate before trusting the result.
- **Log locations:** none configured — the app doesn't currently write logs to a file. Errors surface in-app (pane status → `error`, with a message), or via `console.error` calls in the terminal-pane code visible in the WebKitGTK inspector — but the `devtools` Tauri feature is intentionally **not** enabled for release builds: this app keeps the unlock password in a plain reactive store for the session (`appStore.password`), and an always-available inspector would let anyone with local access to a running unlocked instance read it straight out of memory, defeating FR-06's encryption-at-rest guarantee. Use `npm run tauri dev` (which has devtools by default) when you need to inspect the console. There's no persistent log to grep after the fact either way — a gap, see §9.
- **Version check:** `dpkg -s terminal-navigator | grep Version` shows what's currently installed.

## 8. Monitoring & alerts

Not applicable — this is a local desktop app with a single user (yourself), not a hosted service with uptime to watch. The nearest equivalent (visible-error-surfacing) is already handled in-app via pane error status, not by a separate monitoring layer.

## 9. Deliberately not built (right-sized out, not forgotten)

These exist in the standard runbook template but don't apply at this project's current scale — listed here so a future reader (including an AI agent) doesn't wonder if they were missed:

- **CI/CD pipeline:** no git remote is configured for this repo yet; there's no team, no push-to-deploy need. If this project ever gains a public remote/collaborators, revisit — a GitHub Actions workflow that runs the pre-flight gate (§2) on every push would be the natural next step.
- **Staging environment:** the "verify before it becomes your daily driver" step in §2 is this project's equivalent — there's only ever one real environment (your machine).
- **Uptime/error-tracking service, disk-space alerts:** no server, nothing to page about.
- **Persistent application logs:** genuinely missing today (see §7) — if a bug is ever hard to reproduce, this would be the first thing worth adding (even a simple file logger behind a debug flag).
- **Automated backup schedule:** FR-07's export is manual-only; automating a periodic export would close this gap if project data ever becomes precious enough to warrant it.

## 10. Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-20 | Initial runbook — written after discovering and fixing a launch-environment-dependent bug (missing `TERM` when launched from a desktop launcher, commit `ec19eff`) that a documented release-verification checklist would have caught before it reached daily use. |
