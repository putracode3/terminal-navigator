# PRD: Terminal Navigator

> **Status:** In Development — MVP implemented (all FR-01–FR-08), undergoing real-world daily-driver testing | **Version:** 1.4 | **Date:** 2026-07-19 | **Author:** dennysetiawisnugraha@gmail.com

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
- **US-05** — As the user, I want my notes and commands stored encrypted, so that sensitive info (API keys, credentials) in them isn't exposed in plaintext on disk.
- **US-06** — As the user, I want to export/import my project list (or sync it via a git-committed config file), so that I can carry my setup across devices.
- **US-07** — As the user, I want to remove or edit an existing project entry, so that my list stays accurate as projects come and go.

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
- **Edge cases:**
  - Path no longer exists on disk at launch time (moved/deleted project) → entry should be flagged/visually marked invalid, not silently fail
  - Duplicate paths added twice → allowed but should warn, not blocked (user may want two entries with different commands for same path)

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
  - [ ] Notes are stored encrypted at rest (see NFR-3)

#### FR-06: Encrypted Local Storage
- **Description:** All project data (path, commands, notes) is stored encrypted on disk, since commands/notes may contain sensitive information (API keys, credentials).
- **Acceptance Criteria:**
  - [ ] Data file on disk is not human-readable plaintext
  - [ ] App can decrypt and load data correctly on normal startup
  - [ ] ⚠️ TBD — key management approach (OS keychain vs. master password) — for system-architect to decide and document as an ADR

#### FR-07: Config Sync via Git / Export-Import
- **Description:** User can sync their project list across devices either by committing the config file to a git repo (dotfiles-style) or by manually exporting/importing a config file.
- **Acceptance Criteria:**
  - [ ] Config data lives in a file (or small set of files) that can be tracked by git
  - [ ] User can export current config to a file
  - [ ] User can import a config file, merging or replacing current data (behavior ⚠️ TBD — decide during design)
  - [ ] Encrypted fields remain protected in exported files (export is not a plaintext leak)

### 4.2 Next Iteration (Should Have)
- **FR-11:** Project grouping/folders — organize the list into categories
- **FR-12:** Terminal theme customization

### 4.3 Future Backlog
- Search/filter across project list
- Git branch/status indicator per project in the list
- Global hotkey to summon the app / quick-switch project

---

## 5. Non-Functional Requirements & Constraints
*(Numbered — downstream ADRs cite these IDs.)*

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | Terminal open + auto-run command should feel instant to the user (no perceptible app-side lag before the shell/PTY takes over) |
| NFR-2 | Availability | N/A — single-user local desktop app, no uptime requirement |
| NFR-3 | Security / Data sensitivity | Stored data (paths, commands, notes) may contain credentials/API keys entered by the user in commands or notes. Must be encrypted at rest. No network transmission of this data (no cloud backend) |
| NFR-4 | Scalability | Must comfortably handle a personal-scale list (tens to low hundreds of projects) — not designed for large multi-team catalogs |
| NFR-5 | Portability | Config/data must be portable across devices via git-trackable file(s) and/or export/import, per user's multi-device workflow |
| NFR-6 | Learnability | Solo author is new to Rust and Tauri — downstream architecture docs should favor well-established, well-documented libraries and explain non-obvious decisions, over cutting-edge/exotic choices |
| NFR-7 | Resource efficiency | App must be lightweight, fast to start, and memory-friendly — especially relevant given multi-pane terminal usage (FR-08) can mean many concurrent PTY sessions + rendered terminal views running for long periods |

| ID | Constraint |
|---|---|
| CON-1 | Solo developer, working casually with no fixed schedule (side-project pace) |
| CON-2 | Author is new to Rust and Tauri — first project in this stack |
| CON-3 | No hard deadline |
| CON-4 | Tooling/libraries must be free / open-source (no paid dependencies or services) |
| CON-5 | Primary target OS is Linux; Windows/macOS support is optional/nice-to-have, not required for MVP |

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
| Encryption implemented incorrectly (e.g. weak key handling) could undermine NFR-3's whole purpose | Low-Medium | High (defeats the reason encryption exists) | Resolve key management approach explicitly as an ADR in system-architect phase; consider security-auditor pass once this is implemented |
| Casual pace / no deadline could lead to project stalling indefinitely | Medium | Low (personal tool, no external stakeholder) | No mitigation needed — accepted by user |

---

## 9. Success Metrics

| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| Daily usage | Currently using Tilix + zsh | App fully replaces Tilix as daily terminal launcher | Subjective — user self-reports switching over |

---

## 10. Open Questions
- [x] [Q1] Key management approach for encryption — **Resolved 2026-07-17: master password**, entered by user on app startup to decrypt data
- [ ] [Q2] Import behavior when syncing config across devices — merge vs. replace — Owner: system-architect / design phase
- [ ] [Q3] Frontend framework and PTY library choice — Owner: system-architect
- [ ] [Q4] Tab/pane close UX when a long-running foreground process is active — Owner: ui-ux-designer / design phase

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
| 1.0 | 2026-07-17 | Initial PRD |
| 1.1 | 2026-07-17 | Promoted multi-tab + split-pane terminal grid (Tilix-style) from next-iteration to MVP as FR-08, per user decision during system-architect intake. Resolved Q1 (master password for encryption key). Added distribution note (installable package expected, not just source build). |
| 1.2 | 2026-07-17 | Added NFR-7 (resource efficiency — lightweight, fast, memory-friendly), per user requirement during system-architect intake. Drives frontend framework and terminal-rendering decisions in architecture.md. |
| 1.3 | 2026-07-19 | FR-08 acceptance criteria revised: left-click on a sidebar project now switches to its existing tab instead of always opening a duplicate; right-click opens a context menu with an explicit "Open in new tab" action for that case. Replaces the old "always opens a new tab" behavior. |
| 1.4 | 2026-07-19 | FR-08 revised again: the horizontal tab-bar widget is removed entirely — sidebar becomes the sole way to open/switch/close/drag tabs. Added: automatic sub-session list when a project has 2+ open tabs (no manual expand/collapse), "Close terminal" Menu action (replaces the tab bar's per-tab close button), drag-to-split now sourced from sidebar rows/sub-items instead of tab-bar tabs (and can spawn a fresh session directly into a split if the source had none open yet). Added an edge case: deleting a project with open sessions closes them first. |
