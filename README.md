# Terminal Navigator

A desktop project launcher + multi-pane terminal, built with Tauri (Rust) + SvelteKit. Personal tool: one place to jump to any local project and get a terminal open at its path, instead of typing `cd` and setup commands by hand every time.

Sidebar-driven tabs, Tilix-style split panes, auto-run setup commands per project, and an encrypted local project list unlocked with a master password.

## Docs

- [`docs/prd-terminal-navigator.md`](docs/prd-terminal-navigator.md) — product requirements, functional requirements (FR-01–FR-08), scope
- [`docs/backend/architecture.md`](docs/backend/architecture.md) + [`docs/backend/adr/`](docs/backend/adr/) — architecture decisions
- [`docs/design/design.md`](docs/design/design.md) — design system, tokens, component specs
- [`docs/ops/runbook.md`](docs/ops/runbook.md) — build, release, rollback, backup/restore
- [`docs/qa/test-plan.md`](docs/qa/test-plan.md) — test coverage map and manual test charters

## Development

```bash
npm install
npm run tauri dev
```

## Building a release

See [`docs/ops/runbook.md`](docs/ops/runbook.md) §2 for the full build/verify/install process, including a pre-flight test gate and a release-verification checklist that specifically covers launching from a desktop launcher (not just a terminal) — this matters, see the runbook for why.

```bash
npm run tauri build -- --bundles deb
```

## Tests

```bash
cd src-tauri && cargo test   # Rust backend
npx vitest run                # Svelte frontend
npm run check                 # TypeScript / svelte-check
```

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
