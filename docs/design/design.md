# Design System — Terminal Navigator

> Version 2.0 · 2026-07-22 · Status: approved
> Files: design.md (this file, rules & rationale) · tokens.css / tokens.json (values) · components.md (component specs)
> Source docs: docs/prd-terminal-navigator.md (v1.7.2) · docs/backend/architecture.md (v1.5)

## 1. Project brief

Terminal Navigator is a single-user Rust + Tauri desktop app that replaces the author's Tilix + zsh workflow. Primary job: click a saved project and get a terminal already `cd`-ed into its path, with auto-run setup commands, inside a Tilix-style sidebar-driven split-pane grid (FR-08, v1.4 — sessions are opened/switched/closed/dragged from the sidebar, there is no separate tab bar). Audience is exactly one person — a developer, technically fluent, who needs zero hand-holding but does need speed and trust (the app stores potentially credential-bearing commands/notes, encrypted, per NFR-3).

Brand reference: **Warp** — modern, simple, feature-rich. Personality: **minimal**. Mode: **dark-only** for MVP (light mode explicitly out of scope). UI language: **English**.

Scope: sidebar project list (with browse-folder add flow, session sub-items, drag-to-split, and — v1.8, FR-11 — user-organized drag-and-drop folders), split-pane terminal grid, Add/Edit project form, master-password unlock screen, per-project notes editor, and (v1.6, FR-13) a Settings panel — terminal theme presets, master password change, keybinding customization, sidebar position. Stack: Tauri + Svelte, terminal rendered via `xterm.js` + WebGL renderer (architecture.md ADR-0006).

Success criteria: the app is used daily, replacing Tilix. That bar is about *felt* speed and unobtrusiveness as much as visual polish — see Principle 1 below.

## 2. Design principles

1. **Perceived speed over decoration.** This app exists to remove friction from a workflow the user already does dozens of times a day (NFR-7, NFR-1). When a choice trades visual richness for a snappier feel (fewer shadows, flat surfaces, minimal transition chaining), take the snappier feel.
2. **One signature moment, disciplined everywhere else.** The gradient (`--color-accent-gradient`) appears in exactly **one** place app-wide: the unlock screen's ambient glow. Nowhere else. (Until v1.4 it had a second home — the removed tab bar's active-tab underline; when that component was removed, the gradient was deliberately *not* relocated to the sidebar's active-state indicator, which uses solid `--color-primary` instead — see `Tab (terminal tab bar) — REMOVED in v1.4` in components.md for why.) This is what keeps "minimal" true rather than aspirational.
3. **Trust is shown, not assumed.** Because notes/commands may hold credentials (NFR-3), every place that holds or shows that data carries the `Security Badge`. A user should never have to wonder "is this field protected?"
4. **Focus must always be legible.** With split-panes (FR-08), the single biggest usability risk is typing into the wrong pane. The focused-pane border (components.md, Split Pane Container) is never optional, never subtle to the point of ambiguity.
5. **The path is the identity.** A project's filesystem path is shown in monospace wherever it appears — it's the one piece of information this whole app exists to make instantly visible. As of v1.4, the sidebar row trades *constant* visibility for a calmer resting state (path reveals on hover/focus instead of sitting permanently on a second line); this principle still holds at the pane header, which stays the one place a project's path is visible persistently once its terminal is actually open.

## 3. Design direction

**Chosen direction: "Warp Modern"** (gradient-accent minimal), selected from three proposed directions (mono-flat "Terminal Native" and IDE-like "Structured Workspace" were the alternatives). Rationale: it most directly matches the user's own reference point (Warp) and stated personality ("minimal"), while the disciplined one-place gradient rule (Principle 2) prevents the aesthetic from working against "minimal."

The signature element is the gradient itself (`--green-500 → --cyan-500`, an "aurora" grass-green-to-sky-blue sweep — as of v1.5, was `--violet-500 → --pink-500`), used purely decoratively (never under text, since both gradient stops individually fail text contrast — see §7). As of v1.4 it marks exactly one thing: "your data is about to be decrypted" (the unlock screen's glow) — the moment the user's attention should land before anything else in the app is even visible. It previously also marked "this tab is active," until the tab bar itself was removed in v1.4.

Security gets its own distinct hue (emerald, `--color-security`) rather than reusing the gradient, so "active/selected" and "protected/encrypted" never read as the same signal. This distinction is now closer than it used to be — the primary is a green (`--color-primary`, grass green ~124° hue) and security is also a green family (`--color-security`, teal-spring ~158° hue) — so the ~34° hue separation plus a deliberate lightness/saturation difference (§4.1) carries the load that "purple vs. green" used to carry for free. Never rely on that separation alone, though: `--color-security` is always paired with the lock icon (Principle 3), which is the real disambiguator if a viewer can't distinguish the hues.

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
| `--color-primary` | `#16741C` | Solid interactive fills (buttons, focus ring source) |
| `--color-primary-hover` / `-active` | `#125E17` / `#0C4010` | Button hover/press |
| `--color-accent-gradient` | `#3EDA49 → #36B4E2` | Decorative only — unlock screen glow (its only remaining use as of v1.4; the tab bar it also used to appear on is removed) |
| `--color-primary-bg-subtle` | `rgba(22, 116, 28, 0.18)` | Translucent overlay fill — drag-and-drop drop zones |
| `--color-security` | `#34D399` | Encryption/trust signal (badge, sync status text) — deliberately a different green than `--color-primary`, see §3 |
| `--color-warning` | `#FBBF24` | Warnings |
| `--color-danger` | `#F87171` | Errors, destructive actions |
| `--color-focus` | `#16741C` | Focus ring (all interactive elements) |

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

### 4.5 Terminal theme presets (FR-13, v1.6) — a separate palette system, not app-chrome tokens

**These are not design tokens and do not live in `tokens.css`/`tokens.json`.** Per architecture.md ADR-0009, the backend only ever persists a selected preset's *id* (a string); the full color definitions below belong entirely to the frontend, in a small static data module (`src/lib/theme-presets.ts` — see components.md, Theme Preset Card). They govern **terminal content colors only** (the `xterm.js` `Theme` object for each pane) — they never apply to app chrome (sidebar, modals, buttons), which stays governed by §4.1's tokens exactly as before. Do not add a preset color here to `tokens.css` by mistake, and do not pull an app-chrome token into a preset just because the hex happens to match — the two systems are deliberately independent so one can't drift by editing the other.

All four presets are dark (no light terminal theme ships in MVP) — this directly extends the app's existing dark-only stance (§1, §3) to terminal content, the same way it already applies to app chrome. A light terminal preset is an explicit non-goal for now, exactly like light app-chrome mode.

**App Default** is the only preset original to this app; it's derived from §4.1's existing tokens so a user who never opens Settings sees no change from today's behavior. It's also the one preset where reusing an app-chrome hex is intentional (ties terminal content back to the app's own identity) — the other three are independent, widely-recognized reference palettes (Dracula, Nord, Solarized Dark), chosen deliberately over inventing new color schemes: each is a known quantity many developers already recognize on sight, which is the same "boring/proven over novel" reasoning architecture.md applies to libraries (NFR-6), applied here to color.

| Slot | App Default | Dracula | Nord | Solarized Dark |
|---|---|---|---|---|
| background | `#0D0F14` | `#282A36` | `#2E3440` | `#002B36` |
| foreground | `#E4E7EC` | `#F8F8F2` | `#D8DEE9` | `#839496` |
| cursor | `#16741C` | `#F8F8F2` | `#D8DEE9` | `#93A1A1` |
| cursorAccent | `#0D0F14` | `#282A36` | `#2E3440` | `#002B36` |
| black | `#15181F` | `#21222C` | `#3B4252` | `#073642` |
| red | `#F87171` | `#FF5555` | `#BF616A` | `#DC322F` |
| green | `#16741C` | `#50FA7B` | `#A3BE8C` | `#859900` |
| yellow | `#FBBF24` | `#F1FA8C` | `#EBCB8B` | `#B58900` |
| blue | `#3B82F6` | `#BD93F9` | `#81A1C1` | `#268BD2` |
| magenta | `#C084FC` | `#FF79C6` | `#B48EAD` | `#D33682` |
| cyan | `#36B4E2` | `#8BE9FD` | `#88C0D0` | `#2AA198` |
| white | `#E4E7EC` | `#F8F8F2` | `#E5E9F0` | `#EEE8D5` |
| brightBlack | `#5A6272` | `#6272A4` | `#4C566A` | `#002B36` |
| brightRed | `#FCA5A5` | `#FF6E6E` | `#BF616A` | `#CB4B16` |
| brightGreen | `#3EDA49` | `#69FF94` | `#A3BE8C` | `#586E75` |
| brightYellow | `#FDE68A` | `#FFFFA5` | `#EBCB8B` | `#657B83` |
| brightBlue | `#60A5FA` | `#D6ACFF` | `#81A1C1` | `#839496` |
| brightMagenta | `#D8B4FE` | `#FF92DF` | `#B48EAD` | `#6C71C4` |
| brightCyan | `#7DD3FC` | `#A4FFFF` | `#88C0D0` | `#93A1A1` |
| brightWhite | `#FFFFFF` | `#FFFFFF` | `#ECEFF4` | `#FDF6E3` |

Nord's normal/bright rows are intentionally near-identical for colors other than black/white — that's Nord's actual documented palette (low bright/normal differentiation is one of its defining traits), not an error to "fix" by inventing more contrast.

### 4.6 Glass surfaces (FR-14, v2.0) — app-chrome tokens only, and only where the effect can actually exist

FR-14 asked for translucent "frosted glass" surfaces across sidebar, modals, menus, and terminal-pane backgrounds, with one user-adjustable intensity. Measurement cut that list to **modals and menus**, and a v2.0 re-derivation then corrected the intensity range itself after the shipped v1.9 values proved imperceptible in real use.

**Finding 1 — blur over a flat backdrop is a no-op.** The sidebar is a flex *sibling* of the terminal area (§5: fixed sidebar + main content area), not an overlay. Nothing but flat `--color-background` sits behind it. `backdrop-filter: blur()` applied over a uniform color returns that same uniform color — there is no detail to blur. The same is true of terminal-pane backgrounds, which sit on the pane container, not on other content. Giving these surfaces glass tokens would ship a setting that visibly does nothing.

**Finding 2 — terminal-pane translucency is mathematically inert on the default preset.** §4.5's App Default preset defines `background: #0D0F14`, which *is* `--color-background`. Compositing a color over itself returns it unchanged at every alpha:

| Preset background | α=1.0 | α=0.8 | α=0.6 |
|---|---|---|---|
| App Default `#0D0F14` | `#0D0F14` | `#0D0F14` | `#0D0F14` |
| Dracula `#282A36` | `#282A36` | `#23252F` | `#1D1F28` |

This settles **PRD Q9** (which system owns FR-14's translucency values) on evidence rather than preference: **translucency belongs to app-chrome tokens exclusively, and §4.5's terminal presets stay fully opaque and untouched.** The boundary §4.5 draws between the two systems is preserved exactly as written — not because crossing it was forbidden, but because crossing it would buy nothing for the preset most users are on. Do not add an alpha or blur value to a theme preset later "for consistency"; consistency with an invisible effect is not a reason.

#### v2.0 re-derivation — the worst-case model was wrong

v1.9 set the floors at modal `0.80` and menu `0.95`, derived against a **100%-white backdrop**. Shipped, the effect was imperceptible: over a normal dark terminal a modal moved from `#1C2029` to `#191D25`, a total delta of **10 out of 765**. The floors were arithmetically correct and practically useless.

The error was the model, not the arithmetic. **`backdrop-filter: blur()` averages a region; it does not sample the brightest pixel.** What governs contrast under glass is the *mean* luminance of the blurred neighbourhood. A terminal densely filled with white glyphs is not a white field — at ~30% glyph coverage it averages `#56575A`, far darker than `#FFFFFF`. Designing against a full-white screen meant designing against a backdrop the blur can essentially never produce.

Floors are therefore re-derived against a **realistic worst case: `#56575A`** (dense bright text, ~30% coverage). `--glass-blur` was raised 12px → 24px in the same change, and that is part of the argument rather than a cosmetic tweak: glyphs are ~8–16px, so a 24px kernel dissolves them into the local mean. A larger radius makes the averaging model *more* true and the floors *safer*, at zero contrast cost.

| Surface | v1.9 floor | v2.0 floor | See-through at floor | Why they differ |
|---|---|---|---|---|
| Modal | 0.80 | **0.40** | 130/765 (was 43) | composites over `--color-backdrop`, which already damps the content |
| Menu | 0.95 | **0.80** | 143/765 (was ~36) | no backdrop layer — sits directly on live terminal output |

"See-through" above is the rendered difference between a bright and a dark region *behind* the same glass — the thing the user actually perceives as transparency. Note the inversion: at their respective floors the menu is slightly more see-through than the modal, because the modal's `--color-backdrop` mutes what shows through. That is expected, not a bug to equalise.

Contrast at the new floors, on realistic content — both surfaces clear AA with margin:

| Surface @ floor | Composited | `--color-text` | `--color-text-muted` |
|---|---|---|---|
| Modal @ 0.40 | `#202329` | 12.70:1 ✅ | 5.05:1 ✅ |
| Menu @ 0.80 | `#282B33` | 11.42:1 ✅ | 4.54:1 ✅ |

#### Accepted risk — the pathological near-white backdrop

A backdrop *can* exceed the model: a contiguous near-white region larger than the 24px blur kernel survives averaging. That needs a light-themed TUI, a bright image rendered as blocks, or a full-width selection highlight. In that case, at maximum intensity:

| Surface @ floor, near-white backdrop | `--color-text` | `--color-text-muted` |
|---|---|---|
| Modal @ 0.40 | 8.23:1 ✅ | 3.27:1 ❌ below AA |
| Menu @ 0.80 | 6.85:1 ✅ | 2.72:1 ❌ below AA |

**This is a knowingly accepted risk, not an oversight.** It is bounded in three ways that make it acceptable: it degrades **only secondary/muted text** — primary `--color-text` stays 6.8:1 or better everywhere, so nothing becomes unreadable; every shipped terminal preset is dark (§4.5), so a bright field requires the user to actively run something unusual; and the intensity slider always reaches `0`, an immediate full-opacity escape hatch. If a future change makes light terminal content common, this trade-off must be revisited — it is conditional on that assumption, so do not treat these floors as permanent.

**The intensity control (resolves PRD Q10).** One user-facing slider writes `--glass-intensity` (0..1); each surface derives its own alpha from it inside `tokens.css`, clamped to its own floor. A single control stays safe across surfaces with different tolerances because the per-surface ranges do the protecting — the user adjusts one number and cannot reach a per-surface value the floor forbids. The scale is linear, and the default is `0` (fully opaque — the app looks exactly as it does today until the user opts in).

**NFR-9 rule — intensity 0 must mean the property is absent, not zero.** `backdrop-filter: blur(0px)` still promotes the element to its own compositing layer and pays most of the per-frame cost for no visual result. At `--glass-intensity: 0`, implementations must omit `backdrop-filter` entirely (gate it behind a class or attribute selector), not merely compute it to zero. This matters more here than in a typical web app: ADR-0006 disabled the WebGL terminal renderer, so the app's rendering headroom (NFR-7) is already narrower than originally designed for. The v2.0 radius increase (12px → 24px) raises the per-frame cost of the enabled state, which makes this gate more load-bearing, not less.

## 5. Layout rules

- **App shell:** fixed sidebar (260px, collapses to 56px icon rail below `--bp-sidebar-collapse`) + main content area (the split-pane grid alone, edge to edge — no tab bar as of v1.4). No page scroll at the app-shell level — only individual panels (sidebar list, modal body, terminal buffers) scroll internally.
- **No responsive grid system** — this is a single-window desktop app, not a multi-page responsive site. The only layout adaptation is the sidebar collapse rule above.
- **Density rule:** `--space-3` (12px) is the default padding for list rows and form field containers; `--space-6` (24px) separates distinct form sections/fields in the Add/Edit Project modal and the Settings panel's four groups alike (see components.md Patterns).
- **Terminal area always wins the remaining space** — sidebar is fixed-width, the pane grid fills 100% of everything else, full height.

## 6. Content & voice

- **Capitalization:** sentence case everywhere (buttons, labels, titles) — "Add project", not "Add Project" or "ADD PROJECT".
- **Button labels:** verb + object, specific — "Save project", "Unlock", "Delete project" — never bare "Submit" or "OK".
- **Error messages:** state what happened and, where possible, what to do — "This path doesn't exist. Check the folder location and try again." Never a bare "Invalid input."
- **Empty states** (e.g. no projects yet): one line describing what to do next — "No projects yet. Click **+ Add project** to get started." — plus the same primary action available in context.
- **Keybinding conflict/validation errors** (v1.6): name the actual conflicting action, don't just say "conflict" — "Already used by Split pane right." Missing-modifier rejections state the rule, not just "invalid" — "Must include Ctrl, Alt, or Cmd." Master password errors follow the existing Input error convention (§ Input, components.md) — "Current password is incorrect," never a bare "Error."
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
| `--color-on-primary` (#FFFFFF) | `--color-primary` (#16741C) | 5.9:1 | ✅ AA (normal text) |
| `--color-on-primary` (#FFFFFF) | `--color-primary-hover` (#125E17) | 8.0:1 | ✅ AA/AAA |
| `--color-security` (#34D399) | `--color-background` (#0D0F14) | 10.0:1 | ✅ AA/AAA |
| `--color-security` (#34D399) | `--color-security-bg-subtle` (#0F2A20) | 8.0:1 | ✅ AA/AAA |
| `--color-danger` (#F87171) | `--color-background` (#0D0F14) | 6.9:1 | ✅ AA |
| `--color-warning` (#FBBF24) | `--color-background` (#0D0F14) | 11.5:1 | ✅ AA/AAA |
| `--color-primary` (#16741C) | `--color-background` (#0D0F14) | 3.2:1 | ✅ AA (UI component / focus indicator, 3:1 threshold) |
| `--color-border-strong` (#5A6272) | `--color-background` (#0D0F14) | 3.1:1 | ✅ AA (UI component, 3:1 threshold) |
| **Glass surfaces (FR-14, v2.0)** — at maximum intensity, over the realistic blurred backdrop `#56575A` (§4.6) | | | |
| `--color-text-muted` (#8B92A3) | modal glass at α=0.40 (`#202329`) | 5.05:1 | ✅ AA |
| `--color-text` (#E4E7EC) | modal glass at α=0.40 (`#202329`) | 12.70:1 | ✅ AA/AAA |
| `--color-text-muted` (#8B92A3) | menu glass at α=0.80 (`#282B33`) | 4.54:1 | ✅ AA (at threshold — sets the menu floor at 0.80) |
| `--color-text` (#E4E7EC) | menu glass at α=0.80 (`#282B33`) | 11.42:1 | ✅ AA/AAA |
| **Same surfaces against the pathological near-white backdrop** — accepted risk, §4.6 | | | |
| `--color-text` (#E4E7EC) | modal glass at α=0.40 (`#3F4147`) | 8.23:1 | ✅ AA/AAA — primary text never fails |
| `--color-text-muted` (#8B92A3) | modal glass at α=0.40 (`#3F4147`) | 3.27:1 | ⚠️ below AA — knowingly accepted, see §4.6 |
| `--color-text` (#E4E7EC) | menu glass at α=0.80 (`#494D54`) | 6.85:1 | ✅ AA/AAA — primary text never fails |
| `--color-text-muted` (#8B92A3) | menu glass at α=0.80 (`#494D54`) | 2.72:1 | ⚠️ below AA — knowingly accepted, see §4.6 |

**Flagged and resolved during design:** white text directly on either raw gradient stop — `--green-500` (#3EDA49, **1.9:1**) or `--cyan-500` (#36B4E2, **1.8:1**) — is a real failure at both ends. This is why §3/Principle 2 restricts the gradient to purely decorative use (underline bars, glows) and components.md explicitly forbids placing text on it. Buttons use the solid `--color-primary` (5.9:1), never the gradient, for exactly this reason.

- **Focus style (global rule):** every interactive element gets a 2px outline in `--color-focus`, 2px offset (or -2px inset for full-width rows like Sidebar Project List Item) — no exceptions, no invisible `:focus` states.
- **Touch targets:** N/A as a touch requirement (desktop, pointer-driven), but all clickable controls still respect a minimum 24×24px hit area (WCAG 2.1 AA 2.5.5-adjacent good practice), matching `--control-height-sm` as the practical floor.
- **Keyboard:** every documented component in components.md specifies its keyboard interactions explicitly — there is no component in this app that is mouse-only.
- **Reduced motion:** all pulsing/animated states (Sidebar Session Sub-item's `running` status dot, Security Badge's `error` pulse) collapse to a static equivalent under `prefers-reduced-motion: reduce`. Transitions (hover, modal enter/exit) may keep near-instant (<50ms) motion under reduced-motion, per common convention, but never anything that loops or pulses.
- **Live regions (v1.6):** a Keybinding Row entering its `recording` state announces "Recording — press a key combination" via a polite live region (same convention as Textarea's autosave status); a captured conflict or missing-modifier rejection announces the specific error text from §6, not a generic failure tone.

## 8. Do / Don't

- ❌ Don't use raw hex/px values in implementation → ✅ use semantic tokens from `tokens.css`
- ❌ Don't put text directly on `--color-accent-gradient` → ✅ gradient is decoration-only (underline, glow); text-bearing surfaces use solid `--color-primary`
- ❌ Don't invent a second "encrypted/secure" visual language → ✅ `--color-security` (emerald) is the only signal for that meaning, always paired with the lock icon, everywhere in the app
- ❌ Don't substitute `--color-primary` for `--color-security` (or vice versa) because "they're both green now" → ✅ they're different tokens for different meanings on purpose (§3); always reference the semantic token, never eyeball a green and assume it's interchangeable
- ❌ Don't let the active-pane focus indicator be optional or purely a color tint → ✅ always render the full `--color-primary` border around the focused pane (Principle 4 — wrong-pane typing is the app's worst usability failure)
- ❌ Don't add drop shadows to flat surfaces (sidebar rows, session sub-items, panes) → ✅ shadows are reserved for true elevation (modals/popovers) per Principle 1
- ❌ Don't introduce new font sizes outside §4.2's scale → ✅ pick the nearest token; if none fits, propose a token addition, don't hardcode
- ❌ Don't let a keybinding be captured without at least one of Ctrl/Alt/Cmd → ✅ reject bare or Shift-only combos before they can be saved (§4.5's presets are irrelevant here — this is about not breaking normal typing in the terminal, see components.md Keybinding Row)
- ❌ Don't add the gradient (`--color-accent-gradient`) to the Theme Preset Card's selected state "because it's a picker, it deserves flair" → ✅ selected state uses solid `--color-primary` (border + checkmark), same reasoning as the sidebar's `active` state (components.md, Tab — REMOVED in v1.4) — the gradient stays at exactly one place app-wide (Principle 2)
- ❌ Don't add glass/translucency to the sidebar or terminal-pane backgrounds → ✅ glass applies to Modal and Menu only (§4.6) — the other two sit on a flat backdrop where blur is provably a no-op; if a future layout floats the sidebar *over* the terminal area, that's a §5 layout change to decide first, and only then does sidebar glass become a real option
- ❌ Don't add an alpha or blur value to a §4.5 terminal theme preset → ✅ translucency lives exclusively in app-chrome tokens (§4.6 resolves Q9); the preset/token separation §4.5 defines is intact, and "consistency" is not a reason to cross it for an effect that is inert on the default preset
- ❌ Don't hand-write a per-surface alpha, or widen a range in `tokens.css` to make the effect "more visible" → ✅ set `--glass-intensity` only. The floors in those `calc()` expressions are contrast-verified in §7 against a stated backdrop model; widening one silently detaches it from that model. If the effect genuinely needs to go further, re-derive the model and record it (as v2.0 did when v1.9's floors proved imperceptible) — the rule is *derive and document*, not *never change*
- ❌ Don't raise `--glass-blur` and lower a floor in the same breath without re-checking → ✅ a larger blur radius makes the averaging model in §4.6 *more* accurate and the floors safer; a smaller one makes them riskier, because local bright regions survive averaging. Reducing the radius below 24px invalidates the current floors
- ❌ Don't ship `backdrop-filter: blur(0px)` at intensity 0 → ✅ omit the property entirely at 0 (§4.6) — a zero blur still pays the compositing cost, which NFR-9 exists to prevent
- ❌ Don't add a second confirmation modal/step on top of the master-password-change form → ✅ the three-field form (current, new, confirm) is itself the friction gate; a nested confirm dialog is ceremony this app's "perceived speed" principle doesn't want

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
9. **Terminal theme preset colors (§4.5) are not tokens** — implement them as the frontend-only data module architecture.md ADR-0009 specifies (`src/lib/theme-presets.ts`), not as additions to `tokens.css`/`tokens.json`. Rule 2's "never invent values" still applies to app-chrome colors; it does not extend to these — §4.5's table is itself the source of truth for them.

## 10. Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-17 | Initial design system: brief, "Warp Modern" direction, full token set (verified contrast), 8 core components + 4 patterns. |
| 1.1 | 2026-07-18 | EVOLVE: added Tab drag-to-split interaction — new `dragging` Tab state, Split Pane Container drop-zone system (4-triangle targeting, no center zone — this app has no per-pane tab strips, unlike VS Code), new `--color-primary-bg-subtle` token, new "Tab drag-to-split" pattern. No visual direction change. |
| 1.2 | 2026-07-19 | EVOLVE per PRD v1.3: left-click on a sidebar project now switches to its existing tab instead of always duplicating; new "Menu" component (overflow + right-click context variant, identical content, keeps "Open in new tab" keyboard-reachable) replaces the old inline overflow-menu description in Sidebar Project List Item; new `open`/`active` left-edge bar states replace the unimplemented "opened once" dot-color idea from v1.0. No new tokens, no visual direction change. |
| 1.3 | 2026-07-19 | EVOLVE per PRD v1.4: horizontal tab bar removed entirely — sidebar is now the sole entry point for opening, switching, closing, and drag-sourcing terminal sessions. `Tab` component spec marked REMOVED (see its stub in components.md for rationale). Sidebar Project List Item gains a three-mode model by open-session count (0 / 1 / 2+), with 2+ auto-expanding into a new "Sidebar Session Sub-item" component — no manual expand/collapse toggle. Menu gains a conditional "Close terminal" item (exactly-1-session case only). Split Pane Container's pane header is now always rendered (previously gated by `multiPane`) since it is the only remaining "which project/session" indicator with no tab label to fall back on. Signature gradient reduced from **two** places to **one** (the unlock screen only) — deliberately not relocated to the sidebar (§2, §3, §4.1, §8 updated). `--tab-height` token is now orphaned (kept defined, unused) since its only consumer is removed. No new tokens, no visual direction change. |
| 1.4 | 2026-07-20 | EVOLVE per direct product decision (no PRD FR yet): Sidebar Project List Item's status dot is repurposed from path-validity to **has-open-session** (project-scope, independent of which tab is currently active) — this deliberately revives the dot-color idea v1.2's changelog notes was dropped in favor of the left-edge bar, now at the owner's explicit request; the two signals remain visually distinct (dot = "anything open here", bar = "this is the one on screen"). Path validity moves to text color only (`--color-text-muted` when invalid, `--color-text` when valid) and the path itself moves from an always-visible second line to a hover/focus-revealed tooltip (first real use of the previously-reserved `--z-tooltip` token) — Principle 5 updated to reflect that the pane header, not the sidebar row, is now the persistently-visible path location. New "Sidebar show/hide toggle" pattern: a manual, fully-implemented full-hide control, deliberately on a separate axis from the breakpoint icon-rail collapse described in components.md's Sidebar layout — code-review turned up that the icon-rail collapse itself was never actually implemented (token defined, nothing reads it), so components.md now marks it ❌ rather than implying it's a working baseline; the two are meant to compose independently whenever it does get built. New feature: Ctrl+Shift+C/V clipboard shortcuts in the terminal pane (no dedicated visual spec — behavioral only, xterm.js key-handler level). No new tokens beyond activating `--z-tooltip`; no visual direction change. |
| 1.5 | 2026-07-20 | EVOLVE per direct product decision (owner: replace purple with green): primary color changed from violet to green. Primitives `--violet-500/600/700/800` and `--pink-500` replaced by `--green-500/600/700/800` and `--cyan-500`; every semantic token that referenced them (`--color-primary`, `-hover`, `-active`, `--color-accent-gradient`, `--color-focus`, `--color-primary-bg-subtle`, `--shadow-glow-primary`) was re-derived from the new primitives, not hand-edited independently. New shades were computed (not eyeballed) to land on the same contrast ratios as before: `--color-primary` on white ≈5.9:1 (was 6.0:1), hover ≈8.0:1 (unchanged), primary-vs-background (focus/UI-component threshold) 3.2:1 (unchanged) — see §7. Because `--color-security` (emerald, ~158° hue) and the new primary (grass green, ~124° hue) are now both "green," picked the new primary's hue deliberately ~34° away plus a darker/less-saturated value so the two stay visually distinguishable side by side; §3 and §8 spell out that this separation is a backstop, not a replacement for the lock-icon pairing rule (Principle 3). Signature gradient becomes green→cyan ("aurora"), replacing violet→pink; both new stops individually fail text contrast same as before, so the decorative-only rule (Principle 2, §7) still applies unchanged. No component behavior, layout, or non-color token changed. |
| 1.8 | 2026-07-21 | EVOLVE per PRD v1.6 (FR-11, promoted to MVP): new `Sidebar Folder` component (components.md) — flat, drag-and-drop-managed project categorization, distinct from and composable with the existing session-count "grouped" display mode. Resolves PRD Q7 (reorder-vs-merge drop-zone distinction): each row's height splits into a three-band drop target (top/bottom ~25% = reorder-position insertion line, middle ~50% = merge-into full-row highlight), reusing `Split Pane Container`'s exact `--color-primary-bg-subtle`/`--color-primary` drop-zone token pairing rather than inventing a second vocabulary — reorder vs. merge is distinguished by geometry, not color, satisfying the color-alone accessibility rule for free. `Sidebar Project List Item` and the "Sidebar layout"/"Sidebar drag-to-split" pattern notes updated to reflect folders as an interleaved, equally-orderable top-level entry alongside ungrouped projects. No new tokens — every value is a reuse of existing color/spacing/motion tokens. Flagged, not resolved here: folder drag-drop currently has no keyboard-accessible equivalent (⚠️ TBD in components.md, owner: backend-implementer/design-implementer before build); a `grouped`-mode (2+ session) project row deliberately stays non-draggable for folder purposes too, uniform with its existing drag-to-split restriction, accepted as a known limitation rather than a conditional rule. |
| 1.6 | 2026-07-20 | EVOLVE per FR-13 (Settings Panel), architecture.md v1.1/ADR-0009/ADR-0010: added §4.5 Terminal theme presets (App Default + Dracula, Nord, Solarized Dark — a separate frontend-only palette system, not app-chrome tokens; resolves PRD Q6). New components (components.md): Theme Preset Card, Keybinding Row (+ its `recording`/conflict states), Segmented Control (2-option toggle, used for sidebar position). New pattern: Settings Panel (Modal, `form` variant, reused as-is — no new modal size needed since the theme picker uses a 2-column grid rather than forcing all 4 cards onto one row). Settings Panel deliberately deviates from Modal's "one primary button in the footer" default: everything except master-password-change autosaves per-control (same philosophy as the existing Notes/Textarea autosave precedent), so the footer holds only a dismiss action; master password change keeps its own scoped primary button ("Change password") since it's the one real submit-style action in the panel. Added keybinding safety rule (§8): captured combos must include Ctrl/Alt/Cmd, rejected otherwise — protects normal terminal typing from an accidental bare-key binding. No new design tokens required — everything composes from the existing token set. Fixed a stale HANDOFF.md reference to the gradient rule ("two places" → "one place," matching v1.3/v1.4's actual current state). |
| 2.0 | 2026-07-22 | EVOLVE — re-derivation of FR-14's intensity range after real-app feedback that the shipped v1.9 effect was imperceptible. **The v1.9 floors were arithmetically correct but built on the wrong model:** they were derived against a 100%-white backdrop, when `backdrop-filter: blur()` *averages* a region rather than sampling its brightest pixel. A terminal densely filled with white glyphs averages `#56575A`, not `#FFFFFF`, so v1.9 was designing against a backdrop the blur can essentially never produce — over a normal dark terminal a modal moved only `#1C2029` → `#191D25`, a delta of 10/765. Floors re-derived against that realistic backdrop: modal `0.80 → 0.40`, menu `0.95 → 0.80`, raising measured see-through from 43→130/765 and ~36→143/765 respectively. `--glass-blur` raised 12px → 24px as *part of the argument*, not decoration: ~8–16px glyphs dissolve into the local mean under a 24px kernel, which is what makes the averaging model true — a larger radius makes the floors safer, never riskier (new §8 rule forbids lowering it below 24px without re-deriving). Added `--glass-edge` (decorative lit rim; a border, never under text). Documented an **accepted risk** rather than hiding it: a contiguous near-white region larger than the blur kernel (light-themed TUI, bright image, wide selection highlight) survives averaging and drops `--color-text-muted` to 3.27:1 (modal) / 2.72:1 (menu) at maximum intensity. Bounded by three facts — primary `--color-text` never drops below 6.85:1 so nothing becomes unreadable, all shipped presets are dark (§4.5), and intensity 0 is always reachable. §8's "don't widen the ranges" rule reworded from *never change* to *derive and document*, since this version is exactly the legitimate case it should permit. |
| 1.9 | 2026-07-22 | EVOLVE per PRD v1.7 (FR-14, Glassmorphic Surfaces): added §4.6 and a glass token group (`--glass-intensity`, per-surface alpha/blur derivations, `--color-surface-elevated-glass`, `--color-menu-glass`); Modal and Menu each gain a glass state in components.md. **Scope was cut from four surfaces to two during design, on measurement:** the sidebar is a flex sibling of the terminal area (§5), so nothing but flat `--color-background` sits behind it and `backdrop-filter` over a uniform color is a no-op; terminal-pane translucency is mathematically inert on the App Default preset, whose background *is* `--color-background` (identical composite at every alpha). That second fact resolves **PRD Q9** on evidence: translucency lives exclusively in app-chrome tokens and §4.5's terminal presets stay opaque — the §4.5 boundary is preserved, not crossed. **PRD Q10** is resolved structurally rather than by guidance: one `--glass-intensity` (0..1, default 0) feeds per-surface `calc()` ranges whose floors are contrast-verified in §7 (modal 1.00→0.80, menu 1.00→0.95), so no reachable slider position fails AA. Menus get the far tighter range because, unlike modals, they float directly over live terminal output with no `--color-backdrop` beneath — worst-case muted text over white output fails AA below α=0.95 (computed, §4.6 Finding 3), and blur does not rescue it since blur preserves average luminance. New §8 rules forbid extending glass to sidebar/panes, adding alpha to a theme preset, widening the token ranges by hand, and emitting `blur(0px)` at intensity 0 (NFR-9 — a zero blur still pays the compositing cost, which matters more here because ADR-0006 already removed the WebGL renderer's headroom). |
| 1.7 | 2026-07-20 | EVOLVE per architecture.md v1.3 (keybinding registry extended to zoom + tab-cycling actions, no new visual spec needed for those — behavioral only, same as the original Ctrl+Shift+C/V clipboard shortcuts precedent, FR-13 v1.4). Sidebar show/hide toggle's icon changed from direction-flipping ◀/▶ (which had to swap based on `settingsStore.sidebarPosition`) to a single consistent hamburger (☰) in both hidden/shown states and both sidebar positions — simpler, no swap logic needed, standard convention for a sidebar/menu toggle. No new tokens, no visual direction change. |
