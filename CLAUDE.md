# Terminal Navigator

Desktop project launcher + multi-pane terminal (Tauri: Rust backend in `src-tauri/`, Svelte frontend in `src/`). Personal, single-developer tool — see `docs/prd-terminal-navigator.md` for full scope (FR-01–FR-08).

## SDLC Skill Suite

This project uses the skill suite. Contract documents are law; check them before working, update them in the same change-set as the code they govern.

### Contract documents
| Doc | Path | Governs |
|---|---|---|
| PRD | `docs/prd-terminal-navigator.md` | scope & FR acceptance criteria (FR-01–FR-17; FR-06 removed by ADR-0014) |
| Architecture + ADRs | `docs/backend/architecture.md`, `docs/backend/adr/0001`–`0014` | modules, boundaries, cross-cutting decisions (PTY model, storage engine, terminal rendering, settings store, window chrome; ADR-0014 removed the master-password encryption) |
| Design system | `docs/design/` (design.md, tokens.css/json, components.md, HANDOFF.md) | all UI values & component specs |
| Test plan | `docs/qa/test-plan.md` | coverage-vs-risk matrix, test conventions, manual charters (incl. launch-environment charter — see below) |
| Runbook | `docs/ops/runbook.md` | build, release, rollback, backup/restore, uninstall |
| Security audits | `docs/security/audit-YYYY-MM-DD.md` | findings & remediation status (latest: `audit-2026-07-20.md` v1.10 — 0 Critical/High/Medium; 3 original Medium items + L7 + L8 + L9 fixed-verified; advisory DB refreshed 2026-09-25; **awaiting confirmation: L10 (first tagged CI run); L3's expanded scope awaiting sign-off**; remainder accepted/signed-off) |

### Not applicable here (with reasons)
- ➖ **DB schema doc** — storage is a single plain local file (ADR-0004; encryption removed by ADR-0014), not a relational database.
- ➖ **API contract doc** — no network API; all communication is local Tauri IPC commands between the Svelte frontend and Rust backend, documented inline in `src-tauri/src/commands/mod.rs`.
- ➖ **Post-mortems folder** — no incidents yet formalized as standalone post-mortem docs. The one significant bug so far (garbled terminal input when launched from a desktop launcher, root cause: missing `TERM` env var, fixed in commit `ec19eff`) had its lessons routed directly into the runbook's release-verification checklist and the test plan's launch-environment charter instead of a separate post-mortem file.

### Standing rules
1. New backend features → `backend-implementer` discipline: thin Tauri command handlers delegating to owning modules (`pty_manager`, `project_store`, `config_sync`, `command_runner`), tests included at the level shown in `docs/qa/test-plan.md` §3.
2. UI work → use `docs/design/tokens.css`/`tokens.json` values; no compliance script exists yet (no `check_tokens.py` in this repo) so token adherence is manual review for now.
3. **Environment-dependent bugs are not just a unit-test problem** — if a bug's trigger involves *how the process was launched* or *what's in its environment* (not just its inputs), it goes in `docs/qa/test-plan.md` §5.1's charter, not just another mocked unit test (this is the specific lesson from the `ec19eff` debugging session — chasing it with unit tests alone wasted real time before the actual cause was found).
4. Every non-trivial change → `code-reviewer` before considering it done; contract-doc changes ship in the same change-set as the code.
5. Bug/incident → `debugger` discipline (reproduce → root cause → regression test → sweep the bug class).
6. Release checklist lives in `docs/ops/runbook.md` §2 — the pre-flight test gate (`cargo test && npx vitest run && npm run check`) plus **verification from an actual desktop launcher, not just a terminal** is mandatory before a build becomes the daily driver.
7. Security findings: `docs/security/`'s remediation backlog is the source of truth for open items — check it before assuming the app's security posture is clean.
8. Unsure which skill / what's next → `project-navigator`.
