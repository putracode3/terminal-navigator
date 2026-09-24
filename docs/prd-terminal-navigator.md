# PRD: Terminal Navigator

> **Status:** In Development — MVP (FR-01–FR-08) implemented, undergoing real-world daily-driver testing; FR-13 (Settings) implemented 2026-07-20; FR-11 (Sidebar Folders) implemented 2026-07-21 (commit `4672712`); FR-14 (Glassmorphic Surfaces) implemented 2026-07-22 (commits `d423ec8`, `efd4cf5`); FR-15 (Native Transparent Window) implemented 2026-07-22 (commits `f44736a`, `ef3d63b`, `e85d27c`), with a follow-up transparent-padding fix 2026-07-23; FR-16 (Clickable Terminal Links) implemented 2026-07-24; FR-17 (Pane Title Shows Active Git Branch) implemented 2026-07-24, with a focus-refresh + manual-refresh follow-up the same day; **FR-06 (Encrypted Local Storage) removed 2026-08-12 (ADR-0014)** — master password / encryption at rest dropped as not worth the daily-use friction for a single-user local tool; data is now a plain file, migrated automatically (one-time, on first load) from the previous encrypted format; **FR-01 amended 2026-08-12** — first launch now pre-seeds the list with a "Home" entry; **FR-01 amended again 2026-08-13** — window launch now auto-opens a terminal on that seeded entry; **FR-01 amended a third time 2026-08-13 (debugger session)** — the launch auto-open now falls back to opening a terminal at the platform home directory directly when no "Home" entry exists to reuse, fixing installs whose data predates the Home-seed; **FR-08 amended 2026-08-21 (routed via project-navigator → ui-ux-designer)** — a pane's own header is now also a drag handle, letting the user drag an already-open pane onto another pane in the same tab to relocate it right/bottom/left/top; **FR-08 amended again 2026-08-21 (routed via project-navigator → backend-implementer)** — closed that feature's own accessibility gap with a keyboard equivalent (`pane.moveLeft`/`moveRight`/`moveUp`/`moveDown`); **FR-01 amended a fourth time 2026-09-24 (routed via project-navigator → backend-implementer)** — the "Home" entry is no longer an ordinary, deletable entry: it's now the sidebar's permanent default and its Delete action is rejected (backend) / hidden (sidebar menu). Renaming it away from "Home" first makes it an ordinary, deletable entry again — only the name "Home" is protected, not a specific record | **Version:** 1.18 | **Date:** 2026-09-24 | **Author:** dennysetiawisnugraha@gmail.com

---

## 1. Overview

### Problem Statement
Solo developer mengelola banyak project lokal sekaligus. Workaround saat ini (Tilix + zsh) tidak bisa menyimpan session — setiap mau development harus buka terminal baru, `cd` manual ke path project, lalu menjalankan ulang command setup yang sama (misal `nvm use`, `source venv`, `docker-compose up`). Ini repetitif dan tidak portable — begitu pindah device, seluruh setup itu hilang dan harus diulang dari nol.

### Product Vision
Aplikasi desktop (Rust + Tauri) yang berfungsi sebagai **project launcher + terminal**, mirip Termius tapi untuk path project lokal alih-alih remote SSH host. User menyimpan daftar project (path, command auto-run, notes), lalu cukup klik satu project untuk langsung mendapat terminal yang sudah berada di path tersebut dan siap pakai seperti biasa.

### Goals & Non-Goals
**In scope:**
- Menyimpan dan mengelola daftar project lokal (path)
- Membuka terminal langsung ter-`cd` ke path project yang dipilih
- Auto-run command tertentu saat project dibuka
- Notes per project, disimpan terenkripsi
- Portabilitas konfigurasi antar device (sync via git commit file config, atau export/import manual)

**Out of scope:**
- Remote SSH connection management (fitur inti Termius yang **tidak** direplikasi)
- SFTP / file transfer
- Multi-user / team sharing — aplikasi ini single-user

---

## 2. Users & Stakeholders

| Role | Description | Key Need |
|---|---|---|
| Primary User | Solo developer (pembuat aplikasi sendiri), mengelola banyak project lokal, baru mulai belajar Rust & Tauri | Berhenti mengetik `cd` + command setup berulang; punya satu tempat untuk lompat ke project mana pun dengan sekali klik |
| Stakeholder | — (tidak ada, proyek personal) | — |

---

## 3. User Stories

*As a [role], I want [action], so that [outcome].*

- **US-01** — As the user, I want to add a project by browsing to its folder (or typing the path manually), so that I don't have to remember or retype full paths.
- **US-02** — As the user, I want to click a project in the list, so that a terminal opens already `cd`-ed into that project's path.
- **US-03** — As the user, I want to define one or more setup commands per project, so that they run automatically every time I open that project (e.g. `nvm use`, `source venv/bin/activate`).
- **US-04** — As the user, I want to write and edit notes per project, so that I can keep context (TODO, credentials reminders, quirks) without leaving the app.
- ~~**US-05** — As the user, I want my notes and commands stored encrypted, so that sensitive info (API keys, credentials) in them isn't exposed in plaintext on disk.~~ — **removed 2026-08-12 (ADR-0014):** the author decided the master-password friction wasn't worth it for daily use on a single-user local machine; data is now a plain file.
- **US-06** — As the user, I want to export/import my project list (or sync it via a git-committed config file), so that I can carry my setup across devices.
- **US-07** — As the user, I want to remove or edit an existing project entry, so that my list stays accurate as projects come and go.
- **US-08** — As the user, I want a single Settings panel to customize terminal theme, rebind any keyboard shortcut, and switch which side the sidebar sits on, so that I can adjust the app to my preference without hand-editing config files. (Master-password-change clause removed 2026-08-12, ADR-0014 — no master password left to change.)
- **US-09** — As the user, I want to organize related projects into folders via drag-and-drop in the sidebar, so that I can navigate a growing project list without scrolling through one long flat list.
- **US-10** — As the user, I want the app's panels to have an adjustable frosted-glass look, so that the app feels visually lighter and layered to my taste instead of a flat wall of opaque boxes.
- **US-11** — As the user, I want the app window itself to be see-through to my desktop, adjustable to my taste, so that it sits in my desktop the way Tilix does instead of blocking it out as a solid slab.

---

## 4. Functional Requirements

### 4.1 MVP (Must Have)

#### FR-01: Project List Management (CRUD)
- **Description:** User can add, edit, and delete project entries. Each entry holds: name/label, local path, optional setup command(s), optional notes.
- **Acceptance Criteria:**
  - [ ] User can add a new project entry
  - [ ] User can edit an existing entry's name, path, commands, notes
  - [ ] User can delete an entry (with confirmation)
  - [ ] List persists across app restarts
  - [ ] **Added 2026-08-12:** on first launch (no data file exists yet), the list is pre-seeded with one entry named "Home" pointing at the OS user's home directory, so the sidebar is never empty before the user has added anything themselves — editable like any other entry from then on
  - [ ] **Amended 2026-09-24:** ~~not protected/special-cased~~ — the entry named "Home" can no longer be deleted; the sidebar's Delete action is hidden for it and the backend rejects a delete attempt regardless (`ProjectStoreError::ProtectedEntry`). Matched by name (the same lookup the launch auto-open below already uses), not by a separate identity field — so renaming it away from "Home" makes it an ordinary, deletable entry again, and a user-created entry also literally named "Home" is equally protected
  - [ ] **Added 2026-08-13:** on every app window launch, if no terminal tab is open yet, a tab is auto-opened for the entry named "Home" (found by name, same lookup as any other project — not a separate protected reference) so the app never starts on an empty terminal area. No-ops silently (not an error) when no such entry exists — user deleted or renamed it, or the sidebar is genuinely empty
  - [ ] **Amended 2026-08-13 (debugger session):** when there's no "Home" *entry* to auto-open — most commonly an install whose data file already existed before the 2026-08-12 Home-seed shipped, so it was never seeded and never will be (seeding is one-time, on a brand-new store only) — the launch auto-open falls back to opening a terminal at the platform home directory directly, bypassing the project store entirely (nothing is added to the sidebar). Only a genuinely unresolvable home directory still results in the empty-state placeholder.
- **Edge cases:**
  - Path no longer exists on disk at launch time (moved/deleted project) → entry should be flagged/visually marked invalid, not silently fail
  - Duplicate paths added twice → allowed but should warn, not blocked (user may want two entries with different commands for same path)
  - Home directory can't be resolved (unusual/sandboxed environment), or the user deletes the seeded Home entry and their list later empties back out → both cases fall back to a genuinely empty list, not an error; the seed is a one-time first-launch convenience, not an invariant the app enforces afterward. The launch auto-open's own home-directory fallback (above) shares this same "can't be resolved → no-op, not an error" rule.

#### FR-02: Add Project via Browse or Manual Path Entry
- **Description:** When adding a project, user can pick the folder via a native file/folder browse dialog (default/primary method), or type the path manually as an alternative.
- **Acceptance Criteria:**
  - [ ] "Browse" button opens native OS folder picker
  - [ ] Selected folder path auto-fills the path field
  - [ ] Manual text input for path remains available and editable
  - [ ] Invalid/non-existent typed path is validated before save

#### FR-03: Open Terminal at Project Path
- **Description:** Clicking a project in the list opens a terminal session with working directory set to that project's path. From there, terminal behaves like a normal shell.
- **Acceptance Criteria:**
  - [ ] Clicking a project opens a terminal view within the app (see FR-08 for tab/pane placement)
  - [ ] Terminal's initial working directory equals the project's stored path
  - [ ] User can type/run any shell command normally afterward (full PTY behavior — interactive programs, colors, control sequences work)

#### FR-08: Sidebar-Driven Tabs + Split-Pane Terminal Grid (Tilix-style)
- **Description:** Terminal sessions ("tabs" as a data concept — a project can have one or more open at once) are opened, switched, and closed entirely through the sidebar — there is no separate horizontal tab-bar widget above the terminal area (removed 2026-07-19, v1.4). Within any tab, the user can split the view into multiple panes (horizontal/vertical), each running an independent terminal session — matching the tab + split-pane workflow of Tilix. Promoted from next-iteration to MVP per user decision (2026-07-17); sidebar-only click behavior added 2026-07-19 (v1.3); tab bar removed and drag-to-split re-sourced from the sidebar 2026-07-19 (v1.4).
- **Acceptance Criteria:**
  - [ ] **Left-clicking** a project in the sidebar: if no tab is open for it, opens one. If exactly one is open, switches to (activates) it. If two or more are open, left-click has no separate meaning of its own — see the sub-session list below.
  - [ ] **When a project has two or more open tabs**, its sidebar entry automatically expands into a list of sub-items, one per session (labeled by creation order, e.g. "Session 1", "Session 2"). Clicking a sub-item switches to that specific tab. A project with 0 or 1 open tabs shows no such list — this is automatic based on count, never a manual expand/collapse the user has to remember to use.
  - [ ] **Right-clicking** a project (or its Menu button) offers "Open in new tab" (always adds another tab for that project, even if one or more already exist — the deliberate way to get a second terminal on the same project) and **"Close terminal"** (closes the project's one open tab; only offered when exactly one is open — with 2+, closing happens per sub-item instead, since "close terminal" would otherwise be ambiguous about which one).
  - [ ] **Dragging** a sidebar project row (0 or 1 open tabs) or a sub-item (2+ case) onto a pane in the terminal area splits that pane in the dragged-onto direction. If the source had a live session, that exact session moves in (reused, not respawned). If the source had none (dragging an unopened project), a fresh session spawns directly into the new pane position — the user never has to "open a tab first" just to then drag it.
  - [ ] **v1.16 — Dragging a pane's own header** (not a sidebar item) onto another pane in the same tab relocates it right/bottom/left/top, reusing the same drop-zone targeting as the sidebar drag above. The exact PTY session moves with it (never respawned); the vacated position collapses exactly like closing that pane would. Confined to the active tab's own pane tree — only one tab's panes are ever visible at once, so there is no cross-tab case. A pane that is the only pane in its tab has no other same-tab pane to drop onto and is not a drag source.
  - [ ] **v1.17 — Keyboard equivalent to the pane-move drag above**: `pane.moveLeft`/`moveRight`/`moveUp`/`moveDown` (default Alt+Shift+Arrow*) relocate the currently focused pane one step in that direction, the same way dragging it would — not just moving keyboard focus like the existing `pane.moveFocus*` shortcuts. A no-op at the edge of the grid or when the focused pane is its tab's only one, same rule `pane.moveFocus*` already follows.
  - [ ] Within a tab, user can split the terminal view horizontally and/or vertically into multiple panes
  - [ ] Each pane runs its own independent PTY session (own shell, own working directory, own auto-run command if opened via a project)
  - [ ] Panes within a tab can be resized and closed independently
- **Edge cases:**
  - Closing a tab/pane with a running foreground process (e.g. `docker-compose up`) — must not silently kill without at least a visual cue or confirmation
  - Very many simultaneous panes/tabs — no hard limit required for MVP, but must not crash or become unusably slow at realistic personal-scale usage (a handful of tabs, a few panes each)
  - Right-clicking a project with no tabs open yet — "Open in new tab" still works identically to a left-click in this specific case (there's nothing to switch to); "Close terminal" is absent (nothing to close)
  - Deleting a project (FR-01) that still has open tab(s)/session(s) — close all of that project's sessions first, then delete, so no orphaned terminal keeps running against a project entry that no longer exists in the sidebar

#### FR-04: Auto-run Setup Commands
- **Description:** When a project's terminal opens, any configured setup command(s) run automatically before handing control to the user.
- **Acceptance Criteria:**
  - [ ] Configured command(s) execute automatically right after the terminal opens at the project path
  - [ ] User retains interactive control of the terminal after the command(s) finish (or while long-running commands like `docker-compose up` keep running)
  - [ ] If a project has no configured command, terminal opens directly to an idle shell prompt

#### FR-05: Per-Project Notes
- **Description:** Free-text notes field attached to each project entry, viewable/editable from the project's detail view.
- **Acceptance Criteria:**
  - [ ] User can write, edit, and save notes per project
  - [ ] Notes persist across restarts
  - [x] ~~Notes are stored encrypted at rest (see NFR-3)~~ — removed 2026-08-12, see FR-06

#### FR-06: ~~Encrypted Local Storage~~ — Removed 2026-08-12 (ADR-0014)
- **Description (historical):** All project data (path, commands, notes) was stored encrypted on disk, since commands/notes may contain sensitive information (API keys, credentials). Removed by direct product decision: the master-password-every-launch friction this required (see the superseded FR-13 sub-feature below) cost more in daily use than the confidentiality guarantee was worth for a single-user local tool. See ADR-0014 for the full rationale and the one-time migration path that converts any existing encrypted data file to plain on first load — existing project data is preserved, not discarded.
- **Current behavior:** project data (path, commands, notes) is stored as a plain local file, protected only by OS filesystem permissions (0600/0700, unchanged from before). See NFR-3 (rewritten).

#### FR-07: Config Sync via Git / Export-Import
- **Description:** User can sync their project list across devices either by committing the config file to a git repo (dotfiles-style) or by manually exporting/importing a config file.
- **Acceptance Criteria:**
  - [ ] Config data lives in a file (or small set of files) that can be tracked by git
  - [ ] User can export current config to a file
  - [ ] User can import a config file, merging or replacing current data (behavior ⚠️ TBD — decide during design)
  - [x] ~~Encrypted fields remain protected in exported files (export is not a plaintext leak)~~ — moot as of ADR-0014 (2026-08-12): the exported file is the same plain data file, no encrypted fields exist to protect

#### FR-13: Settings Panel
- **Description:** A modal (opened from existing app chrome, not a separate full page) exposing three settings groups: terminal theme, keybinding customization, and sidebar position. Promoted directly to MVP per user decision (2026-07-20), absorbing and superseding the old FR-12 placeholder ("Terminal theme customization"). Theme, keybindings, and sidebar position are **not sensitive data** — they persist in a local plain preferences store (`settings_store`). ~~Master password change was originally the fourth group, touching the encrypted project-data blob via `crypto`~~ — **removed 2026-08-12 (ADR-0014):** there is no master password left to change, since encryption at rest was dropped entirely.
- **Acceptance Criteria:**
  - [ ] Settings is opened as a modal from existing app chrome (exact entry point — e.g. sidebar footer/menu — decided by ui-ux-designer)
  - [ ] The modal groups the three areas below; each is independently save-able
  - **Theme customization:**
    - [ ] User picks from a fixed set of preset themes (not a per-color custom picker)
    - [ ] Selected theme applies immediately to open terminal panes
    - [ ] Selected theme persists across app restarts
  - ~~**Master password change:** ...~~ — removed 2026-08-12 (ADR-0014)
  - **Keybinding customization:**
    - [ ] Every app shortcut (clipboard copy/paste, split-pane, close pane/tab, open in new tab, etc.) can be rebound to a different key combination
    - [ ] Assigning a combination already used by another action is blocked/flagged with a conflict warning before it's saved
    - [ ] Rebound shortcuts persist across restarts and take effect immediately
  - **Sidebar position:**
    - [ ] User can toggle the sidebar between left and right
    - [ ] Chosen position persists across restarts
- **Edge cases:**
  - First launch with no settings file yet → falls back to sensible defaults (default theme, default keybindings, sidebar on the left)
  - ~~Master password change interrupted mid-way...~~ — moot, 2026-08-12 (ADR-0014)
  - Rebinding a shortcut to a combination the OS/webview treats as a native command (e.g. Ctrl+Shift+V's native "Paste" action — see the `TerminalPane.svelte` clipboard double-paste bug fixed 2026-07-20) is a real risk surface for custom keybindings in general; system-architect/ui-ux-designer should account for it, not just the one shortcut already fixed

#### FR-11: Sidebar Folders (Project Grouping via Drag & Drop)
- **Description:** User-defined folders let the sidebar's project list be organized into named categories, managed entirely by dragging project rows onto each other/onto folders. Promoted directly to MVP per user decision (2026-07-21), absorbing and superseding the old FR-11 placeholder ("Project grouping/folders — organize the list into categories"). Deliberately called a **"Folder"**, not a "Group" — `docs/design/components.md` already uses "grouped (2+ sessions open)" for the unrelated automatic display mode where a project's sidebar row expands to show one sub-item per open session; a Folder is a distinct, user-organized concept and both can apply to the same project at once (see acceptance criteria below).
- **Acceptance Criteria:**
  - [ ] Dragging one top-level project row onto another creates a new Folder containing both, auto-named (e.g. after the first project)
  - [ ] The folder header's name can be renamed inline (click/double-click), same interaction pattern as renaming a project
  - [ ] Folders are flat only — a folder cannot contain another folder — and a project belongs to exactly one folder, or none (shown at top level)
  - [ ] Dragging a project row onto a folder header adds/moves that project into it, regardless of whether it was previously ungrouped or in a different folder
  - [ ] Dragging a project row onto empty list space (or a dedicated top-level "ungrouped" drop target) moves it back out to top level
  - [ ] Dropping a project row **between** two existing rows (a drop-indicator line, not directly onto a row) reorders it to that position instead of merging/moving it into whatever row it was dropped near — the same drag gesture serves both reordering and folder membership changes, disambiguated by exactly where the drop lands
  - [ ] A folder that loses its last member (dragged out, or the project deleted per FR-01) is automatically deleted — no empty folders persist
  - [ ] A project inside a folder that also has 2+ open terminal sessions still renders its automatic "grouped (2+ sessions)" sub-item list beneath it (FR-08), simply nested one level deeper inside the folder — the two concepts compose rather than conflict
  - [ ] Folder membership and names persist across app restarts, stored in the project-data file (extends FR-11's data model — folder names are user-authored text, same file as project notes/commands, per ADR-0014)
  - [ ] Each folder's expanded/collapsed state persists across app restarts, stored in the existing preferences store (same mechanism FR-13 already uses for non-sensitive UI state)
  - [ ] A folder header is **not** a drag-to-split source (cannot be dragged onto a terminal pane) — same ambiguity rule `components.md` already applies to the automatic "grouped" parent row, since a folder has no single session to unambiguously drag. Only the individual project rows and session sub-items inside it remain draggable onto a pane, unchanged from FR-08.
- **Edge cases:**
  - Dropping a project onto itself, or onto the folder it's already directly in with no position change → no-op, no rename/reorder triggered
  - Renaming a folder to an empty string → reverts to its previous name rather than saving a blank label
  - Dragging the second-to-last member out of a 2-member folder leaves a 1-member folder, which per the empty-folder rule is NOT yet auto-deleted (only a fully empty folder is) — that lone remaining project stays inside the folder until explicitly dragged out too
  - Deleting a project (FR-01) that is a folder's last member triggers the same auto-delete-when-empty behavior as manually dragging it out

#### FR-14: Glassmorphic Surfaces with Adjustable Intensity
- **Description:** App surfaces (sidebar, modals, menus, and terminal-pane backgrounds) render as translucent "frosted glass" panels that blur whatever sits behind them, with the intensity adjustable by the user from a single control in the Settings modal (FR-13). Promoted straight to MVP per user decision (2026-07-22).

  **Scoped to *in-app* compositing only. (Superseded 2026-07-22 by FR-15, which makes the window itself see-through — read the two together: FR-14 governs panel-over-panel glass inside the app, FR-15 governs the app over the desktop. The paragraph below describes FR-14's own scope, not a standing claim that the window is opaque.)** This is the single most important thing to understand about this FR, and it is a scope decision, not an oversight: surfaces are translucent *relative to each other* (sidebar over terminal content, modal over app chrome), so the bottom-most layer remains `--color-background`. The user's desktop wallpaper is **not** visible through the app, unlike Tilix's real window transparency. That capability is now FR-15 — §4.3's entry recording it as "unproven" was based on a misread spike and has been corrected.

  This means FR-14's effect is inherently subtler than the Tilix behavior that inspired it. The acceptance criteria below are written against what in-app compositing can actually deliver, so "it doesn't look like Tilix" is expected behavior here, not a bug to file.

  **Surface scope narrowed during design (2026-07-22, design.md v1.9 §4.6).** This FR was written for four surfaces; measurement cut it to **modals and menus**. The sidebar is a flex sibling of the terminal area (design.md §5), so only flat `--color-background` sits behind it — and `backdrop-filter` over a uniform color returns that same color, so the effect cannot exist there. Terminal-pane translucency is inert for the same reason, and provably so on the default theme preset, whose background *is* `--color-background` (identical composite at every alpha). Sidebar glass would require floating the sidebar *over* the terminal area — a §5 layout change with real cost to terminal width, explicitly declined by the user on 2026-07-22. The criteria below reflect the narrowed scope.

- **Acceptance Criteria:**
  - [ ] Modals and menus render translucent, blurring the content behind them
  - [ ] Sidebar and terminal-pane backgrounds remain fully opaque — see the scope note above; this is a deliberate exclusion, not an unimplemented criterion
  - [ ] A single control in the Settings modal (FR-13) adjusts the effect's intensity globally — one control, not per-surface tuning
  - [ ] Intensity applies immediately to already-rendered surfaces, without an app restart (same immediacy FR-13's theme switching already provides)
  - [ ] The chosen intensity persists across app restarts, stored in the existing preferences store alongside theme/keybindings/sidebar-position
  - [ ] The control includes an explicit "off" end of its range that disables the effect entirely, returning every surface to today's fully-opaque appearance
  - [ ] At **every** setting the control permits, app-chrome text remains readable and meets the contrast standards in `docs/design/design.md` §7 — the range is bounded so an unreadable configuration is not reachable. Resolved by design.md v2.0 §4.6: the per-surface floors live inside `tokens.css`'s `calc()` expressions (modal `1.00 → 0.40`, menu `1.00 → 0.80` as of design.md v2.0), so this is enforced by construction rather than by the user stopping in time
  - [ ] First launch with no stored value falls back to a sensible default (exact default owned by ui-ux-designer)
  - [ ] With the effect enabled and several panes open (FR-08's multi-pane scenario), the app remains responsive and does not regress startup time — NFR-9

- **Edge cases:**
  - ~~The unlock screen renders before any project data is decrypted...~~ — moot, 2026-08-12 (ADR-0014): there is no unlock screen
  - ~~Terminal-pane background translucency interacts with the FR-13 theme preset's own `background` slot~~ — moot as of the 2026-07-22 scope narrowing: terminal panes stay opaque, and design.md §4.6 keeps translucency entirely within app-chrome tokens, so the two systems never compose at all (Q9 resolved)
  - A pane split perpendicular to another (FR-08) stacks two translucent surfaces; blur must not compound into visual mud where panes meet at a divider
  - If the webview does not support `backdrop-filter` at all, surfaces must degrade to plain opaque backgrounds rather than rendering as unblurred transparent panels with text showing through — an unreadable failure mode is worse than no effect

#### FR-15: Native Transparent Window (see-through to the desktop)
- **Description:** The application window itself renders translucent against the desktop, so the wallpaper and any windows behind it show through — the real window transparency Tilix has, as distinct from FR-14's in-app compositing. Promoted straight to MVP per user decision (2026-07-22). Intensity is adjustable from its **own** control in the Settings modal, deliberately separate from FR-14's glass slider: the two govern different things (glass = panel-over-panel inside the app; this = the whole app over the desktop) and users will want them set independently.

  **Applies to the whole application surface** — sidebar, terminal panes, and chrome alike — per explicit user decision on 2026-07-22, taken with the contrast consequence below stated. This supersedes FR-14's framing that "the app window itself stays opaque to the desktop."

  **Feasibility is established, not assumed.** The dependencies already do the work: `tao` 0.35 requests an RGBA visual and sets `app_paintable` when `transparent` is set; `wry` 0.55 sets the webview background to alpha-0. A spike window measured Depth 32 against a control `xterm`'s Depth 24, and its empty pixels read `srgb(5,5,7)` — exactly `0.35 × #0D0F14`, i.e. the app's own translucent layer compositing over alpha-0. The earlier "infeasible" finding in §4.3 was a misread and has been corrected there.

- **Acceptance Criteria:**
  - [ ] With the setting enabled, the desktop is visible through the application window
  - [ ] A control in the Settings modal (FR-13) adjusts the intensity, **separate from FR-14's glass control**; both can be set independently and neither overrides the other
  - [ ] Intensity applies immediately, without an app restart, and persists across restarts in the existing preferences store — same mechanism as FR-13/FR-14
  - [ ] The control includes an explicit "off" end of its range returning the window to fully opaque, which is the default on first launch
  - [ ] At every reachable setting, **all app text continues to meet `docs/design/design.md` §7's contrast standards** — see NFR-10; this requires a minimum scrim, since the backdrop is outside the app's control
  - [ ] Terminal text specifically remains readable over the wallpaper at every reachable setting (dense small monospace over an arbitrary photographic backdrop is the hardest case in the app)
  - [ ] On a system with no compositing window manager the app renders fully opaque and remains completely usable — no error, no visual corruption, no broken layout
  - [ ] Enabling it does not regress startup time or introduce input lag in a terminal pane (NFR-7/NFR-9)

- **Edge cases:**
  - ~~The unlock screen renders before anything is decrypted...~~ — moot, 2026-08-12 (ADR-0014): there is no unlock screen or master-password field anymore
  - `<html>`'s `color-scheme: dark` and root background are what defeated the original spike — whatever the fix, it must not regress native form-control rendering (inputs, scrollbars), which is what `color-scheme` exists to drive
  - A very bright or busy wallpaper is the worst case for every contrast pair in the app at once — unlike FR-14, whose backdrop was always app-controlled
  - Compositor behavior is not uniform: the same setting may look different under a different WM, and the app cannot detect "will this actually composite" reliably before drawing

#### FR-16: Clickable Terminal Links (Ctrl+Click)
- **Description:** URLs printed to a terminal pane's output (e.g. by `git`, `npm`, a dev server) are detected and, when the user Ctrl+left-clicks one, opened in the system's default browser. A small, low-risk addition — implemented directly (no separate system-architect/ui-ux-designer pass) since it reuses infrastructure already present: `xterm.js`'s own link-provider mechanism for detection and the `tauri-plugin-opener` capability (`opener:default`, already granted for FR-01's browse dialog) for opening it, with no new Tauri command, IPC surface, or stored state.
- **Acceptance Criteria:**
  - [ ] An `http(s)://` URL appearing anywhere in a pane's scrollback or live output is visually distinguishable as a link on hover (underline), in every terminal theme preset
  - [ ] Ctrl+left-click on a detected link opens it in the system's default browser
  - [ ] A plain left-click (no Ctrl) on the same text does not open anything — it behaves exactly as clicking terminal text always has (cursor position / selection), so the existing click-to-focus/select workflow is not disrupted
  - [ ] Ctrl+click with a non-left mouse button does not open anything
- **Edge cases:**
  - A link that wraps across a soft-wrapped terminal line is still detected as one continuous URL, not split at the wrap point (xterm.js's link provider already re-joins wrapped rows before matching)
  - A malformed/partial URL fragment (e.g. output truncated mid-write) simply fails to match the detector's regex — no error surfaced, same as any other non-matching text

#### FR-17: Pane Title Shows Active Git Branch
- **Description:** Each pane's title bar (`PaneNodeView.svelte`'s `pane-header`, which already shows the pane's working directory — see FR-08/components.md) is extended to show the current git branch after the path, when that directory is (or is inside) a git repository. Detected directly from `.git/HEAD` rather than shelling out to `git` or linking `libgit2` (ADR-0004/0005's pure-Rust, no-C-library preference), so a plain (non-git) project pays no extra cost and shows no extra UI. Implemented directly, same small-scope reasoning as FR-16: reuses the existing per-pane title bar and IPC pattern (`path_exists`'s shape), no new module dependency, no design tokens beyond the existing `.cwd` label styling.
- **Acceptance Criteria:**
  - [ ] A pane whose working directory is inside a git repository shows `<branch name>` appended after the path in its title bar, visually distinct from the path (not the same muted color — the branch is the one part of this label that can change while the pane is open)
  - [ ] A pane whose working directory is **not** inside a git repository shows just the path, exactly as before this feature — no empty separator, no error text
  - [ ] A detached `HEAD` (checked out to a specific commit rather than a branch) shows a short commit hash instead of a branch name, rather than nothing
  - [ ] Detection works from any subdirectory of a repository, not only its root
  - [ ] The branch shown updates the next time the pane regains keyboard focus, without needing to reopen it — covers the common case of running `git checkout` inside the pane, then clicking back into it
  - [ ] A manual refresh control next to the title re-checks the branch on demand, for updating it without switching focus away and back first
- **Edge cases:**
  - A git worktree or submodule (`.git` is a *file* pointing elsewhere, not a directory) still resolves to the correct branch
  - The branch is first detected when the pane opens, then re-checked on every subsequent focus-gain and on the manual refresh control — **not** truly realtime: a checkout run in a pane that's never re-focused (or refreshed) afterward keeps showing the stale branch. Considered and deliberately not built: a poll timer (wakes every open pane on an interval regardless of whether anything changed — costs against NFR-7's multi-pane concern) and a per-pane filesystem watcher on `.git/HEAD` (true realtime, but adds an OS resource handle per pane that must be lifecycle-managed as carefully as the PTY subscriptions `$lib/terminal-registry` exists to protect — a fully realtime version stays future-backlog scope if this focus/manual-refresh middle ground proves insufficient)
  - A read failure (permissions, race condition) is treated the same as "not a git repo": nothing shown, no error surfaced to the user
  - Losing focus never triggers a refetch — only *gaining* it does, so switching away from a pane costs nothing

### 4.2 Next Iteration (Should Have)
- ~~**FR-11:** Project grouping/folders — organize the list into categories~~ — promoted to MVP (2026-07-21), see §4.1
- ~~**FR-12:** Terminal theme customization~~ — superseded by FR-13 (2026-07-20)

### 4.3 Future Backlog
- Search/filter across project list
- Git branch/status indicator per project in the list
- Global hotkey to summon the app / quick-switch project
- ~~**Native window transparency (true see-through-to-desktop, as Tilix does)**~~ — **promoted to MVP as FR-15 on 2026-07-22.** This entry previously recorded the opposite conclusion: that a spike had *disproved* feasibility and that delivering it would need native GTK/WebKitGTK work of uncertain outcome. **That conclusion was wrong, and the spike that produced it was misread.** The window option was never the problem — `tao` 0.35 already requests an RGBA visual and sets `app_paintable` whenever `transparent` is set (`platform_impl/linux/window.rs`), and `wry` 0.55 already sets the webview background to alpha-0 (`webkitgtk/mod.rs`). The original spike rendered black because the **CSS root layer still painted an opaque canvas** — only `body` had been made transparent, while `<html>` kept both an opaque background and `color-scheme: dark`. Re-run with the root layer cleared, the spike window measured **Depth 32** (an RGBA visual; a control `xterm` measured Depth 24) and its empty pixels read `srgb(5,5,7)`, exactly `0.35 × #0D0F14` — i.e. the app's own translucent layer compositing over alpha-0, not over a solid colour. See FR-15. The one claim from the original entry that still stands: blur-*behind*-the-window (blurring the desktop itself) is **not achievable from application code** on Linux — it is a compositor/window-manager feature, and no Tauri or WebKitGTK API exposes it.

---

## 5. Non-Functional Requirements & Constraints
*(Numbered — downstream ADRs cite these IDs.)*

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | Terminal open + auto-run command should feel instant to the user (no perceptible app-side lag before the shell/PTY takes over) |
| NFR-2 | Availability | N/A — single-user local desktop app, no uptime requirement |
| NFR-3 | Security / Data sensitivity | Stored data (paths, commands, notes) may contain credentials/API keys entered by the user in commands or notes. No network transmission of this data (no cloud backend). ~~Must be encrypted at rest~~ — **repealed 2026-08-12 (ADR-0014):** encryption at rest was tried (master password, ADR-0005) and removed by direct product decision as not worth the daily-use friction for a single-user local tool; data is now a plain file, protected only by OS filesystem permissions (0600/0700) |
| NFR-4 | Scalability | Must comfortably handle a personal-scale list (tens to low hundreds of projects) — not designed for large multi-team catalogs |
| NFR-5 | Portability | Config/data must be portable across devices via git-trackable file(s) and/or export/import, per user's multi-device workflow |
| NFR-6 | Learnability | Solo author is new to Rust and Tauri — downstream architecture docs should favor well-established, well-documented libraries and explain non-obvious decisions, over cutting-edge/exotic choices |
| NFR-7 | Resource efficiency | App must be lightweight, fast to start, and memory-friendly — especially relevant given multi-pane terminal usage (FR-08) can mean many concurrent PTY sessions + rendered terminal views running for long periods |
| NFR-8 | N/A, 2026-08-12 (ADR-0014) | ~~Non-sensitive preferences must NOT require the app to be unlocked to read or apply~~ — moot, there is no unlock state left. Kept as a row for changelog continuity only |
| NFR-9 | Performance / Resource efficiency | FR-14's blur effect must not compromise NFR-7. `backdrop-filter` is a per-frame compositing cost that scales with both blurred area and layer count, and this app's terminal rendering is already on xterm.js's DOM renderer rather than the GPU path (ADR-0006 disabled the WebGL renderer, so its NFR-7 headroom is *already* reduced). Enabling FR-14 must not introduce perceptible input lag or scroll stutter in a terminal pane, nor regress app startup time, under FR-08's realistic multi-pane usage. If measurement shows it does, reducing FR-14's blurred surface count is the correct response — NFR-7 outranks FR-14 |
| NFR-10 | Accessibility / Contrast | FR-15 breaks the assumption every other contrast rule in `docs/design/design.md` §7 rests on: that the backdrop behind app text is a known token value. With the desktop showing through, the backdrop is arbitrary and outside the app's control. The intensity range must therefore guarantee a **minimum scrim** — a floor of app-controlled opacity beneath all text — such that no reachable setting can put text directly onto raw wallpaper. This is the same "unsafe configuration unreachable by construction" property FR-14 already uses (design.md §4.6), applied to a backdrop the app cannot measure. Primary text readability outranks the visual effect |

| ID | Constraint |
|---|---|
| CON-1 | Solo developer, working casually with no fixed schedule (side-project pace) |
| CON-2 | Author is new to Rust and Tauri — first project in this stack |
| CON-3 | No hard deadline |
| CON-4 | Tooling/libraries must be free / open-source (no paid dependencies or services) |
| CON-5 | Primary target OS is Linux; Windows/macOS support is optional/nice-to-have, not required for MVP |
| CON-6 | FR-15 requires a compositing window manager. On a non-compositing WM the effect simply does not appear — this is the same prerequisite Tilix itself carries and is not a defect to engineer around. The author's environment (GNOME/mutter) composites, so this constrains portability, not daily use |

---

## 6. Technical Considerations *(Optional)*
> ⚠️ TBD — deferred entirely to **system-architect**. No tech stack decisions have been made yet; this section is intentionally left for the architecture phase to fill in (framework choice, PTY library, storage engine, encryption approach).

### Tech Stack
| Layer | Technology | Notes |
|---|---|---|
| Frontend | ⚠️ TBD | To be decided by system-architect |
| Backend | Rust (Tauri) | Fixed by user's explicit choice |
| Database | ⚠️ TBD | Likely lightweight local storage (SQLite or encrypted file) — see FR-06 |
| Infra | N/A | Local desktop app, no server infra |

### Integrations
| System | Type | Notes |
|---|---|---|
| — | — | None required for MVP (per user, "sementara belum ada") |

### Architecture Notes
None yet — see system-architect.

### Distribution
User wants a properly installed package from the start (not just running from source) — e.g. AppImage or `.deb` for Linux (CON-5). Packaging/bundling approach to be decided by system-architect (Tauri's built-in bundler is the default candidate, per boring-technology bias).

---

## 7. Milestones
| Milestone | Target Date | Deliverable |
|---|---|---|
| Kickoff | 2026-07-17 | PRD approved |
| MVP Dev Start | ⚠️ TBD | No fixed date — casual side-project pace |
| Internal Testing | ⚠️ TBD | — |
| Launch (daily-driver replacing Tilix) | ⚠️ TBD | — |

---

## 8. Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Author is new to Rust/Tauri — PTY/terminal embedding, multi-pane PTY multiplexing (FR-08), and encryption are all nontrivial for a first project in the stack | Medium-High | Medium (could stall momentum) | system-architect to favor mature, well-documented libraries (e.g. established PTY crates, proven terminal frontend with native multi-instance support) and explain key decisions clearly (NFR-6); consider phasing implementation (tabs before split-panes) even though both are in architectural scope |
| ~~Encryption implemented incorrectly (e.g. weak key handling) could undermine NFR-3's whole purpose~~ — moot, 2026-08-12 (ADR-0014): encryption removed entirely | — | — | — |
| One-time migration off the old encrypted data format (ADR-0014) is new code running against the author's one real, irreplaceable data file | Low | High (only copy of project data) | Atomic write (temp file + rename), same pattern as ADR-0010's rotation; original encrypted bytes untouched until the new plain file is confirmed written. `security-auditor` flagged for a fresh pass, since this removes a control the 2026-07-20 audit previously verified sound |
| Casual pace / no deadline could lead to project stalling indefinitely | Medium | Low (personal tool, no external stakeholder) | No mitigation needed — accepted by user |
| FR-14's `backdrop-filter` behaves differently (or costs more) in a `tauri build` release binary than in `tauri dev` — WebKitGTK on this stack has produced exactly this class of surprise twice already (the Vite-minifier TUI bug fixed in `c10a2f5`, and the WebGL renderer defect in ADR-0006's revisit) | Medium | Medium (a visual feature that only misbehaves in the real installed app) | Verify FR-14 from an actual installed `.deb` launched from the desktop launcher, per `docs/ops/runbook.md` §2 and the launch-environment charter in `docs/qa/test-plan.md` §5.1 — a green `tauri dev` session is explicitly not equivalent verification for this class |
| FR-15 puts app text over an arbitrary wallpaper, where no token-based contrast guarantee can hold — the mechanism design.md §7 relies on assumes a known backdrop | High (it is inherent to the feature, not a bug) | Medium-High (affects every text pair in the app at once, including dense terminal output) | NFR-10's minimum-scrim floor, resolved as Q11 before implementation; "off" is the default and always reachable; primary text readability explicitly outranks the effect |
| FR-15 behaves differently — or not at all — under a different compositor, and the app cannot reliably detect beforehand whether compositing will happen | Medium | Low (degrades to opaque, which is the safe direction) | CON-6 accepts this as a prerequisite rather than engineering around it; acceptance criteria require the no-compositor case to stay fully usable |
| FR-14 ships an intensity range wide enough to let the user configure their own app into unreadable text, and only notices after it's persisted | Medium | Low-Medium (recoverable, but annoying — and the setting persists across restarts) | Bound the range so no reachable setting fails design.md §7 contrast standards (Q10); the "off" end of the range is an always-available escape hatch |

---

## 9. Success Metrics

| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| Daily usage | Currently using Tilix + zsh | App fully replaces Tilix as daily terminal launcher | Subjective — user self-reports switching over |

---

## 10. Open Questions
- [x] [Q1] Key management approach for encryption — **Resolved 2026-07-17: master password**, entered by user on app startup to decrypt data. **Reversed 2026-08-12 (ADR-0014): encryption removed entirely** — the master-password friction turned out not to be worth it for daily use on a single-user local machine; existing encrypted data migrates to plain automatically, once, on first load
- [ ] [Q2] Import behavior when syncing config across devices — merge vs. replace — Owner: system-architect / design phase
- [ ] [Q3] Frontend framework and PTY library choice — Owner: system-architect
- [ ] [Q4] Tab/pane close UX when a long-running foreground process is active — Owner: ui-ux-designer / design phase
- [x] [Q5] Exact format/location of the unencrypted preferences store (FR-13/NFR-8) — **Resolved 2026-07-20: same `app_data_dir()`, plain `settings.json`, ADR-0009.** ~~Master-password-rotation strategy for the encrypted blob~~ — moot, 2026-08-12 (ADR-0014): no master password left to rotate
- [ ] [Q6] Which specific preset themes ship for FR-13 theme customization — Owner: ui-ux-designer
- [ ] [Q7] Exact visual treatment distinguishing a "reorder between rows" drop target from a "merge/move into this row or folder" drop target in the sidebar (FR-11) — Owner: ui-ux-designer
- [ ] [Q8] Data model/schema for folder membership + name within the project-data file (FR-11) — Owner: system-architect
- [x] [Q9] **Resolved 2026-07-22 (design.md v1.9 §4.6): app-chrome tokens exclusively; §4.5's terminal presets stay opaque and untouched.** Decided on evidence, not preference — the App Default preset's background *is* `--color-background`, so compositing it over itself returns the identical color at every alpha, making preset translucency inert for the default case. The §4.5 boundary is therefore preserved rather than crossed. Original question: which system owns FR-14's translucency values — `tokens.css` app-chrome tokens, an extension to the FR-13 terminal theme presets, or a third independent axis? `design.md` §4.5 deliberately keeps app-chrome tokens and terminal presets separate so neither drifts by editing the other, but FR-14 applies to surfaces governed by *both*, and each preset defines its own opaque `background` hex. This boundary must be decided explicitly rather than settled by whichever file gets edited first — Owner: ui-ux-designer
- [x] [Q11] **Resolved 2026-07-22 (design.md v2.1 §4.7): scrim floor α=0.64, computed against a WHITE wallpaper.** The backdrop cannot be measured but it *is* bounded — for light text on dark surfaces the worst case is a pure white wallpaper, and unlike §4.6's discarded model that case is genuinely reachable, since nothing blurs or averages a wallpaper. At the floor `--color-text` holds 4.70:1; `--color-text-muted` does not (1.87:1) and is a knowingly accepted trade, taken with the alternative floor (α=0.90, protecting muted text but yielding an imperceptible 10% see-through) explicitly on the table. Surfaces stack additively, so bounding the root bounds everything above it. Original question: what per-surface opacity floor guarantees §7 contrast against an unmeasurable wallpaper?
- [x] [Q12] **Resolved 2026-07-22 (design.md v2.1 §4.7, Finding 3) — opposite to the expected answer: FR-14's surface scope does NOT change.** A transparent window does not give the sidebar or terminal panes anything to blur, because `backdrop-filter` samples the *page's own backdrop* and the wallpaper is composited by the window manager outside the document — the same reason blur-behind-the-window is impossible on Linux. §4.6's Findings 1 and 2 stand, now on grounds that no longer depend on the window being opaque. FR-14 and FR-15 compose by stacking alphas; neither feeds the other's blur. Original question: does FR-15 reopen FR-14's surface scope?
- [x] [Q13] **Resolved 2026-07-22 (ADR-0012): `color-scheme: dark` stays.** Tested directly rather than reasoned about — with the declaration retained *and* an explicit `background: transparent` added to `<html>`, the window still measured Depth 32 with empty pixels at `srgb(5,5,7)`, identical to the run with `color-scheme` removed. It was never in conflict with transparency; the original spike failed because the root element had no explicit background, and that spike changed both at once so could not tell them apart. Implementers must **not** remove it to "fix" transparency — doing so regresses native form-control and scrollbar rendering, including the master-password field, for no benefit. Original question: how should `<html>`'s `color-scheme: dark` be handled?
- [x] [Q10] **Resolved 2026-07-22 (design.md v2.0 §4.6/§7): one `--glass-intensity` (0..1, linear, default 0 = fully opaque) feeding per-surface `calc()` ranges — modal `1.00 → 0.40`, menu `1.00 → 0.80` (re-derived in design.md v2.0; see the v1.7.2 changelog entry).** Menus get the tighter ceiling because they float directly over live terminal output with no `--color-backdrop` to damp it. Floors are derived against a realistic *blurred* backdrop (`#56575A`), since blur averages a region rather than sampling its brightest pixel — the v1.9 derivation used a full-white backdrop and produced an imperceptible effect as a result. Because the floors are baked into the token expressions, no reachable slider position fails AA on that backdrop model; the pathological near-white case is a separately recorded accepted risk (design.md §4.6). Original question: the intensity control's actual bounds, default, and scale (linear vs perceptual), such that no reachable setting violates design.md §7's contrast standards — including whether terminal-pane background translucency needs a tighter ceiling than app chrome, since terminal content is dense small text over arbitrary user output rather than known UI copy — Owner: ui-ux-designer

---

## 11. References
- Inspiration: Termius (session/host list UX pattern), applied to local paths instead of remote SSH

---

## 12. Instructions for AI agents
1. This PRD defines **scope and acceptance** — the "what & why". Architecture, schema, API, and design decisions live downstream (docs/backend/, docs/design/); do not invent them from this document.
2. Cite NFR/CON IDs when making decisions driven by them.
3. Acceptance criteria in §4 are test oracles — qa-tester asserts them.
4. `⚠️ TBD` markers are open items, not blanks to fill silently — resolve them with the user.
5. Scope changes update this PRD (version + changelog) in the same change-set.

---

## 13. Changelog
| Version | Date | Change |
|---|---|---|
| 1.17 | 2026-08-21 | FR-08 amended again (routed via project-navigator → backend-implementer — fully specified already by v1.16/components.md v3.1's own `⚠️ TBD`, no new design pass needed): added `pane.moveLeft`/`moveRight`/`moveUp`/`moveDown` keybindings (default Alt+Shift+Arrow*), the keyboard equivalent to v1.16's drag-to-move — closes the accessibility gap that amendment left open. Reuses the existing `pane.moveFocus*` neighbor-lookup and the drag path's own detach-and-graft mechanism; no new tree logic. Same-session fix found while wiring this in: `settings_store::load` now backfills any keybinding action missing from an already-persisted settings file with its current default — without it, every keybinding-registry extension since FR-13 (not just this one) would have stayed silently unreachable for any install whose settings.json predates it. |
| 1.16 | 2026-08-21 | FR-08 amended (direct product decision, routed via project-navigator → ui-ux-designer for a scoped `docs/design/components.md` pass, not a new FR — small, additive to the existing drag-to-split system): added a **second drag source** distinct from the sidebar — a pane's own header. Dragging an already-open pane onto another pane in the same tab relocates it right/bottom/left/top, reusing the existing 4-zone drop-target overlay verbatim (`Split Pane Container`, components.md v3.1). Scoped deliberately: same-tab only (only one tab's pane tree is ever visible/hoverable at once, so no cross-tab case exists to define) and a pane alone in its tab is not a drag source (no valid same-tab target). No keyboard equivalent exists yet for this specific outcome — flagged `⚠️ TBD` in components.md, same unresolved-but-tracked pattern as `Sidebar Folder`'s own drag-only gap, to be resolved during backend-implementer/design-implementer's pass. |
| 1.15 | 2026-08-13 | Bugfix (debugger session, reported by user: "window launch still shows the empty-state placeholder"): v1.14's launch auto-open depended on a "Home" project existing, but FR-01's Home-seed (v1.13) only fires on a brand-new store — any install whose data file already existed before 2026-08-12 (verified against the author's own live data file: real projects, no "Home" entry) never gets one, and v1.14's `autoOpenHomeOnLaunch` silently no-op'd for them, same as the documented "deleted/renamed" case. Fixed by adding a fallback: when `appStore.homeProject` is `null`, `+page.svelte`'s `openHomeDirTerminal` now opens a terminal at the platform home directory directly (new `home_dir`/`open_home_terminal` Tauri commands, mirroring `open_terminal`'s event-wiring but bypassing the project store — nothing is added to the sidebar). Verified against a real, non-empty pre-existing-style data fixture in an isolated `tauri dev` launch: terminal now opens at `$HOME` instead of the placeholder. No regression test added for the `+page.svelte` orchestration itself, consistent with this file's established convention for that layer (see v1.14's own changelog entry) — the new IPC wrappers are equally thin/untested, matching every other `src/lib/api/index.ts` wrapper. |
| 1.14 | 2026-08-13 | FR-01 amended again (direct product decision, routed via project-navigator straight to backend-implementer — small, additive, frontend-only, no architecture impact): on window launch, if no tab is open yet, the app now auto-opens a terminal on the seeded "Home" entry instead of starting on an empty terminal area requiring a manual click. Implemented as `appStore.homeProject` (name-based lookup, same "not protected, not specially tracked" rule the FR-01 seed itself follows) plus a call to the existing `handleOpenProject` open-tab path from `+page.svelte`'s startup `onMount` — no new Tauri command. No-ops (not an error) once the Home entry is deleted or renamed, consistent with FR-01's existing edge case for that. |
| 1.13 | 2026-08-12 | FR-01 amended (direct product decision, routed via project-navigator straight to backend-implementer — small, additive, no architecture impact): a fresh install now pre-seeds the project list with one "Home" entry pointing at the OS user's home directory, instead of starting on a totally empty sidebar. Behaves like any other entry (editable/deletable) from then on; only applies when the data file doesn't exist yet, never re-applied if the user later empties their list back to zero. Added an acceptance criterion and an edge case (home dir unresolvable → falls back to empty, no error) to FR-01. |
| 1.12 | 2026-08-12 | **FR-06 (Encrypted Local Storage) removed** — direct product decision (routed via project-navigator → system-architect → ADR-0014), after real-world daily-driver use showed the master-password-every-launch friction (ADR-0005) cost more than the confidentiality guarantee was worth for a single-user local tool. US-05 removed. FR-13's master-password-change sub-feature removed (three settings groups now, not four); US-08 updated to match. NFR-3 rewritten to drop the encryption mandate; NFR-8 marked N/A (no unlock state left). Q1 reversed, Q5's rotation-strategy half made moot. Added a migration risk (§8) and flagged `security-auditor` for a fresh pass, since a previously-verified control was removed. Existing project data is preserved: the app migrates any pre-existing encrypted data file to the new plain format automatically, once, on first load (prompting for the last-used master password one final time only if that legacy file is present). |
| 1.11 | 2026-07-24 | FR-17 follow-up: the branch shown in a pane's title now refreshes (bypassing FR-17's per-cwd cache) on every focus-gain and via a new manual refresh control next to the title, closing part of the "static-per-mount only" gap v1.10 explicitly deferred. Still not truly realtime by design — a poll timer or a per-pane filesystem watcher were both considered and rejected for cost/complexity reasons now recorded in FR-17's edge cases; a fully realtime version stays future-backlog. Also added the acceptance criterion that the branch text be visually distinct from the path (not both the same muted color). |
| 1.10 | 2026-07-24 | Added FR-17 (Pane Title Shows Active Git Branch: the existing per-pane path label gets ` · <branch>` appended when the pane's cwd is inside a git repository, detected by reading `.git/HEAD` directly — no `git` subprocess, no `libgit2`), implemented directly given its small scope and reuse of the existing pane-header title bar. |
| 1.9 | 2026-07-24 | Added FR-16 (Clickable Terminal Links: Ctrl+left-click a detected URL to open it in the system browser), implemented directly given its small scope and reuse of already-granted infrastructure (`xterm.js` link detection, `tauri-plugin-opener`'s existing `opener:default` capability) — no new FR-01-style intake pass needed. |
| 1.0 | 2026-07-17 | Initial PRD |
| 1.1 | 2026-07-17 | Promoted multi-tab + split-pane terminal grid (Tilix-style) from next-iteration to MVP as FR-08, per user decision during system-architect intake. Resolved Q1 (master password for encryption key). Added distribution note (installable package expected, not just source build). |
| 1.2 | 2026-07-17 | Added NFR-7 (resource efficiency — lightweight, fast, memory-friendly), per user requirement during system-architect intake. Drives frontend framework and terminal-rendering decisions in architecture.md. |
| 1.3 | 2026-07-19 | FR-08 acceptance criteria revised: left-click on a sidebar project now switches to its existing tab instead of always opening a duplicate; right-click opens a context menu with an explicit "Open in new tab" action for that case. Replaces the old "always opens a new tab" behavior. |
| 1.4 | 2026-07-19 | FR-08 revised again: the horizontal tab-bar widget is removed entirely — sidebar becomes the sole way to open/switch/close/drag tabs. Added: automatic sub-session list when a project has 2+ open tabs (no manual expand/collapse), "Close terminal" Menu action (replaces the tab bar's per-tab close button), drag-to-split now sourced from sidebar rows/sub-items instead of tab-bar tabs (and can spawn a fresh session directly into a split if the source had none open yet). Added an edge case: deleting a project with open sessions closes them first. |
| 1.5 | 2026-07-20 | Added FR-13 (Settings Panel: theme presets, master password change, full keybinding customization with conflict detection, sidebar left/right position), promoted straight to MVP per user decision, superseding the old FR-12 placeholder. Added US-08, NFR-8 (non-sensitive settings stored unencrypted, separate from FR-06's blob), and Q5/Q6 open questions for system-architect/ui-ux-designer. |
| 1.7 | 2026-07-22 | Added FR-14 (Glassmorphic Surfaces: translucent blurred sidebar/modals/menus/terminal-pane backgrounds, one global intensity control in Settings, persisted unencrypted per NFR-8), promoted straight to MVP per user decision. Scoped deliberately to **in-app compositing only** — native see-through-to-desktop transparency was moved to §4.3 Future Backlog with the 2026-07-22 feasibility spike recorded (Tauri's `transparent: true` alone renders opaque black on this WebKitGTK stack; verified by screenshotting the window over a red `xterm`). Added US-10, NFR-9 (blur must not compromise NFR-7, which ADR-0006's WebGL removal already narrowed), two risks (release-build divergence; user-reachable unreadable settings), and Q9/Q10 for ui-ux-designer. Also corrected a status-header drift: FR-13 and FR-11 were both marked "implementation pending" despite having shipped (FR-11 in commit `4672712`). |
| 1.8.2 | 2026-07-22 | Q11 and Q12 resolved by design.md v2.1 §4.7. Q11: scrim floor α=0.64 against a white wallpaper (the reachable worst case), protecting primary text at 4.70:1 while knowingly not protecting muted text — the alternative floor (0.90) would have been imperceptible. Q12 resolved **opposite to expectation**: a transparent window does not reopen FR-14's surface scope, because `backdrop-filter` cannot sample anything the window manager composites outside the document. |
| 1.8.1 | 2026-07-22 | Q13 resolved by ADR-0012 (`color-scheme: dark` stays — measured, not reasoned). ADR-0012 also records the architectural constraint that decides FR-15's shape: Tauri 2.11's `transparent` is creation-time-only, so the window is created transparent unconditionally and the user's setting drives CSS root alpha instead — the only way to satisfy "applies immediately, no restart" without recreating the window and tearing down live PTY views. |
| 1.8 | 2026-07-22 | Added FR-15 (Native Transparent Window — the app window itself see-through to the desktop, as Tilix does), promoted straight to MVP per user decision, with its own Settings control separate from FR-14's glass slider. Applies to the **whole** application surface per explicit user decision, taken with the contrast consequence stated. Added US-11, NFR-10 (minimum-scrim requirement — FR-15 breaks §7's assumption of a known backdrop), CON-6 (requires a compositing WM), two risks, and Q11/Q12/Q13. **Corrected §4.3's Future Backlog entry, which recorded the opposite and wrong conclusion:** an earlier spike was misread as disproving feasibility. `tao` 0.35 and `wry` 0.55 already do the required work; the spike failed because the CSS root layer still painted an opaque canvas. Re-run correctly, the window measured Depth 32 (control xterm: 24) with empty pixels at `srgb(5,5,7)` = `0.35 × #0D0F14`. Not yet visually confirmed that the desktop shows through — XWayland blocks screen-level capture, so that check falls to the author's own build. FR-14's "the window stays opaque" framing marked superseded. |
| 1.7.2 | 2026-07-22 | FR-14 intensity range re-derived after real-app use showed the shipped effect was imperceptible (a modal moved only `#1C2029` → `#191D25` over a normal dark terminal — 10/765). Root cause was the worst-case model, not the arithmetic: `backdrop-filter` blur *averages* a region rather than sampling its brightest pixel, so deriving floors against a 100%-white backdrop designed against something the blur can never produce. Floors re-derived against a realistic blurred backdrop (`#56575A`): modal `0.80 → 0.40`, menu `0.95 → 0.80`, with blur raised 12px → 24px as part of the argument. An **accepted risk** is now recorded: a contiguous near-white region larger than the blur kernel drops muted (secondary) text below AA at maximum intensity — bounded because primary text never drops below 6.85:1, all shipped terminal presets are dark, and intensity 0 is always reachable. See design.md v2.0 §4.6/§7. |
| 1.7.1 | 2026-07-22 | FR-14 surface scope narrowed from four surfaces to two (modals + menus) following measurement in the ui-ux-designer pass — sidebar and terminal-pane glass are provably invisible in the in-app-compositing scope (nothing but flat `--color-background` sits behind either; the default theme preset's background is that same color). Sidebar glass would need the sidebar floated over the terminal area, a §5 layout change declined by the user on 2026-07-22. Q9 and Q10 both resolved — see their entries in §10 and design.md v1.9 §4.6. |
| 1.6 | 2026-07-21 | Added FR-11 (Sidebar Folders: drag-and-drop project grouping, flat/single-membership, auto-delete-when-empty, one drag gesture for both reordering and folder membership changes), fully specified and promoted straight to MVP per user decision, superseding the old one-line FR-11 placeholder. Deliberately termed "Folder" (not "Group") to avoid collision with the existing automatic "grouped (2+ sessions)" sidebar display mode — the two compose rather than conflict. Added US-09 and Q7/Q8 open questions for ui-ux-designer/system-architect. |
