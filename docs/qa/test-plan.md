# Test Plan — Terminal Navigator
> Version 1.0 · 2026-07-20 · Mode context: audit (first formal plan for an already-partially-tested MVP)
> Runner: `cargo test` (Rust, src-tauri) · Vitest (frontend, src) · CI: none yet (personal project, manual builds — see docs/ops/runbook.md §2 for the pre-flight gate that stands in for CI today)
> Oracles: docs/prd-terminal-navigator.md (FR acceptance criteria) · docs/backend/architecture.md §9 (documented risks) · current behavior where neither specifies

This is a personal, single-developer desktop tool (not a team project, not commercial software) — scope and rigor below are sized to that reality. The headline gap this plan exists to close: a real bug (garbled terminal input, fixed in commit `ec19eff`) reached daily use before being caught, because its trigger — *how the app is launched* — is a dimension unit tests structurally cannot exercise. §5's charter is the direct answer to that.

## 1. Risk map & coverage matrix

| Critical path | Damage if broken | Current protection | Target |
|---|---|---|---|
| Encrypted storage & master password (FR-06) | Total project-data loss, or encryption bypassed entirely | `crypto` (7 unit tests: roundtrip, key derivation determinism/uniqueness per password+salt, wrong-key failure) + `project_store` (11 tests incl. `data_file_on_disk_is_not_plaintext`) | ✅ automated — adequate |
| PTY spawn & shell I/O correctness (FR-03, FR-08) | Core value prop broken — unusable/garbled terminal (this is what actually happened) | `pty_manager` (7 unit tests: echo, setup-command auto-run, session isolation, **TERM regardless of parent env** — new) | ⚠️ automated for byte-level correctness *given a fixed environment*; **launch-context variability is not unit-testable** → manual charter (§5) |
| Project CRUD (FR-01, FR-02) | Lost/corrupted project list, bad path handling | `project_store` (add/update/delete, empty-name & nonexistent-path rejection) | ✅ automated — adequate |
| Auto-run setup commands (FR-04) | Setup commands silently skipped or run wrong | `command_runner` (4 tests) + `pty_manager::spawn_for_project_runs_setup_commands_automatically` | ✅ automated — adequate |
| Config export/import (FR-07) | Data loss on import (replace-only, per ADR-0008), or plaintext leak on export | `config_sync` (5 tests: missing source, wrong password, wholesale replace) — export literally copies the already-verified-encrypted file, so the "not a plaintext leak" acceptance criterion is transitively covered | ✅ automated — adequate |
| Split-pane / tab / focus management (FR-08 UI) | Wrong pane focused, lost session on switch, broken split layout — the class of bug fixed in `a29be45`/`ec19eff` | `terminal.svelte.test.ts` (store logic: split/remove/resize tree ops), `PaneNodeView.test.ts` (remount-on-session-change keying), `TerminalPane.test.ts` (mount/fit timing, write-ordering, resize-gating) | ✅ automated — this is exactly what got hardened this session |
| WebGL renderer fallback (architecture.md §9 risk 2) | Terminal fails to render / crashes on systems where WebGL context creation fails | `try/catch` fallback exists in `TerminalPane.svelte`; **not automated** — jsdom has no real WebGL, can't be unit-tested meaningfully | manual charter, low priority (§5.2) |
| **Launch-environment dependent behavior** (new risk, discovered this session — cross-cutting, not tied to one FR) | Silent corruption reaching daily use before being noticed (exactly what happened) | One unit test now pins the specific TERM mechanism found; **the general class ("environment differs by how the app is started") has no automated net** | manual charter — **primary deliverable of this plan** (§5.1) |

## 2. Suite layout & conventions

- **Rust:** `#[cfg(test)] mod tests` inline at the bottom of each module (`pty_manager/mod.rs`, `command_runner/mod.rs`, `crypto/mod.rs`, `project_store/mod.rs`, `config_sync/mod.rs`, `commands/mod.rs`). Run: `cd src-tauri && cargo test`.
- **Frontend:** `*.test.ts` co-located next to the file under test (e.g. `TerminalPane.svelte` + `TerminalPane.test.ts`). Run: `npx vitest run` (single run) or `npx vitest` (watch). Type-check separately: `npm run check`.
- **Naming:** Rust tests read as specifications (`spawned_shell_always_sees_term_xterm_256color_regardless_of_this_processs_own_env`); Vitest `describe`/`it` blocks name the regression they protect against, not just the mechanism (e.g. `"TerminalPane — keystroke write ordering (regression: typed characters arrived at the PTY out of order...)"`) — keep following this pattern, it's what made this session's fixes traceable.
- **Fakes:** real PTYs are spawned in Rust tests (via `portable-pty` against `/bin/sh`/`$SHELL` in a tempdir) rather than mocked — deliberate, since the PTY/shell boundary is exactly where past bugs lived; jsdom-side, `@xterm/xterm`, `@tauri-apps/api/event`, and `$lib/api` are mocked (there's no real webview/IPC available under Vitest) — `resizeTerminal`/`writeTerminal` mocks must resolve a Promise (not just be a bare `vi.fn()`), since `TerminalPane.svelte`'s write-queue chains on them.
- **No CI wired yet** — `docs/ops/runbook.md` §2's pre-flight gate (`cargo test && npx vitest run && npm run check`, all must be green) is run manually before every build. If this project ever gets a public git remote, wiring that gate into GitHub Actions is the natural next step (noted in the runbook's §9 deferred list too).

## 3. Test inventory by area

### 3.1 Encryption & storage (`src-tauri/src/crypto`, `project_store`)
| Behavior under test | Level | File | Oracle |
|---|---|---|---|
| Encrypt→decrypt roundtrip preserves data | unit | `crypto/mod.rs` | FR-06 |
| Same password+salt derives the same key; different password/salt derives a different one | unit | `crypto/mod.rs` | ADR-0005 |
| Wrong key fails to decrypt | unit | `crypto/mod.rs` | FR-06 |
| Data file on disk is not plaintext | unit | `project_store/mod.rs` | FR-06 acceptance criterion |
| Add/update/delete project; empty name & nonexistent path rejected | unit | `project_store/mod.rs` | FR-01, FR-02 |
| Data persists across unlock calls; wrong password fails unlock | unit | `project_store/mod.rs` | FR-06 |

### 3.2 Terminal / PTY (`src-tauri/src/pty_manager`, `command_runner`)
| Behavior under test | Level | File | Oracle |
|---|---|---|---|
| Spawned shell echoes a written command | integration (real PTY) | `pty_manager/mod.rs` | FR-03 |
| Setup commands auto-run on spawn | integration (real PTY) | `pty_manager/mod.rs` | FR-04 |
| Two sessions are independent; closing one doesn't affect the other | integration (real PTY) | `pty_manager/mod.rs` | ADR-0007 |
| Write/close on unknown session fails cleanly | unit | `pty_manager/mod.rs` | error-path correctness |
| **Spawned shell always sees `TERM=xterm-256color` regardless of this process's own env** | integration (real PTY) | `pty_manager/mod.rs` | regression, commit `ec19eff` |
| Setup commands written one per line, blanks skipped, write failure propagates | unit | `command_runner/mod.rs` | FR-04 |

### 3.3 Terminal pane UI (`src/lib/components/TerminalPane.svelte`, `PaneNodeView.svelte`)
| Behavior under test | Level | File | Oracle |
|---|---|---|---|
| Initial `fit()` deferred past the first paint (not called synchronously on mount) | unit (Vitest) | `TerminalPane.test.ts` | xterm.js FitAddon race, documented in-code |
| Keystrokes are relayed to the backend in the order typed, even if the backend resolves them out of order | unit (Vitest) | `TerminalPane.test.ts` | regression, commit `ec19eff` |
| No keystroke reaches the backend before the pane's initial resize is confirmed applied | unit (Vitest) | `TerminalPane.test.ts` | regression, commit `ec19eff` |
| A single-pane leaf remounts (fresh xterm.js instance + refocus) when its session id changes; does *not* remount when only unrelated props change | unit (Vitest) | `PaneNodeView.test.ts` | regression, commit `a29be45` |

### 3.4 Project list & config sync (`src/lib/patterns/Sidebar.svelte`, `src-tauri/src/config_sync`)
| Behavior under test | Level | File | Oracle |
|---|---|---|---|
| Export fails when nothing saved yet; export copies the data file | unit | `config_sync/mod.rs` | FR-07 |
| Import fails when source missing or password wrong; import replaces local data wholesale | unit | `config_sync/mod.rs` | FR-07, ADR-0008 |
| Sidebar export/import UI wiring, project list rendering, drag-to-split | unit (Vitest) | `Sidebar.test.ts` | FR-01, FR-08 |

## 4. Safety-net register

Not applicable — no refactor/migration is currently planned (SAFETY-NET mode not active). If a significant refactor (e.g. changing the PTY library or storage engine) is ever planned, characterization tests should be added here *before* that work starts, per this skill's SAFETY-NET mode.

## 5. Manual test charters

### 5.1 Launch-environment charter (primary — the gap that let `ec19eff` reach daily use)

**Goal:** catch bugs that depend on *how the OS process was started*, not on the app's code paths — these produce a different process environment (env vars, session type, cgroup) that unit tests, which always run inside a developer's own terminal-launched shell, cannot reproduce.

**Why this is a real, recurring risk, not a one-off:** the TERM-unset bug is the textbook case, but the same *class* of gap could resurface via other env-dependent behavior (locale/`LANG` affecting text width or wide-character handling, `DISPLAY`/`WAYLAND_DISPLAY` differing between X11 and native Wayland launches, `XDG_*` paths resolving differently). Treat this charter as standing, not a one-time check for this specific bug.

**Scope — for each launch method below, run this 2-minute smoke sequence:**
1. Launch the app.
2. Unlock, open any project's terminal.
3. Type a single letter, press Backspace, type another letter. **Pass:** display exactly matches what was typed, no duplicated/overlapping characters, no phantom spaces. **Fail signature:** see commit `ec19eff`'s description for exactly what this looked like.
4. Open a second project tab, split a pane, close a pane.

**Launch methods to cover (current):**
| Method | Why it matters | Status |
|---|---|---|
| Terminal (`/usr/bin/terminal-navigator`) | Baseline — has a full interactive shell environment | ✅ passes (2026-07-20) |
| GNOME Activities / app grid (`.desktop` file activation) | No parent terminal at all — this is the path that surfaced `ec19eff` | ✅ passes as of the TERM fix (2026-07-20) |

**Launch methods to cover if/when relevant (not yet exercised — low current priority, add if the situation arises):**
| Method | Trigger to add it |
|---|---|
| Pinned to GNOME dock/taskbar favorites | Same underlying `.desktop` activation as the app grid — expected to behave identically; spot-check once if ever pinned |
| Autostart on login (systemd `--user` or XDG autostart) | Only relevant if the "daily-driver" milestone (PRD §7) leads to configuring autostart — a third, different environment context worth a dedicated pass at that point |
| File manager double-click on the `.desktop` file directly | Low likelihood (the file lives in `/usr/share/applications`, not somewhere a user browses to) — skip unless a specific report suggests it |

**Cadence:** every release, as §2 of `docs/ops/runbook.md` (the release verification checklist already bakes steps 1–3 of this charter in as a *mandatory* gate — this charter is the broader QA rationale; the runbook is the operational enforcement). Don't let the two drift: if the runbook's verification steps change, update this charter's table to match, and vice versa.

**Findings log:** record results directly in this table (date + pass/fail) and in `docs/ops/runbook.md`'s rehearsal log — don't maintain a third location.

### 5.2 WebGL renderer fallback (low priority)

**Goal:** confirm the `try/catch` around `WebglAddon` construction (`TerminalPane.svelte`) actually results in a usable (if less optimal) terminal when WebGL is unavailable — architecture.md §9 risk 2 flags this as unverified.

**Scope:** on the current dev machine, temporarily force a WebGL failure (e.g. via `WEBKIT_DISABLE_COMPOSITING_MODE=1` or a debug flag that skips the WebGL addon) and confirm the terminal still renders and accepts input correctly using the default renderer.

**Time-box:** 10 minutes, one-time — this only needs re-checking if `@xterm/addon-webgl` or the Tauri/WebKitGTK version changes meaningfully.

**Cadence:** once now (not yet done — see §6), then only on major dependency bumps to xterm.js/Tauri.

## 6. Accepted gaps

| Gap | Reason | Revisit trigger |
|---|---|---|
| §5.2 (WebGL fallback) not yet actually run | Lower priority than §5.1; the fallback code path exists and is simple (`try { … } catch {}`) | Before the next `@xterm/addon-webgl` or Tauri version bump, or if a rendering bug report ever surfaces |
| No automated test for the Rust `commands/mod.rs` Tauri command handlers themselves (`open_terminal`, `write_terminal`, etc.) beyond `path_exists` | They're thin wrappers (architecture.md §10 rule 2: "no business logic lives here") delegating to already-tested `pty_manager`/`project_store` — the risk lives in the delegated modules, which are covered | If a command handler ever grows real logic of its own (contradicting its own thin-wrapper design rule) |
| No cross-platform (Windows/macOS) testing | architecture.md §9 risk 4 — not blocked, just not attempted; this app only runs on the author's own Debian 12 machine today | If/when the author actually wants to run this on another OS |
| No CI pipeline running any of this automatically | Personal project, no git remote configured yet (see `docs/ops/runbook.md` §9) | If this repo ever gets a public/shared remote |

## 7. Instructions for AI agents

1. **New backend features ship with tests** at the level shown in §3 — Rust: inline `#[cfg(test)] mod tests` using real PTYs/tempdirs where the boundary being tested is PTY/filesystem/crypto; Vitest: co-located `*.test.ts`, mocking only the Tauri IPC/xterm.js boundary, never the component's own logic.
2. **Never weaken the net**: don't delete/skip/loosen an existing test to get the suite green — fix the code, or if the test's premise is actually wrong, say so explicitly and update this doc's §3 row for it in the same change.
3. **Environment-dependent behavior is not "just a unit test problem"** — if a bug's trigger involves *how the process was launched* or *what's in its environment* (not just its inputs), add it to §5.1's charter, don't just chase it with more mocked unit tests that will pass regardless (this session's early debugging spent real time on exactly this mistake before finding the actual `TERM` cause).
4. **Determinism rules bind**: no `sleep()`-based synchronization (use fake timers / explicit promise resolution — see `TerminalPane.test.ts`'s pattern), no real network calls, real PTYs are fine (they're the boundary under test, not an external dependency to fake).
5. **Update §1 and §3 in the same change-set** as any tests you add or remove.
6. **Uncovered decisions**: mirror the closest existing area's pattern (e.g. a new backend module spawning a subprocess should follow `pty_manager`'s real-process-in-tempdir style, not introduce mocking).

## 8. Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-20 | Initial test plan, written after the `ec19eff` debugging session exposed that launch-environment-dependent bugs have no automated net — §5.1's charter is the direct response. |
