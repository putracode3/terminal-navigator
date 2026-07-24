# Handoff — Terminal Navigator Design System

Paste this into your project's agent instructions file (`CLAUDE.md` / `AGENTS.md`) before writing any UI code:

> Before implementing any UI in this project, read `docs/design/design.md` in full. Follow its §9 "Instructions for AI agents" exactly. Component behavior/states are defined in `docs/design/components.md` — never invent a state or style not listed there. All values (color, spacing, type, radius, motion) must come from `docs/design/tokens.css` (mirrored in `tokens.json`) — never hardcode a raw hex or px value. If the `design-implementer` skill is available, run it to verify implementation compliance against this package before considering UI work done.

## Implementation order

1. **Tokens** — import `tokens.css` globally in the Svelte app; confirm `:root` variables resolve (dark theme, default) and `:root[data-theme="light"]` overrides resolve when the attribute is set (v2.5 — see design.md §4.1a/§9 for how the attribute gets set; never gate this in CSS with `@media (prefers-color-scheme)`).
2. **Base/primitives** — Button, Input, Textarea, Security Badge (these compose into everything else).
3. **App-shell components** — Sidebar Project List Item, Sidebar Folder (v1.8, FR-11), Tab, Split Pane Container.
4. **Modal/Dialog** + the two Patterns that use it (Add/Edit Project form, confirmations).
5. **Full-page patterns** — Unlock screen, Terminal tab + split grid area, Sidebar layout — these compose everything above.
6. **Settings Panel** (v1.6, FR-13) — Theme Preset Card, Keybinding Row, Segmented Control, then the Settings Panel pattern composing them with Modal/Input/Button/Security Badge. Build last — it depends on everything above.

## Notes

- **Light theme (v2.5)** — dark remains the default; light is a systematic inversion (design.md §4.1a). Components never branch on theme — they reference the same semantic tokens in both themes, and `tokens.css`'s `[data-theme="light"]` block does the substitution. Theme resolution (Dark/Light/System, including live OS-change tracking for "System") is frontend JS's job, setting `data-theme` on `<html>` before first paint — do not implement "System" via a CSS `@media (prefers-color-scheme)` query.
- The gradient (`--color-accent-gradient`) is restricted to exactly **one** place app-wide (design.md Principle 2, §8) — the unlock screen's ambient glow. Treat any second usage as a bug, not a style choice.
- Terminal theme presets (design.md §4.5) are frontend-only data, not design tokens — implement per architecture.md ADR-0009, do not add them to `tokens.css`/`tokens.json`. **v2.6:** 6 presets, and exactly one is theme-aware — App Default resolves to a dark or light variant from the chrome theme, while Dracula/Nord/Solarized Dark/Solarized Light/GitHub Light are fixed. The persisted id stays `"app-default"` for both variants (§4.5a, §9 rule 11); resolve the variant where the `xterm.js` theme object is built, never by mutating the preset data or storing a second id.
- Contrast for every token pair actually used in components.md is pre-verified in design.md §7 — if you introduce a new color pairing not in that table, compute its contrast before shipping it.
- **Glass surfaces (v1.9, FR-14)** — applies to **Modal and Menu only**. Set `--glass-intensity` (0..1) and nothing else; the per-surface alphas derive from it in `tokens.css`, and their floors are contrast-verified (design.md §4.6/§7). Three rules that are easy to get wrong: (1) do **not** add glass to the sidebar or terminal panes — both sit on flat `--color-background`, where `backdrop-filter` provably does nothing; (2) do **not** widen the `calc()` ranges to make the effect more visible — the floors are the AA limit, measured against worst-case white terminal output; (3) at `--glass-intensity: 0`, omit `backdrop-filter` entirely rather than emitting `blur(0px)`, which still pays the full compositing cost (NFR-9).
