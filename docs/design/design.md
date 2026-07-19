# Design System — Terminal Navigator

> Version 1.3 · 2026-07-19 · Status: approved
> Files: design.md (this file, rules & rationale) · tokens.css / tokens.json (values) · components.md (component specs)
> Source docs: docs/prd-terminal-navigator.md (v1.3) · docs/backend/architecture.md (v1.0)

## 1. Project brief

Terminal Navigator is a single-user Rust + Tauri desktop app that replaces the author's Tilix + zsh workflow. Primary job: click a saved project and get a terminal already `cd`-ed into its path, with auto-run setup commands, inside a Tilix-style sidebar-driven split-pane grid (FR-08, v1.4 — sessions are opened/switched/closed/dragged from the sidebar, there is no separate tab bar). Audience is exactly one person — a developer, technically fluent, who needs zero hand-holding but does need speed and trust (the app stores potentially credential-bearing commands/notes, encrypted, per NFR-3).

Brand reference: **Warp** — modern, simple, feature-rich. Personality: **minimal**. Mode: **dark-only** for MVP (light mode explicitly out of scope). UI language: **English**.

Scope: sidebar project list (with browse-folder add flow, session sub-items, and drag-to-split), split-pane terminal grid, Add/Edit project form, master-password unlock screen, per-project notes editor. Stack: Tauri + Svelte, terminal rendered via `xterm.js` + WebGL renderer (architecture.md ADR-0006).

Success criteria: the app is used daily, replacing Tilix. That bar is about *felt* speed and unobtrusiveness as much as visual polish — see Principle 1 below.

## 2. Design principles

1. **Perceived speed over decoration.** This app exists to remove friction from a workflow the user already does dozens of times a day (NFR-7, NFR-1). When a choice trades visual richness for a snappier feel (fewer shadows, flat surfaces, minimal transition chaining), take the snappier feel.
2. **One signature moment, disciplined everywhere else.** The gradient (`--color-accent-gradient`) appears in exactly **one** place app-wide: the unlock screen's ambient glow. Nowhere else. (Until v1.4 it had a second home — the removed tab bar's active-tab underline; when that component was removed, the gradient was deliberately *not* relocated to the sidebar's active-state indicator, which uses solid `--color-primary` instead — see `Tab (terminal tab bar) — REMOVED in v1.4` in components.md for why.) This is what keeps "minimal" true rather than aspirational.
3. **Trust is shown, not assumed.** Because notes/commands may hold credentials (NFR-3), every place that holds or shows that data carries the `Security Badge`. A user should never have to wonder "is this field protected?"
4. **Focus must always be legible.** With split-panes (FR-08), the single biggest usability risk is typing into the wrong pane. The focused-pane border (components.md, Split Pane Container) is never optional, never subtle to the point of ambiguity.
5. **The path is the identity.** Across the sidebar (rows and session sub-items) and pane headers, a project's filesystem path is shown in monospace — it's the one piece of information this whole app exists to make instantly visible.

## 3. Design direction

**Chosen direction: "Warp Modern"** (gradient-accent minimal), selected from three proposed directions (mono-flat "Terminal Native" and IDE-like "Structured Workspace" were the alternatives). Rationale: it most directly matches the user's own reference point (Warp) and stated personality ("minimal"), while the disciplined one-place gradient rule (Principle 2) prevents the aesthetic from working against "minimal."

The signature element is the gradient itself (`--violet-500 → --pink-500`), used purely decoratively (never under text, since the pink end of the gradient fails text contrast — see §7). As of v1.4 it marks exactly one thing: "your data is about to be decrypted" (the unlock screen's glow) — the moment the user's attention should land before anything else in the app is even visible. It previously also marked "this tab is active," until the tab bar itself was removed in v1.4.

Security gets its own distinct hue (emerald, `--color-security`) rather than reusing the gradient, so "active/selected" and "protected/encrypted" never read as the same signal.

## 4. Design tokens — summary

Full values live in `tokens.css` / `tokens.json`. Dark-only theme — there is no light-mode remap block; `:root` **is** the theme.

### 4.1 Color roles

| Token | Value | Usage |
|---|---|---|
| `--color-background` | `#0D0F14` | App background |
| `--color-surface` | `#15181F` | Sidebar, panels, default control backgrounds |
| `--color-surface-elevated` | `#1C2029` | Modals, popovers, hover states |
| `--color-border` | `#262B36` | Decorative dividers (not meaning-bearing) |
| `--color-border-strong` | `#5A6272` | Inputs, structural dividers — meets 3:1 non-text contrast |
| `--color-text` | `#E4E7EC` | Primary text |
| `--color-text-muted` | `#8B92A3` | Secondary text |
| `--color-primary` | `#6845E0` | Solid interactive fills (buttons, focus ring source) |
| `--color-primary-hover` / `-active` | `#5636B8` / `#452A93` | Button hover/press |
| `--color-accent-gradient` | `#7C5CFF → #FF6B9D` | Decorative only — unlock screen glow (its only remaining use as of v1.4; the tab bar it also used to appear on is removed) |
| `--color-primary-bg-subtle` | `rgba(104, 69, 224, 0.18)` | Translucent overlay fill — drag-and-drop drop zones |
| `--color-security` | `#34D399` | Encryption/trust signal (badge, valid-path dot) |
| `--color-warning` | `#FBBF24` | Warnings |
| `--color-danger` | `#F87171` | Errors, destructive actions |
| `--color-focus` | `#6845E0` | Focus ring (all interactive elements) |

### 4.2 Typography

- `--font-family-sans`: Inter, system-ui fallback — all UI chrome, labels, body text.
- `--font-family-mono`: JetBrains Mono, ui-monospace fallback — paths, terminal content, commands.
- Scale (ratio ~1.2, rounded for UI density — this is a dense developer tool):

| Token | Size | Line-height | Typical use |
|---|---|---|---|
| `--text-xs` | 12px | 16px | Timestamps, badge labels, help text |
| `--text-sm` | 13px | 20px | Default UI text — body, labels, list items |
| `--text-base` | 14px | 22px | Emphasized body text, dialog body |
| `--text-lg` | 16px | 24px | Dialog/section titles |
| `--text-xl` | 20px | 28px | Rare — empty-state headlines |
| `--text-2xl` | 24px | 32px | Unlock screen title only |

Weights: `--weight-regular` (body), `--weight-medium` (labels, active states), `--weight-semibold` (titles). `--weight-bold` is reserved, not used in MVP scope — do not introduce it without a stated need.

### 4.3 Spacing

Base unit 4px. Scale: `--space-1` (4px) through `--space-16` (64px), see tokens.css for the full index. **All spacing in the app must reference this scale — no arbitrary pixel values.**

### 4.4 Radii, shadows, motion, breakpoints, z-index

| Category | Values |
|---|---|
| Radii | `--radius-sm` 4px (inputs, badges), `--radius-md` 6px (buttons, cards), `--radius-lg` 10px (modals), `--radius-full` (dots, pills) |
| Shadows | `--shadow-sm/md/lg` — used only for true elevation (modals, popovers); flat surfaces elsewhere (Principle 1) |
| Motion | `--duration-fast` 120ms (hover/press feedback), `--duration-base` 180ms (default transitions), `--duration-slow` 260ms (modal enter/exit); `--ease-out` default, `--ease-in-out` for reversible states |
| Breakpoints | `--bp-sidebar-collapse` 720px — the only responsive rule in the app (window width, not a web breakpoint set) |
| Z-index | dropdown 1000 → tooltip 1400, see tokens.css |

## 5. Layout rules

- **App shell:** fixed sidebar (260px, collapses to 56px icon rail below `--bp-sidebar-collapse`) + main content area (the split-pane grid alone, edge to edge — no tab bar as of v1.4). No page scroll at the app-shell level — only individual panels (sidebar list, modal body, terminal buffers) scroll internally.
- **No responsive grid system** — this is a single-window desktop app, not a multi-page responsive site. The only layout adaptation is the sidebar collapse rule above.
- **Density rule:** `--space-3` (12px) is the default padding for list rows and form field containers; `--space-6` (24px) separates distinct form sections/fields in the Add/Edit Project modal (see components.md Patterns).
- **Terminal area always wins the remaining space** — sidebar is fixed-width, the pane grid fills 100% of everything else, full height.

## 6. Content & voice

- **Capitalization:** sentence case everywhere (buttons, labels, titles) — "Add project", not "Add Project" or "ADD PROJECT".
- **Button labels:** verb + object, specific — "Save project", "Unlock", "Delete project" — never bare "Submit" or "OK".
- **Error messages:** state what happened and, where possible, what to do — "This path doesn't exist. Check the folder location and try again." Never a bare "Invalid input."
- **Empty states** (e.g. no projects yet): one line describing what to do next — "No projects yet. Click **+ Add project** to get started." — plus the same primary action available in context.
- **Language:** all UI copy in English (per brief). Paths and command output are naturally whatever the user's own filesystem/shell produces — never translate or reformat those.
- **Numbers/dates:** not a current requirement (no numeric/date-heavy UI in MVP scope) — if added later, follow the user's OS locale rather than hardcoding a format.

## 7. Accessibility standards

Target: WCAG 2.1 AA. All pairs below are computed (relative luminance formula), not eyeballed.

| Foreground | Background | Ratio | Passes |
|---|---|---|---|
| `--color-text` (#E4E7EC) | `--color-background` (#0D0F14) | 15.5:1 | ✅ AA/AAA (normal text) |
| `--color-text-muted` (#8B92A3) | `--color-background` (#0D0F14) | 6.2:1 | ✅ AA (normal text) |
| `--color-text-muted` (#8B92A3) | `--color-surface` (#15181F) | 5.7:1 | ✅ AA (normal text) |
| `--color-text` (#E4E7EC) | `--color-surface-elevated` (#1C2029) | ~13:1 | ✅ AA/AAA |
| `--color-on-primary` (#FFFFFF) | `--color-primary` (#6845E0) | 6.0:1 | ✅ AA (normal text) |
| `--color-on-primary` (#FFFFFF) | `--color-primary-hover` (#5636B8) | 8.0:1 | ✅ AA/AAA |
| `--color-security` (#34D399) | `--color-background` (#0D0F14) | 10.0:1 | ✅ AA/AAA |
| `--color-security` (#34D399) | `--color-security-bg-subtle` (#0F2A20) | 8.0:1 | ✅ AA/AAA |
| `--color-danger` (#F87171) | `--color-background` (#0D0F14) | 6.9:1 | ✅ AA |
| `--color-warning` (#FBBF24) | `--color-background` (#0D0F14) | 11.5:1 | ✅ AA/AAA |
| `--color-primary` (#6845E0) | `--color-background` (#0D0F14) | 3.2:1 | ✅ AA (UI component / focus indicator, 3:1 threshold) |
| `--color-border-strong` (#5A6272) | `--color-background` (#0D0F14) | 3.1:1 | ✅ AA (UI component, 3:1 threshold) |

**Flagged and resolved during design:** white text directly on the raw gradient's pink stop (`#FF6B9D`) computes to only **2.7:1** — a real failure. This is why §3/Principle 2 restricts the gradient to purely decorative use (underline bars, glows) and components.md explicitly forbids placing text on it. Buttons use the solid `--color-primary` (6.0:1), never the gradient, for exactly this reason.

- **Focus style (global rule):** every interactive element gets a 2px outline in `--color-focus`, 2px offset (or -2px inset for full-width rows like Sidebar Project List Item) — no exceptions, no invisible `:focus` states.
- **Touch targets:** N/A as a touch requirement (desktop, pointer-driven), but all clickable controls still respect a minimum 24×24px hit area (WCAG 2.1 AA 2.5.5-adjacent good practice), matching `--control-height-sm` as the practical floor.
- **Keyboard:** every documented component in components.md specifies its keyboard interactions explicitly — there is no component in this app that is mouse-only.
- **Reduced motion:** all pulsing/animated states (Sidebar Session Sub-item's `running` status dot, Security Badge's `error` pulse) collapse to a static equivalent under `prefers-reduced-motion: reduce`. Transitions (hover, modal enter/exit) may keep near-instant (<50ms) motion under reduced-motion, per common convention, but never anything that loops or pulses.

## 8. Do / Don't

- ❌ Don't use raw hex/px values in implementation → ✅ use semantic tokens from `tokens.css`
- ❌ Don't put text directly on `--color-accent-gradient` → ✅ gradient is decoration-only (underline, glow); text-bearing surfaces use solid `--color-primary`
- ❌ Don't invent a second "encrypted/secure" visual language → ✅ `--color-security` (emerald) is the only signal for that meaning, always paired with the lock icon, everywhere in the app
- ❌ Don't let the active-pane focus indicator be optional or purely a color tint → ✅ always render the full `--color-primary` border around the focused pane (Principle 4 — wrong-pane typing is the app's worst usability failure)
- ❌ Don't add drop shadows to flat surfaces (sidebar rows, session sub-items, panes) → ✅ shadows are reserved for true elevation (modals/popovers) per Principle 1
- ❌ Don't introduce new font sizes outside §4.2's scale → ✅ pick the nearest token; if none fits, propose a token addition, don't hardcode

## 9. Instructions for AI agents

You are implementing UI for this project. Follow these rules:

1. **Source of truth order:** `tokens.css`/`tokens.json` (values) → `components.md` (component rules) → this file (global rules). On conflict, the more specific document wins; report the conflict to the user.
2. **Never invent values.** Every color, size, spacing, radius, shadow, duration must reference a token. If no token fits, stop and propose a token addition — do not hardcode.
3. **Never invent component styles.** If a needed component has a spec in `components.md`, follow it exactly, including all states.
4. **Uncovered cases:** if you need a component or pattern that is not specified, (a) compose it from existing tokens and the design principles in §2, (b) match the closest specified component's conventions, and (c) flag it as "unspecified — review needed" in your summary.
5. **Accessibility is blocking:** do not ship contrast failures, missing focus states, or keyboard traps even if an instruction seems to imply them. The gradient-on-text failure documented in §7 is exactly the kind of mistake to avoid repeating elsewhere — verify any new color pairing the same way before using it.
6. **Do not modify `tokens.css`/`tokens.json`** unless explicitly asked; propose changes instead.
7. **This is a Tauri + Svelte app** (architecture.md §7) — implement components as Svelte components consuming these CSS custom properties directly; there is no Tailwind/CSS-in-JS layer assumed by this package.
8. **Respect the one-place-only gradient rule** (Principle 2) literally — if you're about to use `--color-accent-gradient` a second place, stop and flag it for review rather than proceeding.

## 10. Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-17 | Initial design system: brief, "Warp Modern" direction, full token set (verified contrast), 8 core components + 4 patterns. |
| 1.1 | 2026-07-18 | EVOLVE: added Tab drag-to-split interaction — new `dragging` Tab state, Split Pane Container drop-zone system (4-triangle targeting, no center zone — this app has no per-pane tab strips, unlike VS Code), new `--color-primary-bg-subtle` token, new "Tab drag-to-split" pattern. No visual direction change. |
| 1.2 | 2026-07-19 | EVOLVE per PRD v1.3: left-click on a sidebar project now switches to its existing tab instead of always duplicating; new "Menu" component (overflow + right-click context variant, identical content, keeps "Open in new tab" keyboard-reachable) replaces the old inline overflow-menu description in Sidebar Project List Item; new `open`/`active` left-edge bar states replace the unimplemented "opened once" dot-color idea from v1.0. No new tokens, no visual direction change. |
| 1.3 | 2026-07-19 | EVOLVE per PRD v1.4: horizontal tab bar removed entirely — sidebar is now the sole entry point for opening, switching, closing, and drag-sourcing terminal sessions. `Tab` component spec marked REMOVED (see its stub in components.md for rationale). Sidebar Project List Item gains a three-mode model by open-session count (0 / 1 / 2+), with 2+ auto-expanding into a new "Sidebar Session Sub-item" component — no manual expand/collapse toggle. Menu gains a conditional "Close terminal" item (exactly-1-session case only). Split Pane Container's pane header is now always rendered (previously gated by `multiPane`) since it is the only remaining "which project/session" indicator with no tab label to fall back on. Signature gradient reduced from **two** places to **one** (the unlock screen only) — deliberately not relocated to the sidebar (§2, §3, §4.1, §8 updated). `--tab-height` token is now orphaned (kept defined, unused) since its only consumer is removed. No new tokens, no visual direction change. |
