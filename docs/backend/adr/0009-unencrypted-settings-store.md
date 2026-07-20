# ADR-0009: Separate unencrypted settings store for non-sensitive preferences

- **Status:** accepted
- **Date:** 2026-07-20
- **Drivers:** NFR-8, FR-13, CON-4, CON-5

## Context

FR-13 (Settings Panel) adds four preferences: terminal theme, master password, keybindings, and sidebar position. Three of the four (theme, keybindings, sidebar position) are explicitly not sensitive (NFR-8) and must be readable/writable without the app being unlocked — e.g. so app chrome can render in the user's chosen theme/sidebar side even at the unlock screen, before a master password has been entered. The existing single-file store (`project_store`, ADR-0004) is gated entirely behind `ProjectStore::unlock` and holds only the `Project` entity (architecture.md §10.3 — entity ownership is exclusive); it cannot serve this need without breaking that rule or forcing users to unlock just to change a theme.

## Options considered

### Option A — Same `app_data_dir()`, a second plaintext file alongside `projects.enc`
Reuses the directory Tauri's `app.path().app_data_dir()` already resolves and that `lib.rs` already creates + restricts to `0700` (security audit M3). One new file (`settings.json`), zero new directory-resolution code.

### Option B — Dedicated `app_config_dir()`
Tauri also exposes a separate, XDG-correct config directory (`~/.config/<app>` vs `~/.local/share/<app>` on Linux) — the conventional split between "data" and "config" on most OSes. More textbook-correct, but introduces a second directory-resolution path, a second directory to create/permission/document, for a single-user app where nothing currently reads that distinction.

## Decision

Use Option A. Store settings as a new plaintext JSON file, `settings.json`, in the same `app_data_dir()` already used for `projects.enc`, owned by a new Rust module, **`settings_store`** — not `project_store`, since `Settings` is a distinct entity from `Project` and the exclusive-ownership rule (architecture.md §10.3) applies to it too. `settings_store` has no `crypto` dependency and no unlock gate: its load/save functions operate directly on `settings.json` from process start, independent of whether `project_store` is unlocked.

`Settings` shape (JSON, via `serde`):
```rust
struct Settings {
    theme_preset: String,           // an id, e.g. "dracula" — see below
    keybindings: HashMap<String, String>, // action id -> key combo string
    sidebar_position: SidebarPosition,     // "left" | "right"
}
```

**Theme color values live in the frontend, not this struct or this module.** `settings_store`/`Settings` persists only the selected preset's *id* (a string). The actual palette definitions (background, foreground, cursor, cursor-accent, and the full ANSI 16-color table) live in a small frontend module (e.g. `src/lib/theme-presets.ts`), the same way `docs/design/tokens.css` already owns app-chrome color values — Rust has no reason to own UI color constants. This also closes the standing "ANSI 16-color palette ... unspecified: using xterm's defaults — review needed" gap noted in `TerminalPane.svelte`: each preset now explicitly defines all 16 ANSI colors instead of inheriting xterm.js defaults. The concrete preset list/values are ui-ux-designer's to pick (PRD Q6) — this ADR only fixes that Rust stores an id, never a color.

**Keybinding conflict detection is generic, not action-aware.** `settings_store` validates "no two keys in the map share the same value" — a check that works regardless of how many actions exist or what they do. It does not need to know what `"pane.splitBottom"` means; that meaning lives entirely in the frontend action handlers that look up their own id in the map.

## Consequences

- Settings are readable/writable before `project_store` is ever unlocked (satisfies NFR-8 directly) — no coupling to the encrypted blob's lifecycle.
- One more file to reason about, but zero new OS-directory conventions (CON-4/CON-5's "no unnecessary new tooling" spirit) — same pattern the project already uses for `projects.enc`.
- Because `settings.json` is plaintext JSON (not `bincode`), it's human-readable/hand-editable on disk if something ever needs manual repair — an accepted, deliberate trade since it holds nothing sensitive.
- `settings_store` growing new fields later (e.g. a future non-sensitive preference) is a non-breaking additive change to the `Settings` struct with `#[serde(default)]` on new fields, so old `settings.json` files on disk keep loading.
- **Revisit trigger:** if a future preference turns out to be sensitive (contains credentials or similar), it must NOT go into `settings.json` — route it through `project_store`/`crypto` instead, and treat that as a new ADR, not a silent addition here.
