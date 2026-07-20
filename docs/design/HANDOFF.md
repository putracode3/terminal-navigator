# Handoff — Terminal Navigator Design System

Paste this into your project's agent instructions file (`CLAUDE.md` / `AGENTS.md`) before writing any UI code:

> Before implementing any UI in this project, read `docs/design/design.md` in full. Follow its §9 "Instructions for AI agents" exactly. Component behavior/states are defined in `docs/design/components.md` — never invent a state or style not listed there. All values (color, spacing, type, radius, motion) must come from `docs/design/tokens.css` (mirrored in `tokens.json`) — never hardcode a raw hex or px value. If the `design-implementer` skill is available, run it to verify implementation compliance against this package before considering UI work done.

## Implementation order

1. **Tokens** — import `tokens.css` globally in the Svelte app; confirm `:root` variables resolve (dark-only theme, no light-mode toggle needed for MVP).
2. **Base/primitives** — Button, Input, Textarea, Security Badge (these compose into everything else).
3. **App-shell components** — Sidebar Project List Item, Tab, Split Pane Container.
4. **Modal/Dialog** + the two Patterns that use it (Add/Edit Project form, confirmations).
5. **Full-page patterns** — Unlock screen, Terminal tab + split grid area, Sidebar layout — these compose everything above.
6. **Settings Panel** (v1.6, FR-13) — Theme Preset Card, Keybinding Row, Segmented Control, then the Settings Panel pattern composing them with Modal/Input/Button/Security Badge. Build last — it depends on everything above.

## Notes

- This package is dark-only (MVP scope) — do not build a light-mode remap unless the user explicitly asks for it later (PRD next-iteration, not current scope).
- The gradient (`--color-accent-gradient`) is restricted to exactly **one** place app-wide (design.md Principle 2, §8) — the unlock screen's ambient glow. Treat any second usage as a bug, not a style choice.
- Terminal theme presets (design.md §4.5) are frontend-only data, not design tokens — implement per architecture.md ADR-0009, do not add them to `tokens.css`/`tokens.json`.
- Contrast for every token pair actually used in components.md is pre-verified in design.md §7 — if you introduce a new color pairing not in that table, compute its contrast before shipping it.
