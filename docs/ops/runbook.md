# Runbook — Terminal Navigator

> Version 1.12 · 2026-09-29 · Infra: none — local desktop app (Tauri), daily-driver install is still a manually built `.deb` on the author's own Debian 12 machine. No server, no staging, no remote users. A GitHub remote now exists (`git@github.com:putracode3/terminal-navigator.git`) with a CI workflow (`.github/workflows/release.yml`) that builds tagged releases — see §2's new "GitHub Release" subsection. §9's former "no CI" gap is now partially closed; local build/install (above) remains the actual daily-driver mechanism.
> Rehearsal log: **0.2.1 release ✅ 2026-09-25** — pre-flight gate (521 vitest / 109 cargo / `npm run check`) + `tauri build -- --bundles deb`, previous build saved to `~/terminal-navigator-releases/`, installed, and §2 verify steps 1–8 passed from the GNOME launcher per the author (incl. step 8's capability smoke-test and step 6's TUI/split checks) · earlier: pre-flight gate + build ✅ 2026-07-20 (all 3 gate commands + `tauri build -- --bundles deb` run clean, produced `Terminal Navigator_0.1.0_amd64.deb`) · install + dual-launch verify (§2 steps 3–4, predating the FR-13 Settings step 5 added in v1.1) ✅ 2026-07-20, done directly by the author while diagnosing the TERM bug this runbook documents · restore (config export/import) ✅ 2026-07-20 — **predates ADR-0014 (2026-08-12); the restore mechanism itself changed (no password step) — re-rehearse before relying on this log entry, see §5** · rollback — not yet rehearsed · §2 step 5 (Settings smoke-check) — not yet rehearsed, added in v1.1 · GitHub Release workflow — not yet rehearsed (added v1.2, no tag pushed yet; Windows/macOS build legs are unverified since the author only runs Debian — see caveat in §2) · §2 step 7 (window drag/resize/controls smoke-check) — not yet rehearsed, added in v1.3 for v2.8/ADR-0013's native-decorations removal; **blocks this build becoming the daily driver until run** (§2's own rule)

This app has no server-side deployment. "Deploy" here means: build a `.deb` locally, verify it, and install it to replace the copy you use every day — that local process is unchanged. Sections below are scoped to that reality, plus the separate/optional GitHub Release path for sharing builds publicly — see §9 for what a normal server runbook would have that doesn't apply here, and why.

## 1. System map

- **Where it runs:** the author's own Debian 12 desktop. No other environment exists (no staging, no production server).
- **Installed binary:** `/usr/bin/terminal-navigator` (installed by the `.deb`; `dpkg -L terminal-navigator` lists all installed files).
- **Desktop launcher:** `/usr/share/applications/Terminal Navigator.desktop` — this is a *second, independent launch path* with its own process environment (see §2 pre-flight rules; this is exactly what caused the TERM-env bug fixed in commit `ec19eff`).
- **User data (per-user, not part of the app package):** `~/.local/share/com.dennysetiawisnugraha.terminal-navigator/projects.enc` — the single file holding the project list, notes, and setup commands. **Plain, not encrypted, as of ADR-0014 (2026-08-12, supersedes ADR-0005)** — the `.enc` extension is kept only for continuity, it's no longer meaningful. Protected solely by OS file permissions (0600 on the file, 0700 on its containing directory — no encryption layer behind that anymore, so these permissions are the *only* protection, not defense-in-depth). A machine that still has a genuinely pre-ADR-0014 encrypted file gets it migrated to plain automatically, once, the first time this build runs — see §5's restore section and §6 item 1 for what that looks like. PTY sessions themselves are runtime-only and never persisted (ADR-0007).
- **User preferences (FR-13, since v1.1 of this runbook):** `~/.local/share/com.dennysetiawisnugraha.terminal-navigator/settings.json` — theme preset, keybinding rebinds, sidebar position. Plaintext (ADR-0009: none of this is sensitive, and it must be readable before the project store has finished loading so app chrome renders correctly at startup — including during the one-time migration prompt, when one is shown). Lives in the same directory as `projects.enc` but is a wholly separate file/format — **§4/§5's export/import does not touch it at all** (see the callout there).
- **Source of truth for what's installed:** `git log --oneline -1` in this repo at build time, plus the version in `src-tauri/tauri.conf.json` / `package.json` / `src-tauri/Cargo.toml` (kept in sync manually — see §2 versioning).
- **No secrets to manage:** this app has no API keys, no server credentials, nothing in a `.env`, and — as of ADR-0014 — no master password either. The one remaining password-shaped thing is the **legacy** master password, asked for at most once, only on a machine whose data file is still in the pre-ADR-0014 encrypted format, and never stored (used transiently to decrypt that one file during migration, then discarded). `projects.enc` itself may still contain sensitive values the user typed into project notes or setup commands (API keys, credentials) — see §4's backup guidance, which changed because of this.

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

The lockfiles carry the app's own version too — update them in the same commit (found 2026-09-25: `package-lock.json`'s root entries were still at 0.1.0 two releases later):
- `src-tauri/Cargo.lock` → the `terminal-navigator` package entry (any `cargo build` rewrites it)
- `package-lock.json` → the top-level `"version"` and `packages[""].version`

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
- **Workflow hardening (security audit L10, 2026-09-24):** the workflow's default `GITHUB_TOKEN` is read-only (`permissions: contents: read`); only the `build-and-release` job has `contents: write`, which it needs to create the draft Release. All four actions are pinned to **full commit SHAs** (the trailing `# vX` comment says which tag/branch each came from) — they no longer move on their own. To update one deliberately: `git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>` (use the peeled `^{}` line for annotated tags), replace the SHA, then let the next tagged run be the test. `dtolnay/rust-toolchain` needs its `with: toolchain: stable` input because a SHA pin can't carry the toolchain in the ref name. This workflow has not been run since these changes — expect the next `v*.*.*` tag to be its first execution, and watch that run.
- This CI path is entirely separate from your own daily-driver install (the manual `tauri build -- --bundles deb` above) — publishing a GitHub Release does not touch or replace what's installed on your machine. Do your own §2 verification pass locally regardless of whether you also cut a GitHub Release.

### Build
```bash
npm run tauri build -- --bundles deb
```
Output: `src-tauri/target/release/bundle/deb/*.deb`. This runs a **release** Rust build (`cargo build --release` under the hood) — meaningfully faster/different runtime characteristics than `tauri dev`'s debug build. Don't treat a `tauri dev` session as equivalent verification of a release build; test the actual `.deb` (see below).

The release binary is built with `strip = true` (`src-tauri/Cargo.toml` `[profile.release]`, 2026-09-29): 18.2 → 11.7 MB, with no extra build time and no change in runtime memory. The trade-off is that a panic backtrace from the installed build has no function names. See §6 item 5 for how to get a symbolized build when debugging.

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
1. Launch from a terminal: `/usr/bin/terminal-navigator` — confirm it opens straight to the project list (no password prompt, as of ADR-0014 — see §1), open a project's terminal, type a few commands. (The one exception is a first run against a genuinely pre-ADR-0014 data file, which shows a one-time migration prompt instead — not a normal-release check, since it can only happen once per machine ever; see §6 item 1 if you need to exercise that path deliberately.)
2. **Launch from the GNOME application launcher** (search "Terminal Navigator" in the activities overview, or click its icon) — **not** from a terminal this time. This is the launch path that has no parent terminal and therefore a different process environment (this is exactly how the TERM-unset bug was found — a fix that only gets exercised by this specific launch path).
3. In the launcher-launched instance: open a fresh terminal pane, type a letter, press Backspace, type another letter. Confirm the display matches what you actually typed — no duplicated/garbled characters, no phantom spaces. This is the regression check for the class of bug fixed in `ec19eff`.
4. Try a split pane, closing a pane, and switching between two open project tabs — quick smoke pass on FR-08.
5. Open **Settings** (gear icon, now the **Title Bar's** left zone as of v2.8 — was the sidebar footer through v2.7) — smoke pass on FR-13: switch theme preset and confirm the open terminal's colors actually change, toggle sidebar position and confirm it moves, then close the modal (Escape or Done). Note the panel is down to three groups since ADR-0014 removed the master-password-change section. No need to exercise keybinding rebinding every release — that's covered by the automated suite (`docs/qa/test-plan.md` §3.4); this step exists to catch real-rendering issues jsdom can't (same reasoning as step 3).
6. **Run a full-screen TUI program** (`vim` is enough) inside a pane. Confirm it actually renders (not blank) and keystrokes are reflected. This is the regression check for a `tauri build`-only bug found 2026-07-22 (`docs/qa/test-plan.md` §5.1a): Vite's production minification corrupted `@xterm/xterm`'s terminal-capability-query handling in a way that only a real full-screen TUI triggers — plain typing (step 3) never hit it, and `tauri dev` never reproduced it at all. A green `tauri dev` session is not equivalent verification for this class of bug; it has to be checked against the actual `.deb`. **Also (added 2026-09-25):** confirm the TUI's painted area touches the pane border on the left and top, with at most a sliver (under one character) on the right and under one line at the bottom — not a frame of the pane's own colour around it (regression check for the scrollbar-strip fix and design v3.4's TUI-only padding removal). After quitting it, the shell prompt should again sit a few pixels in from the border. In a **split** (two panes side by side), start the TUI in each half — both should reach their right edge alike. Then quit the TUI and confirm the prompt and the earlier output are intact.
7. **(added 2026-07-29, v2.8/ADR-0013)** Drag the window by an empty area of the Title Bar and confirm it actually moves; click Minimize, Maximize, and Close and confirm each works; drag from a window edge and a corner and confirm it resizes; double-click the Title Bar's empty space and confirm it toggles maximize/restore. This is the regression check for `docs/qa/test-plan.md` §5.1's new smoke-sequence step 6: native decorations no longer supply any of this for free (`decorations: false`), `data-tauri-drag-region`/`startResizeDragging()` are handled below the DOM by wry/the window manager, and GTK client-side-decoration behavior is known to vary by desktop environment — a `tauri dev` session or the automated suite (`TitleBar.test.ts`) proves the button click handlers fire but not that the drag/resize gesture itself reaches the compositor.
8. **(added 2026-09-24, security audit L9 — the capability set was narrowed to least privilege and needs one real-run confirmation)** In the launcher-launched instance: (a) run `echo https://example.com` in a pane and **Ctrl+click** the URL — the default browser must open it; (b) open the **Add project** form and click **Browse** — the folder picker must open; (c) **Settings → Export** must open a save dialog and **Import** an open dialog (cancel out of both). If any of these does nothing, the capability file (`src-tauri/capabilities/default.json`) is missing a permission the frontend needs — do not widen it back to `opener:default`/`dialog:default`; add only the specific missing `allow-*` entry. Once it passes, record it in the audit report (L9 → fixed-verified).
9. If anything in steps 1–8 looks wrong: **do not keep using this build.** Go to §3.

If all eight pass, this build is now your verified daily driver. Keep the `.deb` you just saved in `~/terminal-navigator-releases/` — that's your rollback point if a *future* build breaks something.

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

- **What:** `~/.local/share/com.dennysetiawisnugraha.terminal-navigator/projects.enc` — **plain, not encrypted, as of ADR-0014.** Exporting is a byte-for-byte copy, so it carries whatever's in your project notes/setup commands verbatim — including any API keys or credentials you've typed in there (see §1's NFR-3 note).
- **How:** in the sidebar, click **Export** → choose a destination file.
- **⚠️ Where NOT to put it, changed by ADR-0014:** the old advice here was "safe to commit/sync even to a non-private location" because the file used to be encrypted — **that's no longer true.** Treat an exported `projects.enc` the same as any other file that might contain secrets: a **private** git repo/dotfiles setup is fine, a **private** cloud-synced folder is fine, a public repo or a shared/public location is not. If your existing backup habit was built around "it's encrypted, it's fine anywhere," recheck where those exports have been landing.
- **Schedule:** manual, whenever your project list changes meaningfully (new project added, setup commands edited). No automation exists for this today — a "remind me to export" habit is the current mitigation.
- **Off-site copy:** whatever you export to (private git remote, private cloud-synced folder) — if you only ever export to another folder on the same disk, you don't have real off-site coverage. Worth doing at least once to a private git remote or private cloud storage, subject to the privacy caveat above.

**Not covered by this backup:** `settings.json` (theme/keybindings/sidebar position, FR-13) is a separate file that `export_config` never reads — exporting/restoring your project list has no effect on it either way. If you reinstall on a new machine or wipe `~/.local/share/com.dennysetiawisnugraha.terminal-navigator` (§7), your preferences reset to defaults even if you restore `projects.enc` from an export. There's no export path for settings today — if that ever matters enough to fix, the natural approach is copying `settings.json` alongside your `projects.enc` export manually (it's already plaintext JSON, so no password/decryption step needed).

## 5. Restore

1. Open the app — it opens straight to the project list, no unlock step (ADR-0014).
2. Open **Settings → Data**, click **Import**, pick your previously-exported file. (No password step — as of ADR-0014, import just validates the file is a well-formed data file, nothing to decrypt.)
3. Confirm the replace-and-import dialog (import **replaces** the current project list wholesale — it does not merge, per ADR-0008).
4. Verify: the project list matches what you expect; open one project's terminal to confirm setup commands still run correctly.

**Your theme/keybindings/sidebar position are untouched by this** — import only ever writes `projects.enc`; whatever's currently in `settings.json` on this machine stays exactly as it was before the import, regardless of what the export's source machine had. If you're restoring onto a brand-new/wiped install, you'll get FR-13's defaults, not whatever preferences you'd set before.

**Importing a genuinely pre-ADR-0014 export:** not supported directly — an export made before ADR-0014 is still in the old encrypted format, and Import will reject it as "not a valid Terminal Navigator data file" rather than trying to decrypt it. Update the *source* machine to the current build first (which migrates its live `projects.enc` to plain, once), export fresh from there, then import that.

**Rehearsal status:** ⚠️ stale — last rehearsed 2026-07-20, against the pre-ADR-0014 password-protected import flow described above's old version. The restore mechanism itself changed (no password step, different rejection behavior for a legacy file); re-rehearse a plain export/import round-trip before trusting this as a verified path.

## 6. Incident first moves

There's no "site down" here — the closest equivalents:

1. **App fails to start / errors on launch** → check the data file isn't corrupted: `file ~/.local/share/com.dennysetiawisnugraha.terminal-navigator/projects.enc` should report it as data, not zero-length. If corrupted and you have an export, restore it (§5). If you have no valid export, the data is unrecoverable — a real gap, see §9.
   **If instead you see the one-time migration prompt** (only possible on a machine whose data file is still in the pre-ADR-0014 encrypted format) and it rejects your password: that's either the wrong legacy master password, or the file is corrupted — same `file` check as above applies. A failed migration attempt does not touch the on-disk file (it only writes the new plain format after a successful decrypt), so retrying with the correct password is safe. If the legacy password is genuinely lost, that data is unrecoverable by design (same as it always was under ADR-0005) unless you have a pre-migration export.
2. **A terminal pane shows garbled/wrong input after a normal-looking build** → this is the bug class fixed in `ec19eff`. First check: does it happen when launched from a terminal AND from the desktop launcher? If only from the launcher, suspect the process environment again (compare `env` between the two launch methods, same technique used to find the TERM issue) before assuming a code regression.
3. **A terminal pane goes blank and stops accepting input, specifically when running a full-screen program (vim, htop, an AI CLI, ...)** → check whether it also happens under `npm run tauri dev`. If it only happens in the actual built `.deb`/binary, this is the bug class found 2026-07-22 (`docs/qa/test-plan.md` §5.1a — a Vite/esbuild production-minifier bug corrupting `@xterm/xterm`, worked around by minifying with **terser** instead of esbuild in `vite.config.js`). If a similar symptom recurs after a future Vite/esbuild/`@xterm/xterm` upgrade, first rebuild once with `minify: false` in `vite.config.js`: if that makes it work, it's a minifier-corruption pattern again (compare the minified `requestMode` in the built bundle against the `minify:false` output) rather than an app-code regression.
4. **Build fails** → re-run the pre-flight gate (§2) individually (`cargo test`, `vitest run`, `svelte-check`) to isolate which one is red; don't force a build past a failing gate.
5. **The installed build panics or crashes and the backtrace is only addresses** → expected: the release binary is stripped (§2 *Build*). Rebuild the same commit unstripped with `CARGO_PROFILE_RELEASE_STRIP=false npm run tauri build -- --no-bundle` (a full rebuild, ~4–5 min; the next normal build is full again), then reproduce with `RUST_BACKTRACE=1 src-tauri/target/release/terminal-navigator` (launch it from a terminal).
6. **Something else looks broken** → superpowers:systematic-debugging / the `debugger` skill, not this runbook.

## 7. Routine operations

- **Dependency updates:** no fixed cadence yet (personal project, casual pace per the PRD). When you do update (`cargo update`, `npm update`), re-run the full pre-flight gate before trusting the result.
- **Log locations:** none configured — the app doesn't currently write logs to a file. Errors surface in-app (pane status → `error`, with a message), or via `console.error` calls in the terminal-pane code visible in the WebKitGTK inspector — but Tauri's `devtools` feature is not enabled for release builds (this project has never opted into it in `Cargo.toml`/`tauri.conf.json`, and Tauri defaults it off in release regardless). **Reason for that changed with ADR-0014:** the original rationale here was that an always-open inspector could let anyone with local access read the unlock password straight out of a plain reactive store (`appStore.password`) — that store field and the encryption guarantee it protected are both gone now. Devtools stay off in release builds anyway, for the ordinary reason most shipped desktop apps do this (no need for a live console into a running instance you're not actively debugging), not because of any remaining secret-exposure risk. Use `npm run tauri dev` (which has devtools by default) when you need to inspect the console. There's no persistent log to grep after the fact either way — a gap, see §9.
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
| 1.12 | 2026-09-29 | §2 *Build*: the release profile now strips debug symbols (18.2 → 11.7 MB). Measured against the unprofiled build: runtime PSS the same within noise (3 alternating isolated launches each), incremental release rebuild 44 s. Full LTO + `codegen-units = 1` (9.0 MB) was measured and rejected: no RAM gain, ~7 min full / 2.5 min incremental builds. `panic` stays `unwind` (see the comment in `Cargo.toml`). §6 gains item 5, getting a symbolized build for a crash. |
| 1.11 | 2026-09-25 | Rehearsal log: first full §2 release pass since 0.1.0 recorded (0.2.1, all eight verify steps passed from the launcher). |
| 1.10 | 2026-09-25 | §2 *Versioning*: the two lockfiles are listed alongside the three manifests (the release to 0.2.1 found `package-lock.json` still at 0.1.0). |
| 1.9 | 2026-09-25 | §2 *Verify* step 6 wording updated for design v3.4 (padding 0 only while a TUI runs). No procedure change. |
| 1.8 | 2026-09-25 | §2 *Verify* step 6 wording updated for design v3.3 (terminal pane padding removed). No procedure change. |
| 1.7 | 2026-09-25 | §2 *Verify* step 6: also check the TUI in both halves of a split (a column-capacity bug showed only there). No procedure change. |
| 1.6 | 2026-09-25 | §2 *Verify* step 6 gains a check that a full-screen TUI reaches the pane's right edge (debugger fix for the margin beside opencode). No procedure change. |
| 1.5 | 2026-09-24 | Security audit v1.7 follow-ups. §2 *Verify* gains step 8 (runtime smoke-test for the least-privilege Tauri capability set — L9) and its "all seven/steps 1–7" wording becomes eight/1–8; §2 *GitHub Release* caveats record the read-only default token, the job-level write permission and the SHA pins with the procedure to bump them (L10). No change to build/rollback/backup procedures. |
| 1.4 | 2026-08-12 | Catch-up for ADR-0014 (master-password encryption removed, shipped commit `a3903de`) — documentation only, per this project's CLAUDE.md rule that contract docs stay true alongside the code they govern. §1: `projects.enc` is now plain, not encrypted (file-permission protection only); rewrote the "no secrets to manage" bullet to cover the one-time legacy-migration password instead of an ongoing master password. §2 step 1: removed the unlock step from release verification (only a genuinely pre-ADR-0014 machine ever sees a password prompt, and only once, ever — not a repeatable release check); step 5 no longer references the removed master-password-change flow. **§4 (highest-priority fix):** reversed the "safe to commit/sync even to a non-private location" backup advice — that was true only while the file was encrypted; exported data is plain now and may carry credentials from project notes, so the guidance is now to treat it like any other secret-bearing file (private locations only). §5: dropped the password step from restore; added a note that importing a genuinely pre-ADR-0014 export isn't supported directly (migrate the source machine first); marked the 2026-07-20 restore rehearsal stale, since the mechanism it rehearsed no longer exists. §6 item 1: reframed around the new startup flow and the one-time migration failure mode. §7: corrected the devtools-disabled-in-release rationale, which cited the now-removed `appStore.password`/FR-06 guarantee — devtools stay off in release builds regardless, now for the ordinary reason most shipped apps do this, not a secret-protection control. |
| 1.3 | 2026-07-29 | v2.8 (ADR-0013): native window decorations replaced by an in-app Title Bar. Added step 7 to §2's release verification (drag by the Title Bar, click every window control, resize from an edge/corner, double-click-to-maximize) — renumbered the old "if anything looks wrong" step 7 to step 8, "all six pass" to "all seven pass". Step 5's Settings trigger location updated (Title Bar's left zone as of v2.8, was the sidebar footer). Mirrors `docs/qa/test-plan.md` §5.1's new smoke-sequence step 6 for the same reason step 6 here mirrors that plan's own step 5: native decorations no longer supply drag/resize for free, the gesture is handled below the DOM (wry/window manager), and GTK CSD behavior varies by desktop environment — no automated test can stand in for this check. |
| 1.0 | 2026-07-20 | Initial runbook — written after discovering and fixing a launch-environment-dependent bug (missing `TERM` when launched from a desktop launcher, commit `ec19eff`) that a documented release-verification checklist would have caught before it reached daily use. |
| 1.1 | 2026-07-21 | Catch-up for FR-13 (Settings Panel, shipped in a prior session but not yet reflected here): documented the new unencrypted `settings.json` file in §1; added explicit callouts in §4/§5 that export/import only ever covers `projects.enc` — settings are neither backed up nor restored by that mechanism, and reset to defaults on a fresh install; noted in §7 that uninstall leaves `settings.json` in place same as `projects.enc`; added a Settings smoke-check as step 5 of §2's release verification. No code changed — documentation only, per this project's CLAUDE.md rule that contract docs stay true alongside the code they govern. |
| 1.2 | 2026-07-22 | Added step 6 to §2's release verification (run a full-screen TUI in a pane, e.g. `vim`) and a new §6 troubleshooting entry, after a debugger session found a `tauri build`-only bug (Vite production minification corrupting `@xterm/xterm`'s terminal-capability-query handling — full root cause in `docs/qa/test-plan.md` §5.1a and `vite.config.js`'s own comment) that steps 1–5 could not have caught: it never reproduced under `tauri dev`, and plain typing (step 3) never exercised the specific code path that broke. Fixed by disabling minification. |
| 1.3 | 2026-07-22 | Updated §6 troubleshooting item 3 to reflect the refined fix: the minifier bug is now worked around by switching to **terser** (keeps full minification) rather than disabling minification — see `docs/qa/test-plan.md` §5.1a / changelog 1.6. No release-procedure step changed (step 6's TUI check still applies verbatim). |
