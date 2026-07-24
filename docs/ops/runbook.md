# Runbook — Terminal Navigator

> Version 1.2 · 2026-07-24 · Infra: none — local desktop app (Tauri), daily-driver install is still a manually built `.deb` on the author's own Debian 12 machine. No server, no staging, no remote users. A GitHub remote now exists (`git@github.com:putracode3/terminal-navigator.git`) with a CI workflow (`.github/workflows/release.yml`) that builds tagged releases — see §2's new "GitHub Release" subsection. §9's former "no CI" gap is now partially closed; local build/install (above) remains the actual daily-driver mechanism.
> Rehearsal log: pre-flight gate + build ✅ 2026-07-20 (all 3 gate commands + `tauri build -- --bundles deb` run clean, produced `Terminal Navigator_0.1.0_amd64.deb`) · install + dual-launch verify (§2 steps 3–4, predating the FR-13 Settings step 5 added in v1.1) ✅ 2026-07-20, done directly by the author while diagnosing the TERM bug this runbook documents · restore (config export/import) ✅ 2026-07-20 · rollback — not yet rehearsed · §2 step 5 (Settings smoke-check) — not yet rehearsed, added in v1.1 · GitHub Release workflow — not yet rehearsed (added v1.2, no tag pushed yet; Windows/macOS build legs are unverified since the author only runs Debian — see caveat in §2)

This app has no server-side deployment. "Deploy" here means: build a `.deb` locally, verify it, and install it to replace the copy you use every day — that local process is unchanged. Sections below are scoped to that reality, plus the separate/optional GitHub Release path for sharing builds publicly — see §9 for what a normal server runbook would have that doesn't apply here, and why.

## 1. System map

- **Where it runs:** the author's own Debian 12 desktop. No other environment exists (no staging, no production server).
- **Installed binary:** `/usr/bin/terminal-navigator` (installed by the `.deb`; `dpkg -L terminal-navigator` lists all installed files).
- **Desktop launcher:** `/usr/share/applications/Terminal Navigator.desktop` — this is a *second, independent launch path* with its own process environment (see §2 pre-flight rules; this is exactly what caused the TERM-env bug fixed in commit `ec19eff`).
- **User data (per-user, not part of the app package):** `~/.local/share/com.dennysetiawisnugraha.terminal-navigator/projects.enc` — the single encrypted file holding the project list, notes, and setup commands (AES-GCM, key derived from the master password via Argon2 — see ADR-0005). PTY sessions themselves are runtime-only and never persisted (ADR-0007).
- **User preferences (FR-13, since v1.1 of this runbook):** `~/.local/share/com.dennysetiawisnugraha.terminal-navigator/settings.json` — theme preset, keybinding rebinds, sidebar position. Deliberately **unencrypted plaintext** (ADR-0009, NFR-8: none of this is sensitive, and it must be readable before the app is unlocked so chrome renders correctly at the unlock screen). Lives in the same directory as `projects.enc` but is a wholly separate file/format — **§4/§5's export/import does not touch it at all** (see the callout there).
- **Source of truth for what's installed:** `git log --oneline -1` in this repo at build time, plus the version in `src-tauri/tauri.conf.json` / `package.json` / `src-tauri/Cargo.toml` (kept in sync manually — see §2 versioning).
- **No secrets to manage:** this app has no API keys, no server credentials, nothing in a `.env`. The only secret is the user's own master password, which is never stored (only used to derive the encryption key at unlock time).

## 2. Build & release ("deploy")

**Trigger:** manual, whenever you want to cut a new build to replace your daily-driver install. `npm run tauri build` always runs on your own machine for this path — see the separate "GitHub Release" subsection below for the CI-built, publicly downloadable path.

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

### GitHub Release (CI-built, publicly downloadable)

Pushing a version tag (matching `v*.*.*`) triggers `.github/workflows/release.yml` on GitHub Actions:

```bash
git tag v<X.Y.Z>
git push origin v<X.Y.Z>
```

1. **Pre-flight gate job** runs the same three commands as above (`cargo test`, `vitest run`, `npm run check`) on `ubuntu-latest`. If any fail, the workflow stops here — no build job starts, nothing is published.
2. **Build job** (only if the gate passes) runs on a matrix of `ubuntu-latest`, `macos-latest`, and `windows-latest`, using `tauri-apps/tauri-action` to build each platform's installers (`.deb`/`.AppImage`/`.rpm` on Linux, `.dmg` on macOS, `.msi`/`.exe` on Windows) and attach them to a **draft** GitHub Release named after the tag.
3. **Publish:** go to the repo's Releases page on GitHub, review the draft (check all expected platform artifacts are attached), then click **Publish release**. Nothing is publicly downloadable until this manual step — the workflow deliberately never auto-publishes.

**Caveats:**
- The macOS and Windows builds are **unverified** — the author only runs Debian 12, so those two legs build successfully in CI but have never been installed/run by a human. Treat them as best-effort until someone actually tests one.
- Neither macOS nor Windows builds are code-signed. macOS will show an "unidentified developer" warning (Gatekeeper); Windows SmartScreen may warn too. Users have to explicitly bypass these to run it. Code-signing certificates are a future improvement if this app ever gets non-technical users.
- This CI path is entirely separate from your own daily-driver install (the manual `tauri build -- --bundles deb` above) — publishing a GitHub Release does not touch or replace what's installed on your machine. Do your own §2 verification pass locally regardless of whether you also cut a GitHub Release.

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
5. Open **Settings** (gear icon, sidebar footer) — smoke pass on FR-13: switch theme preset and confirm the open terminal's colors actually change, toggle sidebar position and confirm it moves, then close the modal (Escape or Done). No need to exercise keybinding rebinding or master-password change every release — those are covered by the automated suite (`docs/qa/test-plan.md` §3.4); this step exists to catch real-rendering issues jsdom can't (same reasoning as step 3).
6. **Run a full-screen TUI program** (`vim` is enough) inside a pane. Confirm it actually renders (not blank) and keystrokes are reflected. This is the regression check for a `tauri build`-only bug found 2026-07-22 (`docs/qa/test-plan.md` §5.1a): Vite's production minification corrupted `@xterm/xterm`'s terminal-capability-query handling in a way that only a real full-screen TUI triggers — plain typing (step 3) never hit it, and `tauri dev` never reproduced it at all. A green `tauri dev` session is not equivalent verification for this class of bug; it has to be checked against the actual `.deb`.
7. If anything in steps 1–6 looks wrong: **do not keep using this build.** Go to §3.

If all six pass, this build is now your verified daily driver. Keep the `.deb` you just saved in `~/terminal-navigator-releases/` — that's your rollback point if a *future* build breaks something.

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

**Not covered by this backup:** `settings.json` (theme/keybindings/sidebar position, FR-13) is a separate file that `export_config` never reads — exporting/restoring your project list has no effect on it either way. If you reinstall on a new machine or wipe `~/.local/share/com.dennysetiawisnugraha.terminal-navigator` (§7), your preferences reset to defaults even if you restore `projects.enc` from an export. There's no export path for settings today — if that ever matters enough to fix, the natural approach is copying `settings.json` alongside your `projects.enc` export manually (it's already plaintext JSON, so no password/decryption step needed).

## 5. Restore

1. Open the app, get to the unlock screen.
2. Click **Import**, pick your previously-exported file.
3. Enter the master password that was active when that export was made.
4. Confirm the replace-and-import dialog (import **replaces** the current project list wholesale — it does not merge, per ADR-0008).
5. Verify: the project list matches what you expect; open one project's terminal to confirm setup commands still run correctly.

**Your theme/keybindings/sidebar position are untouched by this** — import only ever writes `projects.enc`; whatever's currently in `settings.json` on this machine stays exactly as it was before the import, regardless of what the export's source machine had. If you're restoring onto a brand-new/wiped install, you'll get FR-13's defaults, not whatever preferences you'd set before.

**Rehearsal status:** ✅ rehearsed 2026-07-20 — export/import round-trip confirmed working by the author (before FR-13 existed; the settings-file exclusion above hasn't itself been hands-on rehearsed, just verified by reading `config_sync`'s code — see docs/security/audit-2026-07-20.md's sensitive-data map).

## 6. Incident first moves

There's no "site down" here — the closest equivalents:

1. **App won't unlock / crashes on unlock** → check you're using the current master password; check the data file isn't corrupted: `file ~/.local/share/com.dennysetiawisnugraha.terminal-navigator/projects.enc` should report it as data, not zero-length. If corrupted and you have an export, restore it (§5). If you have no valid export, the data is unrecoverable — a real gap, see §9.
2. **A terminal pane shows garbled/wrong input after a normal-looking build** → this is the bug class fixed in `ec19eff`. First check: does it happen when launched from a terminal AND from the desktop launcher? If only from the launcher, suspect the process environment again (compare `env` between the two launch methods, same technique used to find the TERM issue) before assuming a code regression.
3. **A terminal pane goes blank and stops accepting input, specifically when running a full-screen program (vim, htop, an AI CLI, ...)** → check whether it also happens under `npm run tauri dev`. If it only happens in the actual built `.deb`/binary, this is the bug class found 2026-07-22 (`docs/qa/test-plan.md` §5.1a — a Vite/esbuild production-minifier bug corrupting `@xterm/xterm`, worked around by minifying with **terser** instead of esbuild in `vite.config.js`). If a similar symptom recurs after a future Vite/esbuild/`@xterm/xterm` upgrade, first rebuild once with `minify: false` in `vite.config.js`: if that makes it work, it's a minifier-corruption pattern again (compare the minified `requestMode` in the built bundle against the `minify:false` output) rather than an app-code regression.
4. **Build fails** → re-run the pre-flight gate (§2) individually (`cargo test`, `vitest run`, `svelte-check`) to isolate which one is red; don't force a build past a failing gate.
5. **Something else looks broken** → superpowers:systematic-debugging / the `debugger` skill, not this runbook.

## 7. Routine operations

- **Dependency updates:** no fixed cadence yet (personal project, casual pace per the PRD). When you do update (`cargo update`, `npm update`), re-run the full pre-flight gate before trusting the result.
- **Log locations:** none configured — the app doesn't currently write logs to a file. Errors surface in-app (pane status → `error`, with a message), or via `console.error` calls in the terminal-pane code visible in the WebKitGTK inspector — but the `devtools` Tauri feature is intentionally **not** enabled for release builds: this app keeps the unlock password in a plain reactive store for the session (`appStore.password`), and an always-available inspector would let anyone with local access to a running unlocked instance read it straight out of memory, defeating FR-06's encryption-at-rest guarantee. Use `npm run tauri dev` (which has devtools by default) when you need to inspect the console. There's no persistent log to grep after the fact either way — a gap, see §9.
- **Version check:** `dpkg -s terminal-navigator | grep Version` shows what's currently installed.

- **Uninstall:**
  ```bash
  sudo apt remove terminal-navigator
  ```
  (or `sudo dpkg -r terminal-navigator`). This removes the binary and desktop launcher entry only — it does **not** touch your project data at `~/.local/share/com.dennysetiawisnugraha.terminal-navigator/projects.enc`, since that's user data, not part of the package. The same applies to `settings.json` (FR-13) — same directory, same reasoning, also left in place. Reinstalling later picks both the project list and your preferences back up automatically. For a full wipe including data, **export first** (§4) — remembering §4's callout that this only saves `projects.enc`, not your settings — then:
  ```bash
  rm -rf ~/.local/share/com.dennysetiawisnugraha.terminal-navigator
  ```
  This removes both files; a fresh install afterward starts with an empty project list and FR-13's default settings.

## 8. Monitoring & alerts

Not applicable — this is a local desktop app with a single user (yourself), not a hosted service with uptime to watch. The nearest equivalent (visible-error-surfacing) is already handled in-app via pane error status, not by a separate monitoring layer.

## 9. Deliberately not built (right-sized out, not forgotten)

These exist in the standard runbook template but don't apply at this project's current scale — listed here so a future reader (including an AI agent) doesn't wonder if they were missed:

- **CI/CD pipeline:** partially addressed as of v1.2 — `.github/workflows/release.yml` runs the pre-flight gate and builds installers on tagged releases (see §2's "GitHub Release" subsection). Still deliberately *not* built: a workflow running the gate on every push/PR (there's no team and no push-to-deploy need at solo-dev scale, so this is a "someday" rather than a gap) and any auto-deploy step (there's nothing to deploy to — this only publishes downloadable installers, it doesn't touch the author's own daily-driver install).
- **Staging environment:** the "verify before it becomes your daily driver" step in §2 is this project's equivalent — there's only ever one real environment (your machine).
- **Uptime/error-tracking service, disk-space alerts:** no server, nothing to page about.
- **Persistent application logs:** genuinely missing today (see §7) — if a bug is ever hard to reproduce, this would be the first thing worth adding (even a simple file logger behind a debug flag).
- **Automated backup schedule:** FR-07's export is manual-only; automating a periodic export would close this gap if project data ever becomes precious enough to warrant it.

## 10. Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-20 | Initial runbook — written after discovering and fixing a launch-environment-dependent bug (missing `TERM` when launched from a desktop launcher, commit `ec19eff`) that a documented release-verification checklist would have caught before it reached daily use. |
| 1.1 | 2026-07-21 | Catch-up for FR-13 (Settings Panel, shipped in a prior session but not yet reflected here): documented the new unencrypted `settings.json` file in §1; added explicit callouts in §4/§5 that export/import only ever covers `projects.enc` — settings are neither backed up nor restored by that mechanism, and reset to defaults on a fresh install; noted in §7 that uninstall leaves `settings.json` in place same as `projects.enc`; added a Settings smoke-check as step 5 of §2's release verification. No code changed — documentation only, per this project's CLAUDE.md rule that contract docs stay true alongside the code they govern. |
| 1.2 | 2026-07-22 | Added step 6 to §2's release verification (run a full-screen TUI in a pane, e.g. `vim`) and a new §6 troubleshooting entry, after a debugger session found a `tauri build`-only bug (Vite production minification corrupting `@xterm/xterm`'s terminal-capability-query handling — full root cause in `docs/qa/test-plan.md` §5.1a and `vite.config.js`'s own comment) that steps 1–5 could not have caught: it never reproduced under `tauri dev`, and plain typing (step 3) never exercised the specific code path that broke. Fixed by disabling minification. |
| 1.3 | 2026-07-22 | Updated §6 troubleshooting item 3 to reflect the refined fix: the minifier bug is now worked around by switching to **terser** (keeps full minification) rather than disabling minification — see `docs/qa/test-plan.md` §5.1a / changelog 1.6. No release-procedure step changed (step 6's TUI check still applies verbatim). |
