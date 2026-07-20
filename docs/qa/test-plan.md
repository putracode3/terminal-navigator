# Test Plan — Terminal Navigator
> Version 1.2 · 2026-07-21 · Mode context: FEATURE-QA (closing the one real gap the v1.1 audit found — see §8)
> Runner: `cargo test` (Rust, src-tauri) · Vitest (frontend, src) · CI: none yet (personal project, manual builds — see docs/ops/runbook.md §2 for the pre-flight gate that stands in for CI today)
> Oracles: docs/prd-terminal-navigator.md (FR acceptance criteria) · docs/backend/architecture.md §9 (documented risks) · current behavior where neither specifies

This is a personal, single-developer desktop tool (not a team project, not commercial software) — scope and rigor below are sized to that reality. The headline gap this plan exists to close: a real bug (garbled terminal input, fixed in commit `ec19eff`) reached daily use before being caught, because its trigger — *how the app is launched* — is a dimension unit tests structurally cannot exercise. §5's charter is the direct answer to that.

## 1. Risk map & coverage matrix

| Critical path | Damage if broken | Current protection | Target |
|---|---|---|---|
| Encrypted storage & master password (FR-06, FR-13 rotation) | Total project-data loss, or encryption bypassed entirely; a rotation bug specifically could brick the data file or silently desync the in-memory key from what's on disk | `crypto` (7 unit tests: roundtrip, key derivation determinism/uniqueness per password+salt, wrong-key failure) + `project_store` (17 tests incl. `data_file_on_disk_is_not_plaintext`, and — FR-13 — `change_password`'s rotation: allows unlock with the new password afterward, rejects the old password post-rotation, rejects a wrong current password *without mutating anything on disk*, rejects an empty new password, and `persist()`'s atomic temp-file+rename leaves no leftover temp file) | ✅ automated — adequate. Code review caught and fixed one real ordering bug pre-merge (`change_password` mutated `self.salt` before the new key derivation was known to succeed — a failure at that exact point would have left the salt and key mismatched in memory, corrupting the next save); the current tests don't reach that specific failure mode (it needs a way to force `derive_key` to fail, not set up in this project) but the fix itself removed the code path that could trigger it, so this is a design-level rather than test-level closure — worth knowing this row's history includes a genuine near-miss, not just a clean build |
| PTY spawn & shell I/O correctness (FR-03, FR-08) | Core value prop broken — unusable/garbled terminal (this is what actually happened) | `pty_manager` (7 unit tests: echo, setup-command auto-run, session isolation, **TERM regardless of parent env** — new) | ⚠️ automated for byte-level correctness *given a fixed environment*; **launch-context variability is not unit-testable** → manual charter (§5) |
| Project CRUD (FR-01, FR-02) | Lost/corrupted project list, bad path handling | `project_store` (add/update/delete, empty-name & nonexistent-path rejection) | ✅ automated — adequate |
| Auto-run setup commands (FR-04) | Setup commands silently skipped or run wrong | `command_runner` (4 tests) + `pty_manager::spawn_for_project_runs_setup_commands_automatically` | ✅ automated — adequate |
| Config export/import (FR-07) | Data loss on import (replace-only, per ADR-0008), or plaintext leak on export | `config_sync` (5 tests: missing source, wrong password, wholesale replace) — export literally copies the already-verified-encrypted file, so the "not a plaintext leak" acceptance criterion is transitively covered | ✅ automated — adequate |
| Split-pane / tab / focus / zoom / tab-cycling (FR-08 UI, FR-13 follow-up) | Wrong pane focused, lost session on switch, broken split layout, or lost scrollback on split — the class of bug fixed in `a29be45`/`ec19eff`, plus two more this session: (1) blank/unscrollable pane on tab *switch*, and (2) a related but distinct bug where splitting a tab's *only* pane remounted it and lost its scrollback (root cause: Svelte's `{#if leaf}/{:else split}` branch flip discarded and recreated the existing `TerminalPane`, fixed by always rendering through one keyed `{#each}` so the leaf→split transition reconciles by key instead of flipping branches) | `terminal.svelte.test.ts` (56 tests: split/remove/resize tree ops, `moveFocus`/`findPaneInDirection` keyboard pane-focus traversal, `cycleActiveTab` tab-cycling wrap-around), `PaneNodeView.test.ts` (8 tests: remount-on-session-change keying), `TerminalPane.test.ts` (28 tests: mount/fit timing, write-ordering, resize-gating, rebindable clipboard shortcuts, **zoom in/out via keyboard (Ctrl+=/Ctrl+-) and Ctrl+Scroll — including the regression that the wheel handler must go through xterm.js's own `attachCustomWheelEventHandler`, not a DOM listener, or it fails to suppress xterm's own wheel handling**), `TerminalArea.test.ts` (14 tests: backgrounded tabs stay mounted across switches, keyboard pane-split/move-focus/tab-cycle wiring including the `stopPropagation` regression, and the split-loses-scrollback regression) | ✅ automated — hardened twice this session (tab-switch remount, then the pane-split remount). One related but harder variant is a documented, deliberately accepted gap, not silently dropped — see §6 |
| Non-sensitive settings persistence: theme, keybindings, sidebar position (FR-13) | Settings silently fail to save/load, two actions end up sharing one keybinding (whichever fires first would win unpredictably), or theme/position revert without explanation | Backend: `settings_store` (7 unit tests: load-defaults-when-missing, save/load roundtrip, generic duplicate-keybinding rejection, corrupted-file detection, atomic-write leaves no leftover temp file). Frontend: `keybindings.test.ts` (14 tests: canonical combo formatting incl. the Equal/Minus/Tab physical-key mappings, registry shape), `theme-presets.test.ts` (5), `ThemePresetCard.test.ts` (5), `KeybindingRow.test.ts` (15: the recording/conflict/rejected state machine, Escape/Tab precedence, the Ctrl-Tab-capture fix), `SegmentedControl.test.ts` (5), `SettingsModal.test.ts` (16: wiring, autosave-with-rollback, the mutual-exclusion fix for simultaneous recording, master password change flow), `settings.svelte.test.ts` (5: `load()` applies every field and flips `loaded`, replaces rather than merges prior state, propagates a rejected `getSettings()` without flipping `loaded`) | ✅ automated — adequate. The `settingsStore.load()` gap flagged in the v1.1 audit is closed as of v1.2 |
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
| `change_password`: succeeds and the new password unlocks afterward; the old password stops working; a wrong current password is rejected *without* touching the on-disk file; an empty new password is rejected | unit | `project_store/mod.rs` | FR-13, ADR-0010 |
| `persist()`'s atomic write (temp file + rename) leaves no leftover temp file after a save | unit | `project_store/mod.rs` | ADR-0010 |

### 3.2 Terminal / PTY (`src-tauri/src/pty_manager`, `command_runner`)
| Behavior under test | Level | File | Oracle |
|---|---|---|---|
| Spawned shell echoes a written command | integration (real PTY) | `pty_manager/mod.rs` | FR-03 |
| Setup commands auto-run on spawn | integration (real PTY) | `pty_manager/mod.rs` | FR-04 |
| Two sessions are independent; closing one doesn't affect the other | integration (real PTY) | `pty_manager/mod.rs` | ADR-0007 |
| Write/close on unknown session fails cleanly | unit | `pty_manager/mod.rs` | error-path correctness |
| **Spawned shell always sees `TERM=xterm-256color` regardless of this process's own env** | integration (real PTY) | `pty_manager/mod.rs` | regression, commit `ec19eff` |
| Setup commands written one per line, blanks skipped, write failure propagates | unit | `command_runner/mod.rs` | FR-04 |

### 3.3 Terminal pane UI (`src/lib/components/TerminalPane.svelte`, `PaneNodeView.svelte`, `src/lib/patterns/TerminalArea.svelte`)
| Behavior under test | Level | File | Oracle |
|---|---|---|---|
| Initial `fit()` deferred past the first paint (not called synchronously on mount) | unit (Vitest) | `TerminalPane.test.ts` | xterm.js FitAddon race, documented in-code |
| Keystrokes are relayed to the backend in the order typed, even if the backend resolves them out of order | unit (Vitest) | `TerminalPane.test.ts` | regression, commit `ec19eff` |
| No keystroke reaches the backend before the pane's initial resize is confirmed applied | unit (Vitest) | `TerminalPane.test.ts` | regression, commit `ec19eff` |
| A single-pane leaf remounts (fresh xterm.js instance + refocus) when its session id changes; does *not* remount when only unrelated props change | unit (Vitest) | `PaneNodeView.test.ts` | regression, commit `a29be45` |
| Switching the active sidebar session away and back does NOT recreate a tab's xterm.js Terminal (every open tab's pane tree stays mounted, only the active one is shown/hidden via CSS); the backgrounded tab's DOM persists hidden, not unmounted; its pane is re-focused on return | unit (Vitest) | `TerminalArea.test.ts` | regression — switching tabs previously destroyed and recreated the inactive tab's `TerminalPane`, silently losing all buffered output/scrollback even though the backend PTY session was still running |
| A resize notification firing while a pane is backgrounded (`active=false`) does not fit()/resize the backend; one still fires and is applied once the pane is reactivated | unit (Vitest) | `TerminalPane.test.ts` | regression — backgrounding a tab collapses its container to 0x0, and the ResizeObserver fired for that collapse like any other resize, shrinking the xterm.js buffer and backend PTY toward 0 and then straight back up on return; switching tabs quickly let that shrink/grow race land mid-flight, visibly flashing the terminal at the wrong size before it settled |
| Splitting a tab's *only* pane does not recreate the pre-existing pane's xterm.js `Terminal` (no lost scrollback) | unit (Vitest) | `TerminalArea.test.ts` | regression, this session — root cause was a Svelte `{#if leaf}/{:else split}` branch flip discarding the existing `TerminalPane`; fixed in `PaneNodeView.svelte` by always rendering through one keyed `{#each}` |
| Ctrl+=/Ctrl+- zoom in/out (font size, clamped 8–32px, no redundant re-fit once clamped); Ctrl+Scroll zooms via `term.attachCustomWheelEventHandler` (not a DOM listener — the regression: an ancestor DOM listener runs too late to stop xterm's own default wheel handling, which without scrollback sends literal arrow-key sequences to the shell) | unit (Vitest) | `TerminalPane.test.ts` | FR-13 follow-up, architecture.md §5.6; regression found in code review |
| Ctrl+Tab/Ctrl+Shift+Tab cycle the active tab, wrapping at both ends, no-op with 0–1 tabs; the keydown handler calls `stopPropagation` (not just `preventDefault`) so it can't also leak into the focused pane as typed input | unit (Vitest) | `terminal.svelte.test.ts` (`cycleActiveTab`), `TerminalArea.test.ts` (wiring + regression) | FR-13 follow-up, architecture.md §5.6 |
| Keyboard pane split (Alt+Shift+D/R) and move-focus (Alt+Arrow×4) call both `preventDefault` and `stopPropagation`; skipped while a Modal (e.g. Settings) is open; rebinding any of these actions changes which keys trigger them | unit (Vitest) | `TerminalArea.test.ts` | FR-13, code review B1 (missing `stopPropagation` was a real bug, fixed) |

### 3.4 FR-13 Settings Panel (backend: `src-tauri/src/settings_store`; frontend: `src/lib/keybindings.ts`, `theme-presets.ts`, `stores/settings.svelte.ts`, `components/{ThemePresetCard,KeybindingRow,SegmentedControl}.svelte`, `patterns/SettingsModal.svelte`)
| Behavior under test | Level | File | Oracle |
|---|---|---|---|
| Settings load-or-default on missing file; save/load roundtrip; generic keybinding-conflict rejection (works for any action id, doesn't need to know what an action does); corrupted-file detection; atomic write leaves no leftover temp file | unit | `settings_store/mod.rs` | ADR-0009 |
| Canonical combo-string formatting (`formatCombo`) — modifier order, the `Equal`→`=`/`Minus`→`-` physical-key mapping (without which `Ctrl+=`/`Ctrl+-` could never match their own defaults), `Tab` passthrough for tab-cycling; `hasRequiredModifier` accepts Ctrl/Alt/Cmd, rejects Shift-alone | unit (Vitest) | `keybindings.test.ts` | components.md Keybinding Row |
| All 4 theme presets (App Default, Dracula, Nord, Solarized Dark) define background/foreground/cursor/cursorAccent + all 16 ANSI colors as valid hex; `getThemePreset` falls back to App Default for an unknown id | unit (Vitest) | `theme-presets.test.ts` | design.md §4.5 |
| Theme Preset Card: radiogroup/radio semantics, selected state, preview renders the preset's actual colors (not a stylized abstraction) | unit (Vitest) | `ThemePresetCard.test.ts` | components.md |
| Keybinding Row: recording/conflict/rejected state machine; Escape cancels recording without propagating to close the Settings modal; bare Tab/Shift+Tab still cancels recording (lets modal focus-trap work normally) but a *modified* Tab (e.g. Ctrl+Tab) now falls through to normal capture — a real bug fixed this session; a bare-modifier keydown (e.g. Ctrl alone) doesn't resolve a capture prematurely | unit (Vitest) | `KeybindingRow.test.ts` | components.md; regression (Tab-capture fix) |
| Segmented Control: radiogroup semantics, arrow-key navigation with wraparound, roving tabindex | unit (Vitest) | `SegmentedControl.test.ts` | components.md |
| Settings Panel: renders all 4 sections; theme/sidebar-position autosave immediately (and roll back + surface an error on save failure — a real bug fixed in code review, previously a silent unhandled rejection); keybinding conflict messages name the actual other action; master password change flow (client-side mismatch check, success clears fields, wrong-current-password error); at most one Keybinding Row can record at a time (a real bug fixed in code review — two rows could otherwise both capture the same keystroke); password fields reset when the modal is reopened without submitting (also a code-review fix) | unit (Vitest) | `SettingsModal.test.ts` | components.md Settings Panel pattern |
| `settingsStore.load()`: applies `themePreset`/`keybindings`/`sidebarPosition` from `getSettings()` and sets `loaded = true`; a second `load()` replaces the prior in-memory values rather than merging with them; a rejected `getSettings()` call propagates the rejection and leaves `loaded` false and the previous values untouched | unit (Vitest) | `settings.svelte.test.ts` | ADR-0009; closes the gap flagged in test-plan v1.1's audit |

### 3.5 Project list & config sync (`src/lib/patterns/Sidebar.svelte`, `src-tauri/src/config_sync`)
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
| No automated test for the Rust `commands/mod.rs` Tauri command handlers themselves (`open_terminal`, `write_terminal`, etc.) beyond `path_exists` | They're thin wrappers (architecture.md §10 rule 2: "no business logic lives here") delegating to already-tested `pty_manager`/`project_store` — the risk lives in the delegated modules, which are covered. **Caveat found by `docs/security/audit-2026-07-20.md` (M1):** this reasoning doesn't cover each handler's *own* lock-state gate — `split_pane` was missing its check despite every delegated module being fine, since the gate itself lives in the handler, not in what it delegates to. Testing this properly needs `tauri::test`'s app-mocking utilities, not yet set up in this project — a disproportionate addition for one line today, so this remains a manual-review item per handler until/unless more handler-level logic accumulates | If a command handler ever grows real logic of its own, or if a second lock-state gating gap is ever found (pattern, not one-off) |
| No cross-platform (Windows/macOS) testing | architecture.md §9 risk 4 — not blocked, just not attempted; this app only runs on the author's own Debian 12 machine today | If/when the author actually wants to run this on another OS |
| No CI pipeline running any of this automatically | Personal project, no git remote configured yet (see `docs/ops/runbook.md` §9) | If this repo ever gets a public/shared remote |
| Splitting a pane *perpendicular* to its parent split's existing direction (on an already 2+-pane tab) still remounts the pane being split, losing its scrollback — a sibling of the root-leaf remount bug fixed this session, but a harder fix (the new split-wrapper node gets a fresh random id, breaking `{#each}` key continuity for the wrapped child in a way the root-leaf fix's technique doesn't reach) | Doesn't match the originally-reported symptom (an *unrelated* pane losing scroll) — this variant remounts the pane actually being split, a smaller/different-shaped bug. Documented as a real, verified-failing `it.skip` test (`TerminalArea.test.ts`), not silently dropped | If this specific variant is ever reported by actual use, or before any further work touches `insertNode`'s cross-direction branch in `terminal.svelte.ts` |

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
| 1.1 | 2026-07-20 | Catch-up pass (no new tests written — documentation only, per this project's CLAUDE.md rule that contract docs stay true alongside the code they govern): §1 updated for FR-13 (`change_password` rotation folded into the existing encrypted-storage row; new row for non-sensitive settings persistence), and for the split-pane-loses-scrollback bug + zoom + tab-cycling (folded into the existing split-pane/tab/focus row). §3 extended: new rows in §3.1/§3.3 for `change_password`/zoom/tab-cycling, new §3.4 for the whole FR-13 Settings Panel area (settings_store + 6 frontend files/components), old §3.4 (Project list & config sync) renumbered to §3.5. §6 gained two real findings from this audit, not just from implementation: the perpendicular-split known gap (already an `it.skip` in code) and — newly found during this pass — `settingsStore.load()` has zero test coverage anywhere, direct or indirect. |
| 1.2 | 2026-07-21 | Closed the `settingsStore.load()` gap flagged in v1.1: added `src/lib/stores/settings.svelte.test.ts` (5 tests — field application + `loaded` flip, replace-not-merge on a second `load()`, and rejection propagation leaving `loaded` false with prior values intact). §1's settings-persistence row and §3.4 updated to reflect it; the corresponding §6 accepted-gap row removed (closed, not accepted-forever). Full suite re-run: 285 passed, 1 pre-existing skip (the still-open perpendicular-split gap), `npm run check` clean. |
