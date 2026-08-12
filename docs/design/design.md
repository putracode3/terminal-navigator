# Design System — Terminal Navigator

> Version 2.8 · 2026-07-29 · Status: approved
> Files: design.md (this file, rules & rationale) · tokens.css / tokens.json (values) · components.md (component specs)
> Source docs: docs/prd-terminal-navigator.md (v1.8.1) · docs/backend/architecture.md (v1.6)

## 1. Project brief

Terminal Navigator is a single-user Rust + Tauri desktop app that replaces the author's Tilix + zsh workflow. Primary job: click a saved project and get a terminal already `cd`-ed into its path, with auto-run setup commands, inside a Tilix-style sidebar-driven split-pane grid (FR-08, v1.4 — sessions are opened/switched/closed/dragged from the sidebar, there is no separate tab bar). Audience is exactly one person — a developer, technically fluent, who needs zero hand-holding but does need speed and trust (the app stores potentially credential-bearing commands/notes, encrypted, per NFR-3).

Brand reference: **Warp** — modern, simple, feature-rich. Personality: **minimal**. Mode: **dark and light** (v2.5) — dark remains the default; light is a systematic inversion of the same palette, selectable Dark/Light/System in Settings (§4.1a). UI language: **English**.

Scope: sidebar project list (with browse-folder add flow, session sub-items, drag-to-split, and — v1.8, FR-11 — user-organized drag-and-drop folders), split-pane terminal grid, Add/Edit project form, master-password unlock screen, per-project notes editor, and (v1.6, FR-13) a Settings panel — terminal theme presets, master password change, keybinding customization, sidebar position, and (v2.5) app appearance (Dark/Light/System). Stack: Tauri + Svelte, terminal rendered via `xterm.js` + WebGL renderer (architecture.md ADR-0006).

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

Full values live in `tokens.css` / `tokens.json`. Two themes (v2.5): the base `:root` block is dark (unchanged from v2.4, still the default), and `:root[data-theme="light"]` overrides the tokens that need it — see §4.1a for which tokens change, why, and how the attribute gets set.

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

### 4.1a Light theme (v2.5)

**Mechanism.** Theme selection is Dark / Light / System (Settings Panel, components.md). The frontend resolves this to a concrete `data-theme="dark"|"light"` attribute on `<html>` — "System" reads `window.matchMedia('(prefers-color-scheme: light)')` once at load and subscribes to its `change` event so the app follows OS theme switches live, without a reload. `tokens.css` never reads `prefers-color-scheme` itself; the attribute is the single source of truth the CSS keys off, because "System" needs a live JS subscription anyway (a plain `@media` query in CSS can't distinguish "user explicitly chose light" from "OS happens to be light"). To avoid a flash of the wrong theme on launch, resolve and set the attribute before first paint, not in an `onMount`-timed effect.

**Systematic inversion — the rule.** Light mode preserves every semantic role, every accent hue, and every relationship documented in §3 (gradient stays green→cyan, security stays a distinct ~34° hue from primary, the one-place-only gradient rule, etc.) — only the neutral ramp and a few accent shades are re-derived so they clear AA against a light background instead of a dark one. A token is **only** overridden in `:root[data-theme="light"]` if its computed contrast actually requires a different value; everything else inherits from the dark `:root` unchanged. Concretely:

- **Always re-derived:** `--color-background/-surface/-surface-elevated` (paper ramp, replaces the ink ramp), `--color-border/-border-strong`, `--color-text/-text-muted` (graphite ramp, replaces white-on-dark), `--color-security/-security-bg-subtle`, `--color-warning`, `--color-danger/-danger-bg-subtle`, plus the FR-14/FR-15 alpha curves and edge/glass colors (§4.6/§4.7 below).
- **Never re-derived (inherits from dark `:root`):** `--color-primary/-hover/-active` and `--color-focus` — these are solid fills always paired with white `--color-on-primary` text, or used as a focus-ring stroke that we verified clears 3:1 (in fact 5.38:1+, comfortably also clearing the 4.5:1 text threshold) against every light surface without any change; `--color-accent-gradient` — decorative-only in both themes, never sits under text (Principle 2, §7), so no background-contrast obligation exists to trigger a re-derivation; `--color-on-primary`/`--color-on-security` — paired only with solid accent fills, background-independent; `--color-backdrop` — a modal scrim is deliberately a dark overlay in **both** themes (standard practice: a scrim's job is to recede the rest of the app regardless of chrome theme, not to match it); `--color-primary-bg-subtle` — an alpha-based overlay that composites correctly over either background by construction.
- **Not tokens, and mostly not coupled:** terminal theme presets (§4.5) govern terminal content only and are never remapped by `data-theme`. v2.5 left them dark-only; **v2.6 revisited that** (§4.5a) and added light presets plus one deliberate coupling — App Default follows the chrome theme, every other preset stays a fixed manual choice. The presets are still not tokens and still live outside `tokens.css`; what changed is only *which variant of App Default* the frontend hands `xterm.js`.

**Light primitives and their verified contrast** (relative-luminance formula, computed not eyeballed, same standard as §7):

| Token | Value | Role | Ratio vs background / surface / elevated |
|---|---|---|---|
| `--paper-50` | `#FFFFFF` | Elevated (modals, popovers, hover) | — |
| `--paper-100` | `#F9FAFB` | Surface (sidebar, panels, controls) | — |
| `--paper-200` | `#F3F4F7` | App background | — |
| `--paper-border` | `#E2E5EA` | Decorative dividers (not meaning-bearing) | — |
| `--paper-border-strong` | `#7A8292` | Inputs, structural dividers | 3.51:1 / 3.70:1 / 3.86:1 — clears the 3:1 UI-component threshold against all three |
| `--graphite-900` | `#14161B` | Primary text | 16.46:1 / 17.32:1 / 18.10:1 |
| `--graphite-600` | `#565D6B` | Secondary/muted text | 6.02:1 / 6.33:1 / 6.62:1 — deliberately lands close to dark mode's 6.2:1 (§7), same margin of safety |
| `--emerald-700` | `#1B7C59` | Security accent, light mode | 4.70:1 vs background, 4.93:1 vs surface, 5.15:1 vs elevated; 4.56:1 on its own `--emerald-050` subtle bg |
| `--amber-800` | `#8D6703` | Warning, light mode | 4.70:1 vs background |
| `--red-700` | `#DB0A0A` | Danger, light mode | 4.70:1 vs background; 4.70:1 on its own `--red-050` subtle bg |

Note what did **not** need a light sibling: `--color-primary` (`#16741C`) already clears 5.38:1 / 5.66:1 / 5.92:1 against the new paper ramp — a genuine, non-obvious payoff of picking green-600 for its dark-mode contrast margin back in v1.5; it turned out dark enough to also work as light-mode text/icon/focus color with zero change.

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

**App Default** is the only preset original to this app; it's derived from §4.1's existing tokens so a user who never opens Settings sees no change from today's behavior. It's also the one preset where reusing an app-chrome hex is intentional (ties terminal content back to the app's own identity) — the others are independent, widely-recognized reference palettes (Dracula, Nord, Solarized Dark/Light, GitHub Light), chosen deliberately over inventing new color schemes: each is a known quantity many developers already recognize on sight, which is the same "boring/proven over novel" reasoning architecture.md applies to libraries (NFR-6), applied here to color.

**Dark presets** (App Default's dark variant, plus the three fixed dark reference palettes):

| Slot | App Default (dark) | Dracula | Nord | Solarized Dark |
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

#### 4.5a Light presets and the App Default coupling rule (v2.6)

Until v2.6 every preset was dark, justified as "extending the app's dark-only stance (§1, §3) to terminal content." **That justification died with v2.5**, which gave app chrome a light theme — §1/§3 no longer say dark-only, so the premise the old rule stood on no longer exists. v2.6 therefore re-decides the question on its own merits rather than inheriting a stance that was removed.

**App Default is theme-aware; every other preset is a fixed, explicit choice.** This is not new coupling bolted on — it honors App Default's *existing* definition. That preset has always meant "derived from §4.1's tokens so the terminal matches the app." §4.1 now has two token sets (§4.1a), so following the active one is what that definition already required; leaving it pinned to the dark values would be the actual contradiction.

| Preset | Under dark chrome | Under light chrome | Selection |
|---|---|---|---|
| **App Default** | dark variant | light variant | automatic — follows `data-theme` (§4.1a) |
| Dracula, Nord, Solarized Dark | dark | dark | manual, fixed |
| Solarized Light, GitHub Light | light | light | manual, fixed |

**The persisted value does not change shape.** ADR-0009's model — the backend stores only a preset *id* string — is untouched: the id stays `"app-default"` in both themes, and the frontend resolves which variant to hand `xterm.js` at render time, exactly as it already resolves `data-theme` itself. Do not persist `"app-default-light"` as a separate id; that would make the stored setting theme-dependent and break the round-trip when the user switches chrome themes.

**Why this specific coupling, and not full independence.** It is what keeps §4.6's accepted-risk argument true. That argument (below, and in §7) is bounded partly by "a bright terminal backdrop requires the user to actively choose something unusual." Under full independence, picking Light chrome would strand the user on a dark terminal until they *also* changed the preset — so the common fix would be picking a light preset, making bright backdrops ordinary under *both* chrome themes and invalidating the bound. With App Default following the theme, the light-chrome user is already served automatically, and running a light terminal under **dark** chrome stays what it was: a deliberate, unusual combination. The coupling buys back the exact precondition the contrast math depends on.

**Light preset color values** (the two manual ones are the published upstream palettes, unmodified; App Default Light is derived from §4.1a's light tokens the same way App Default Dark is derived from §4.1's dark ones):

| Slot | App Default Light | Solarized Light | GitHub Light |
|---|---|---|---|
| background | `#F3F4F7` | `#FDF6E3` | `#FFFFFF` |
| foreground | `#14161B` | `#657B83` | `#24292F` |
| cursor | `#16741C` | `#586E75` | `#24292F` |
| cursorAccent | `#F3F4F7` | `#FDF6E3` | `#FFFFFF` |
| black | `#14161B` | `#073642` | `#24292F` |
| red | `#DB0A0A` | `#DC322F` | `#CF222E` |
| green | `#16741C` | `#859900` | `#116329` |
| yellow | `#8D6703` | `#B58900` | `#4D2D00` |
| blue | `#1D63D2` | `#268BD2` | `#0969DA` |
| magenta | `#8B3FD9` | `#D33682` | `#8250DF` |
| cyan | `#0E6E8C` | `#2AA198` | `#1B7C83` |
| white | `#F9FAFB` | `#EEE8D5` | `#6E7781` |
| brightBlack | `#565D6B` | `#002B36` | `#57606A` |
| brightRed | `#A80808` | `#CB4B16` | `#A40E26` |
| brightGreen | `#0C4010` | `#586E75` | `#1A7F37` |
| brightYellow | `#6B4E02` | `#657B83` | `#633C01` |
| brightBlue | `#0F52A8` | `#839496` | `#218BFF` |
| brightMagenta | `#6D28B4` | `#6C71C4` | `#A475F9` |
| brightCyan | `#0B5F79` | `#93A1A1` | `#3192AA` |
| brightWhite | `#FFFFFF` | `#FDF6E3` | `#8C959F` |

**App Default Light inverts systematically, including `bright*`.** On a dark background "bright" means *lighter* (more contrast, more emphasis); on a light background the emphatic direction is *darker*, so App Default Light's `bright*` row is darker than its normal row — the mirror of App Default Dark, not a copy of it. Its `black`/`white` slots invert the same way: `black` takes the text color (`--graphite-900`) and `white` takes the surface color (`--paper-100`), matching how App Default Dark maps `black` to `--ink-900` and `white` to `--white-90`. Every App Default Light accent was picked to clear 4.5:1 against its own `#F3F4F7` background (verified in §7) — the dark preset's `blue`/`magenta`/`cyan` (`#3B82F6`/`#C084FC`/`#36B4E2`) all fail there (3.34/2.40/2.17), which is why they are re-derived rather than reused.

Solarized Light and GitHub Light are reproduced verbatim from their upstream definitions and are **not** held to that AA bar — the same stance already taken for Dracula, Nord, and Solarized Dark. These are third-party reference palettes whose recognizability *is* the feature; silently "fixing" their contrast would make them no longer the palette the user asked for. This asymmetry is deliberate: we own App Default, so we hold it to our standard; we don't own the others, so we ship them faithfully.


### 4.6 Glass surfaces (FR-14, v2.0) — app-chrome tokens only, and only where the effect can actually exist

FR-14 asked for translucent "frosted glass" surfaces across sidebar, modals, menus, and terminal-pane backgrounds, with one user-adjustable intensity. Measurement cut that list to **modals and menus**, and a v2.0 re-derivation then corrected the intensity range itself after the shipped v1.9 values proved imperceptible in real use.

**Finding 1 — blur over a flat backdrop is a no-op.** The sidebar is a flex *sibling* of the terminal area (§5: fixed sidebar + main content area), not an overlay. Nothing but flat `--color-background` sits behind it. `backdrop-filter: blur()` applied over a uniform color returns that same uniform color — there is no detail to blur. The same is true of terminal-pane backgrounds, which sit on the pane container, not on other content. Giving these surfaces glass tokens would ship a setting that visibly does nothing.

**Finding 2 — terminal-pane translucency is mathematically inert on the default preset.** §4.5's App Default preset defines `background: #0D0F14`, which *is* `--color-background`. Compositing a color over itself returns it unchanged at every alpha:

| Preset background | α=1.0 | α=0.8 | α=0.6 |
|---|---|---|---|
| App Default `#0D0F14` | `#0D0F14` | `#0D0F14` | `#0D0F14` |
| Dracula `#282A36` | `#282A36` | `#23252F` | `#1D1F28` |

**This finding survives v2.6 intact, and for the same reason rather than a lucky one.** App Default Light's background is `#F3F4F7`, which *is* light-mode `--color-background` (§4.1a) — so under light chrome the default preset composites over itself exactly as the dark one does under dark chrome. The identity that makes this finding true is "App Default's background equals the active `--color-background`", not the specific hex, and §4.5a's coupling rule is precisely what keeps that identity holding in both themes.

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

**This is a knowingly accepted risk, not an oversight.** It is bounded in three ways that make it acceptable: it degrades **only secondary/muted text** — primary `--color-text` stays 6.8:1 or better everywhere, so nothing becomes unreadable; a bright field requires the user to actively choose something unusual (see the v2.6 re-examination immediately below); and the intensity slider always reaches `0`, an immediate full-opacity escape hatch.

##### v2.6 re-examination — light terminal presets, and why the bound survives

The paragraph above used to justify its second bound with "every shipped terminal preset is dark (§4.5)", and warned: *"If a future change makes light terminal content common, this trade-off must be revisited."* **v2.6 is that change** (§4.5a adds Solarized Light, GitHub Light, and a light App Default variant), so the trade-off is revisited here rather than left to rot.

The realistic blurred backdrop is no longer a single value — it depends on the active preset. Computed with §4.6's own model (~30% glyph coverage):

| Active preset | Blurred backdrop | Reachable under dark chrome? |
|---|---|---|
| App Default (dark), Dracula, Nord, Solarized Dark | `#4D5055`–`#274A53` — at or below the `#56575A` model | yes, ordinary |
| App Default **Light** | `#B0B1B5` | **no** — App Default follows the chrome theme (§4.5a), so its light variant only ever runs under light chrome |
| Solarized Light | `#CFD1C6` | yes, but only by deliberate manual selection |
| GitHub Light | `#BDBFC1` | yes, but only by deliberate manual selection |

The dangerous combination is **dark chrome + a manually-chosen light preset** — a dark glass surface over a bright backdrop. At the current floors:

| Combination | Composited | `--color-text` | `--color-text-muted` |
|---|---|---|---|
| Dark chrome + Solarized Light, modal @ 0.40 | `#36393C` | 9.37:1 ✅ | 3.73:1 ⚠️ |
| Dark chrome + Solarized Light, menu @ 0.80 | `#404348` | 8.01:1 ✅ | 3.19:1 ⚠️ |
| Dark chrome + GitHub Light, modal @ 0.40 | `#33363C` | 9.77:1 ✅ | 3.89:1 ⚠️ |
| Dark chrome + GitHub Light, menu @ 0.80 | `#3C4047` | 8.40:1 ✅ | 3.34:1 ⚠️ |
| **Light** chrome + either light preset | — | ✅ | **5.19–6.10:1 ✅** — better than today |

**The floors are deliberately left unchanged, and the risk stays accepted.** Three reasons, in order of weight:

1. **The bound did not move — only the likelihood did.** Every number above sits *inside* the pathological near-white envelope this section already accepts (modal 3.27:1, menu 2.72:1). Nothing newly exceeds the documented worst case; a previously rare backdrop simply became reachable by an ordinary setting. Primary text stays ≥ 8.01:1 throughout, so the "nothing becomes unreadable" guarantee holds untouched.
2. **§4.5a's coupling is what preserves the "unusual choice" precondition.** Because App Default follows the chrome theme, a user who wants a light terminal under light chrome gets it automatically and never touches the preset picker. Reaching a bright backdrop under *dark* chrome therefore still requires deliberately selecting a named light palette against the grain of the active theme — exactly the "actively choose something unusual" the bound asserts. **Had full independence been chosen instead, this bound would have been invalidated** and the floors would have needed re-derivation.
3. **Fixing it globally would undo v2.0.** Holding muted text at AA against a Solarized Light backdrop requires the menu floor to rise 0.80 → **0.94** — which measures 76/765 see-through, back inside the imperceptible range that v2.0 was written specifically to correct (v1.9's 0.95 menu floor measured ~36/765 and was rejected for exactly this). Tightening the floors for every user to protect one deliberately-chosen combination would trade a real, visible feature for an edge case with a working escape hatch.

The escape hatch is unchanged and reachable: `--glass-intensity: 0` restores full opacity instantly, and light chrome (where the same presets measure 5.19–6.10:1) is always available.

**The intensity control (resolves PRD Q10).** One user-facing slider writes `--glass-intensity` (0..1); each surface derives its own alpha from it inside `tokens.css`, clamped to its own floor. A single control stays safe across surfaces with different tolerances because the per-surface ranges do the protecting — the user adjusts one number and cannot reach a per-surface value the floor forbids. The scale is linear, and the default is `0` (fully opaque — the app looks exactly as it does today until the user opts in).

**NFR-9 rule — intensity 0 must mean the property is absent, not zero.** `backdrop-filter: blur(0px)` still promotes the element to its own compositing layer and pays most of the per-frame cost for no visual result. At `--glass-intensity: 0`, implementations must omit `backdrop-filter` entirely (gate it behind a class or attribute selector), not merely compute it to zero. This matters more here than in a typical web app: ADR-0006 disabled the WebGL terminal renderer, so the app's rendering headroom (NFR-7) is already narrower than originally designed for. The v2.0 radius increase (12px → 24px) raises the per-frame cost of the enabled state, which makes this gate more load-bearing, not less.

#### Light re-derivation (v2.5) — the worst-case direction flips

§4.1a's light theme adds `--color-surface-elevated`/`--color-menu-glass` values that are near-white (`--paper-50`) instead of near-black (`--ink-850`), and swaps `--color-text`/`--color-text-muted` for the dark `--graphite-900`/`--graphite-600` pair. This is not a cosmetic swap of the same math — **which direction "more see-through" moves the composited color reverses.**

In dark mode, a dark glass surface composited over the realistic blurred terminal backdrop (`#56575A`, unchanged by app theme — terminal content is always dark, §4.5) stays dark at every alpha, so light text on it barely loses contrast as the surface gets more see-through. In light mode, a *white* glass surface composited over that same dark backdrop gets **darker** as it becomes more see-through — more of the dark backdrop shows through a lighter surface, dragging its luminance down toward the backdrop's. Dark text sitting on top loses contrast fast. This is the direct light-mode analogue of §4.7's wallpaper-worst-case flip below, arriving at the identical structural lesson: don't assume a floor transfers between themes just because the alpha formula looks the same.

Floors re-derived (composite `--paper-50` at alpha over the same realistic backdrop model §4.6 already established, then checked against `--graphite-600`, the binding constraint in both themes):

| Surface | Dark floor | Light floor | Composited (light, at floor) | `--graphite-600` ratio |
|---|---|---|---|---|
| Modal | 0.40 | **0.85** | `#DEDEDF` | 4.92:1 ✅ |
| Menu | 0.80 | **0.80** | `#DDDDDE` | 4.87:1 ✅ |

Light mode's usable range is far narrower than dark mode's — modal goes from "60% see-through at its floor" (dark) to "15% see-through at its floor" (light), because the backdrop-darkening effect described above eats the margin much faster than dark mode's backdrop-lightening-relative-to-black effect does. This is a genuine, computed asymmetry between the themes, not an oversight to "fix" by widening the light range — doing so would reintroduce the exact contrast failure this derivation exists to prevent.

Counter-intuitively, the *ordering* between modal and menu also does not carry over: in dark mode modal is the more-see-through surface (0.40 vs menu's 0.80) because `--color-backdrop` damps what's beneath it before the glass math even starts. In light mode that same damping makes the modal's effective backdrop *darker* (`--color-backdrop` is a dark overlay in both themes, §4.1a) than the menu's raw, undamped terminal backdrop — so for a light glass surface, the modal now needs to stay *more* opaque than the menu, not less. Both floors are correct; do not "equalize" them expecting the dark-mode ordering to hold.

**Accepted risk — a near-black contiguous terminal region.** Same category of edge case as dark mode's near-white one (§4.6 above), mirrored: a sparse/low-glyph-density pane, a solid dark selection block, or similar can average darker than the realistic `#56575A` model, down toward a raw dark preset background. At the true bound (`#000000`):

| Surface @ floor, near-black backdrop | `--graphite-900` | `--graphite-600` |
|---|---|---|
| Modal @ 0.85 | 12.82:1 ✅ | 4.69:1 ✅ — modal clears even this bound |
| Menu @ 0.80 | 11.27:1 ✅ | 4.12:1 ❌ below AA |

Bounded the same three ways as dark mode's accepted risk: only muted text degrades (primary text never drops below 11:1 in this scenario); reaching a near-black average needs an unusually sparse or dark pane, not ordinary use; and `--glass-intensity: 0` is always the reachable, fully-opaque escape hatch.

**v2.6 note — this particular risk got *smaller*, not larger.** It is the mirror of the dark-mode case: it needs a near-**black** backdrop, so light terminal presets make it rarer, not more common. And under light chrome the default preset is now App Default *Light* (§4.5a), whose blurred backdrop is `#B0B1B5` — far from black. The second bound above was originally worded "every shipped terminal preset is dark", which was both stale after v2.6 and, in this specific direction, arguing against its own conclusion; it is restated as a claim about the backdrop rather than the preset roster.

### 4.7 Window transparency (FR-15, v2.1) — the scrim that makes an unmeasurable backdrop safe

FR-15 makes the window itself see-through to the desktop. Architecturally the window is created `transparent: true` unconditionally and never varied at runtime (ADR-0012); what the user's slider actually drives is `--window-transparency` (0..1, default 0 = fully opaque), which sets the alpha of the app's own background layers.

**Why this cannot reuse §4.6's method.** FR-14's floors were computed against a *known* backdrop: the app's own content, blurred, which averages to a predictable value. A wallpaper is neither known nor blurred — `backdrop-filter` cannot touch it (see Finding 3 below), so nothing averages it toward a mean. The saving grace is that it is still **bounded**: any backdrop is somewhere between black and white. For this app — light text on dark surfaces — the worst case is therefore a **pure white wallpaper**, and that is a perfectly computable target. Unlike §4.6's discarded white-screen model, white here is genuinely reachable: a light wallpaper is an ordinary choice, not a pathological one.

**The floor.** `--window-transparency` maps to a scrim alpha of `1.00 → 0.64`. At that floor, over a white wallpaper:

| Text role | Composited (`#646569`) | Ratio | AA |
|---|---|---|---|
| `--color-text` (primary) | over white wallpaper at α=0.64 | 4.70:1 | ✅ |
| `--color-text-muted` (secondary) | over white wallpaper at α=0.64 | 1.87:1 | ❌ |

**Primary text is guaranteed; secondary text is knowingly not** (user decision, 2026-07-22). The alternative floor that would also protect muted text is α=0.90 — a 10% see-through that is imperceptible, repeating exactly the mistake §4.6's v2.0 entry was written to correct. The trade was made with both numbers on the table. Mitigations: `0` (fully opaque) is the default and always reachable; primary text and terminal output — the content users actually read — never drop below 4.5:1 on any wallpaper; and secondary text is by definition supporting information, never the only carrier of meaning (§7's colour-alone rule already guarantees that).

**Layering rule (v2.3, corrected) — exactly one surface paints the scrim per pixel; never two.** v2.1 originally described scrim layering as *additive and safe by construction* ("bounding the root bounds everything above it"). That framing was wrong, and shipping it caused a real bug: `body` painted the root scrim across the whole viewport, and `TerminalPane` *also* painted its own scrim on top for the pane region. Two `0.64` layers compositing on the same pixels does not stay at `0.64` — it compounds to `1 − 0.36² = 0.87`. The terminal area, meant to be the *most* see-through surface, rendered as the *most* opaque one, visibly "deep black" rather than translucent. Stacking scrims is not safe; it is the bug.

The corrected rule: **the window scrim is owned by exactly one surface for any given rendered pixel — whichever is the innermost thing actually visible there.** A parent must not paint the scrim underneath a child that already paints its own. Per this app's layout (§5: sidebar + terminal area tile the full viewport, no tab bar, terminal area always fills the remainder), that assignment is static and enumerable:

| Region | Scrim owner | Why |
|---|---|---|
| Title Bar (v2.8) | `TitleBar.svelte` (`--color-surface-scrim`) | Full window width, always rendered (locked or unlocked) directly on `body` — nothing else paints beneath it, same reasoning as Sidebar below |
| Sidebar | `Sidebar.svelte` (`--color-surface-scrim`) | Nothing else paints beneath it |
| Terminal area, a pane open | `TerminalPane`'s pane element (`paneBackground()`) | Innermost visible layer; carries the FR-13 preset color too |
| Terminal area, no pane open | `TerminalArea`'s `.empty-state` (`--color-background-scrim`) | The pane isn't rendered at all in this state (Svelte `{#if}`), so *something* must own the region — and did, via `body`, until this fix moved it to the correct owner |
| Unlock screen | `UnlockScreen.svelte` (`--color-background-scrim`) | A full-page pattern that replaces the app shell outright, not composited with it |
| `body` / `html` | **Nothing** | Layout coverage means it is never visible once unlocked (v2.8: the Title Bar's own scrim now covers what little of `body` the removed sidebar-reveal button used to transiently expose) |
| Pane divider hairlines (1px, `--color-border`) | Stay opaque, no scrim | Structural lines, not surfaces; a 1px scrim buys nothing perceptible and would still double-composite against whatever sits behind it |

**Never give a nested surface its own scrim without first confirming its parent has none.** That check — not "does the math clear the floor" — is what this bug actually needed; the floor math was correct throughout, and still is.

**Finding 3 — a transparent window does NOT resurrect sidebar or terminal-pane glass (resolves PRD Q12).** §4.6's Findings 1 and 2 concluded that glass on the sidebar and terminal panes is a no-op because only flat `--color-background` sits behind them. FR-15 appears to overturn that — the desktop now sits behind. **It does not, and the reason is worth stating precisely, because the opposite conclusion is the intuitive one.**

`backdrop-filter` samples the *page's own backdrop*: content rendered behind the element inside the document. The wallpaper is not in the document. It is composited with the window by the **window manager**, after the page has finished rendering — which is the very same reason blur-behind-the-window is impossible from application code on Linux (PRD §4.3). A transparent window lets the wallpaper show through *by compositing*, but it never enters the page's backdrop image, so `backdrop-filter` still has nothing but flat colour to blur.

**Findings 1 and 2 therefore stand, on stronger grounds than before.** Their original justification ("only flat `--color-background` is behind") was contingent on the window being opaque; this one is not. Do not enable glass on the sidebar or terminal panes because the window became transparent — the two features compose by *stacking alphas*, never by one feeding the other's blur.

**Presets stay opaque (PRD Q9 holds).** For the terminal area to show wallpaper, its rendered background must carry the scrim alpha. This does **not** mean editing §4.5's presets: they continue to store opaque reference hexes, and FR-15 composes the alpha at runtime. The preset data and the transparency layer stay separate exactly as Q9 decided — composition happens in FR-15's layer, not in the palette.

**Finding 4 — the terminal's alpha lives on the pane, not in the xterm theme (v2.2).** The obvious implementation is to hand `xterm.js` a translucent theme `background`. It does not work: **xterm 6.0.0 flattens a translucent theme background against black and paints the result opaque.** Measured with two terminals identical except for `allowTransparency`, over a striped backdrop — both rendered a uniform colour (stdev **0.00**, value exactly `alpha × background`), while the same backdrop measured stdev **127.49** where uncovered. `allowTransparency` made no difference in either direction; in xterm 6.0.0 it appears only as a default value and is never read, despite still being declared in the public typings.

The working shape, verified by the same measurement (stdev 127.49 — indistinguishable from the bare backdrop):

1. The xterm theme background is set **fully transparent** (`rgba(0, 0, 0, 0)`) so xterm paints nothing.
2. `.xterm`, `.xterm-viewport` and `.xterm-screen` are forced `background-color: transparent` — emptying the theme alone is not sufficient, because xterm still sets a background on its own elements.
3. The **pane element behind the terminal** paints the preset's colour at the scrim alpha. This is what keeps §4.5's theme presets legible as themselves: each preset still shows its own background colour, now translucent.

Do not "simplify" this back into the xterm theme. The one-step version is what shipped first, and it left terminal panes opaque while every other surface went translucent.

#### Light re-derivation (v2.5) — the worst-case wallpaper flips

§4.7's original floor (α=0.64) was computed against a pure **white** wallpaper because dark-mode chrome is light-text-on-dark-surface, and a white wallpaper showing through is the hardest case for that pairing. Light-mode chrome is the mirror image — dark-text-on-light-surface (`--graphite-900` on `--paper-200`) — so its hardest case is the opposite extreme: a pure **black** wallpaper, which pulls the composited background dark and erodes the exact contrast dark text depends on.

Composite `--paper-200` at alpha over `#000000`, checked against `--graphite-900` (primary) and `--graphite-600` (muted), the same method §4.7 used for dark mode:

| Wallpaper case | Alpha | Composited | `--graphite-900` | `--graphite-600` |
|---|---|---|---|---|
| Black (true worst case) | 0.55 | `#868688` | 4.98:1 ✅ | 1.82:1 ❌ |
| Light wallpaper (common case) | 0.55 | `#F4F4F4` | — | 6.02:1 ✅ |

`--window-scrim-alpha` in light mode is therefore `calc(1 - 0.45 * var(--window-transparency))` — 1.00 → 0.55, a *wider* usable range than dark mode's 1.00 → 0.64 (coefficient 0.45 vs 0.36). This is the opposite asymmetry from §4.6's glass re-derivation above, and for a different reason: FR-14's floor is set by how much a *translucent surface* gets pulled toward a backdrop it's blended with, while FR-15's floor is set by how much a wallpaper *shows through* a scrim at a given alpha — a black wallpaper's darkening effect on the light paper background saturates less aggressively, per unit of alpha, than the equivalent pull in the glass case. Do not assume the two coefficients should match, or "average" them — each is independently derived from its own worst case and composite chain.

**Primary text is guaranteed; secondary text is knowingly not** — same structure and same trade as dark mode (§4.7 above), not a new decision: the floor that would also protect `--graphite-600` on a black wallpaper is materially higher (less see-through), which would repeat the v2.0 imperceptibility mistake this design system has already corrected once. Mitigations are identical to dark mode's: `0` (fully opaque) is the default and always reachable; primary text and terminal output never drop below the guaranteed floor on any wallpaper; muted text is never the sole carrier of meaning (§7's colour-alone rule).

**The layering rule (§4.7's ownership table) is theme-independent** — it governs which surface paints a scrim for a given screen region, not what color that scrim is. No changes needed there for light mode; `--color-background-scrim`/`--color-surface-scrim` simply resolve to the light paper values and light `--window-scrim-alpha` under `:root[data-theme="light"]`, same ownership, same rule.

## 5. Layout rules

- **App shell (v2.8):** a full-width **Title Bar** (`--titlebar-height`, 36px, components.md Patterns) pinned to the top, replacing the native OS title bar (`decorations: false`, ADR-0013) — below it, fixed sidebar (260px, collapses to 56px icon rail below `--bp-sidebar-collapse`) + main content area (the split-pane grid alone, edge to edge — no tab bar as of v1.4). No page scroll at the app-shell level — only individual panels (sidebar list, modal body, terminal buffers) scroll internally.
- **Window drag/resize (v2.8, ADR-0013):** with native decorations off, the OS no longer supplies these for free. The Title Bar's own empty space is the drag region (`data-tauri-drag-region`); each of the window's four edges and four corners carries an invisible resize-handle region (`--pane-divider-hit-area`'s existing 6px invisible-hit-area convention is the right precedent to reuse here, not a new size) that calls the window's resize-drag command. Neither is optional — without them the window is immovable and fixed-size despite `resizable: true` in config.
- **No responsive grid system** — this is a single-window desktop app, not a multi-page responsive site. The only layout adaptation is the sidebar collapse rule above.
- **Density rule:** `--space-3` (12px) is the default padding for list rows and form field containers; `--space-6` (24px) separates distinct form sections/fields in the Add/Edit Project modal and the Settings panel's groups alike (see components.md Patterns).
- **Terminal area always wins the remaining space** — sidebar is fixed-width, the pane grid fills 100% of everything else, full height, below the Title Bar.

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
| **Window transparency (FR-15, v2.1)** — at the scrim floor α=0.64 over a WHITE wallpaper, the true worst case (§4.7) | | | |
| `--color-text` (#E4E7EC) | root scrim at α=0.64 over white wallpaper (`#646569`) | 4.70:1 | ✅ AA — primary text is guaranteed on any wallpaper |
| `--color-text-muted` (#8B92A3) | root scrim at α=0.64 over white wallpaper (`#646569`) | 1.87:1 | ⚠️ below AA — knowingly accepted (user decision), see §4.7 |
| `--color-text-muted` (#8B92A3) | root scrim at α=0.64 over a dark wallpaper (`#080A0D`) | 6.36:1 | ✅ AA — the common case |
| **Same surfaces against the pathological near-white backdrop** — accepted risk, §4.6 | | | |
| `--color-text` (#E4E7EC) | modal glass at α=0.40 (`#3F4147`) | 8.23:1 | ✅ AA/AAA — primary text never fails |
| `--color-text-muted` (#8B92A3) | modal glass at α=0.40 (`#3F4147`) | 3.27:1 | ⚠️ below AA — knowingly accepted, see §4.6 |
| `--color-text` (#E4E7EC) | menu glass at α=0.80 (`#494D54`) | 6.85:1 | ✅ AA/AAA — primary text never fails |
| `--color-text-muted` (#8B92A3) | menu glass at α=0.80 (`#494D54`) | 2.72:1 | ⚠️ below AA — knowingly accepted, see §4.6 |
| **Light theme (v2.5)** — `:root[data-theme="light"]`, see §4.1a | | | |
| `--color-text` (#14161B) | `--color-background` (#F3F4F7) | 16.46:1 | ✅ AA/AAA |
| `--color-text-muted` (#565D6B) | `--color-background` (#F3F4F7) | 6.02:1 | ✅ AA |
| `--color-text-muted` (#565D6B) | `--color-surface` (#F9FAFB) | 6.33:1 | ✅ AA |
| `--color-text` (#14161B) | `--color-surface-elevated` (#FFFFFF) | 18.10:1 | ✅ AA/AAA |
| `--color-primary` (#16741C, unchanged from dark) | `--color-background` (#F3F4F7) | 5.38:1 | ✅ AA (clears both the 3:1 UI-component threshold and 4.5:1 text — no light-specific token needed) |
| `--color-security` (#1B7C59) | `--color-background` (#F3F4F7) | 4.70:1 | ✅ AA |
| `--color-security` (#1B7C59) | `--color-security-bg-subtle` (#E3F5EE) | 4.56:1 | ✅ AA |
| `--color-danger` (#DB0A0A) | `--color-background` (#F3F4F7) | 4.70:1 | ✅ AA |
| `--color-danger` (#DB0A0A) | `--color-danger-bg-subtle` (#FEF1F1) | 4.70:1 | ✅ AA |
| `--color-warning` (#8D6703) | `--color-background` (#F3F4F7) | 4.70:1 | ✅ AA |
| `--paper-border-strong` (#7A8292) | `--color-background` (#F3F4F7) | 3.51:1 | ✅ AA (UI component, 3:1 threshold) |
| **Light glass surfaces (§4.6 Light re-derivation)** — at maximum intensity, over the realistic blurred backdrop `#56575A` | | | |
| `--color-text-muted` (#565D6B) | modal glass at α=0.85 (`#DEDEDF`) | 4.92:1 | ✅ AA |
| `--color-text-muted` (#565D6B) | menu glass at α=0.80 (`#DDDDDE`) | 4.87:1 | ✅ AA |
| **Light window transparency (§4.7 Light re-derivation)** — at the scrim floor α=0.55 over a BLACK wallpaper, the true worst case | | | |
| `--color-text` (#14161B) | root scrim at α=0.55 over black wallpaper (`#868688`) | 4.98:1 | ✅ AA — primary text guaranteed on any wallpaper |
| `--color-text-muted` (#565D6B) | root scrim at α=0.55 over black wallpaper (`#868688`) | 1.82:1 | ⚠️ below AA — knowingly accepted (same trade as dark mode), see §4.7 |
| `--color-text-muted` (#565D6B) | root scrim at α=0.55 over a light wallpaper (`#F4F4F4`) | 6.02:1 | ✅ AA — the common case |
| **Light glass, near-black pathological backdrop** — accepted risk, §4.6 | | | |
| `--color-text-muted` (#565D6B) | modal glass at α=0.85 (`#D9D9D9`) | 4.69:1 | ✅ AA — modal clears even this bound |
| `--color-text-muted` (#565D6B) | menu glass at α=0.80 (`#CCCCCC`) | 4.12:1 | ⚠️ below AA — knowingly accepted, see §4.6 |
| **App Default Light terminal preset (v2.6, §4.5a)** — ANSI accents on the preset's own `#F3F4F7` background. This preset alone is held to AA because we derive it; the third-party palettes (Solarized, GitHub, Dracula, Nord) ship verbatim and are deliberately not audited — see §4.5a | | | |
| `foreground` (#14161B) | preset background (#F3F4F7) | 16.46:1 | ✅ AA/AAA |
| `red` (#DB0A0A) | preset background (#F3F4F7) | 4.70:1 | ✅ AA |
| `green` (#16741C) | preset background (#F3F4F7) | 5.38:1 | ✅ AA |
| `yellow` (#8D6703) | preset background (#F3F4F7) | 4.69:1 | ✅ AA |
| `blue` (#1D63D2) | preset background (#F3F4F7) | 5.07:1 | ✅ AA — re-derived; the dark preset's #3B82F6 fails here at 3.34:1 |
| `magenta` (#8B3FD9) | preset background (#F3F4F7) | 5.01:1 | ✅ AA — re-derived; the dark preset's #C084FC fails here at 2.40:1 |
| `cyan` (#0E6E8C) | preset background (#F3F4F7) | 5.26:1 | ✅ AA — re-derived; the dark preset's #36B4E2 fails here at 2.17:1 |
| `brightBlack` (#565D6B) | preset background (#F3F4F7) | 6.02:1 | ✅ AA |
| `bright{Red,Green,Yellow,Blue,Magenta,Cyan}` | preset background (#F3F4F7) | 6.52–10.87:1 | ✅ AA/AAA — darker than their normal counterparts, the light-mode direction of "brighter" (§4.5a) |
| **Dark chrome + a manually-chosen light terminal preset (v2.6)** — accepted risk, bound unchanged, see §4.6's v2.6 re-examination | | | |
| `--color-text` (#E4E7EC) | modal glass α=0.40 over Solarized Light backdrop (`#36393C`) | 9.37:1 | ✅ AA/AAA — primary text never fails |
| `--color-text-muted` (#8B92A3) | modal glass α=0.40 over Solarized Light backdrop (`#36393C`) | 3.73:1 | ⚠️ below AA — knowingly accepted, inside the existing pathological envelope |
| `--color-text` (#E4E7EC) | menu glass α=0.80 over Solarized Light backdrop (`#404348`) | 8.01:1 | ✅ AA/AAA |
| `--color-text-muted` (#8B92A3) | menu glass α=0.80 over Solarized Light backdrop (`#404348`) | 3.19:1 | ⚠️ below AA — the worst reachable case; still above the accepted pathological bound of 2.72:1 |
| `--color-text-muted` (#8B92A3) | menu glass α=0.80 over GitHub Light backdrop (`#3C4047`) | 3.34:1 | ⚠️ below AA — knowingly accepted |
| **Light chrome + a light terminal preset** — the combination §4.5a's coupling makes the common one | | | |
| `--color-text-muted` (#565D6B) | modal glass α=0.85 over Solarized Light backdrop (`#E3E4E4`) | 5.19:1 | ✅ AA — better than the dark-preset case |
| `--color-text-muted` (#565D6B) | menu glass α=0.80 over Solarized Light backdrop (`#F5F6F4`) | 6.10:1 | ✅ AA |

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
- ❌ Don't enable glass on the sidebar or terminal panes "now that the window is transparent" → ✅ §4.7 Finding 3: `backdrop-filter` samples the page's own backdrop, and the wallpaper is composited by the window manager *outside* the document — it never enters that backdrop image. FR-14 and FR-15 stack alphas; neither feeds the other's blur
- ❌ Don't let a parent and child both paint the window scrim for the same region (v2.3) → ✅ exactly one surface owns it per pixel — check the ownership table in §4.7 before adding a scrim anywhere; two `0.64` layers compound to `0.87`, not `0.64` (this shipped as a real bug: the terminal pane rendered "deep black" instead of translucent)
- ❌ Don't assume a region needs no scrim because "something above it probably has one" → ✅ verify against §4.7's table; `TerminalArea`'s empty state needed its own scrim precisely because nothing else painted there once `body` correctly stopped
- ❌ Don't add an alpha to a §4.5 terminal preset to make the terminal see-through → ✅ presets keep storing opaque reference hexes (PRD Q9 still holds); FR-15 applies its scrim alpha when the `xterm.js` theme object is built at runtime
- ❌ Don't add glass/translucency to the sidebar or terminal-pane backgrounds → ✅ glass applies to Modal and Menu only (§4.6) — the other two sit on a flat backdrop where blur is provably a no-op; if a future layout floats the sidebar *over* the terminal area, that's a §5 layout change to decide first, and only then does sidebar glass become a real option
- ❌ Don't add an alpha or blur value to a §4.5 terminal theme preset → ✅ translucency lives exclusively in app-chrome tokens (§4.6 resolves Q9); the preset/token separation §4.5 defines is intact, and "consistency" is not a reason to cross it for an effect that is inert on the default preset
- ❌ Don't hand-write a per-surface alpha, or widen a range in `tokens.css` to make the effect "more visible" → ✅ set `--glass-intensity` only. The floors in those `calc()` expressions are contrast-verified in §7 against a stated backdrop model; widening one silently detaches it from that model. If the effect genuinely needs to go further, re-derive the model and record it (as v2.0 did when v1.9's floors proved imperceptible) — the rule is *derive and document*, not *never change*
- ❌ Don't raise `--glass-blur` and lower a floor in the same breath without re-checking → ✅ a larger blur radius makes the averaging model in §4.6 *more* accurate and the floors safer; a smaller one makes them riskier, because local bright regions survive averaging. Reducing the radius below 24px invalidates the current floors
- ❌ Don't ship `backdrop-filter: blur(0px)` at intensity 0 → ✅ omit the property entirely at 0 (§4.6) — a zero blur still pays the compositing cost, which NFR-9 exists to prevent
- ❌ Don't paint a surface's background on an inner wrapper when an outer element owns its padding/border → ✅ the element with the padding owns the background. Under FR-15's transparent window an unpainted box is not "one shade off", it is a hole straight through to the desktop — this is exactly how v2.3 left a see-through gutter inside every terminal pane's focus outline
- ❌ Don't render a message into always-visible chrome without an owned lifetime → ✅ anything in persistent chrome (the sidebar footer, a status bar) needs an auto-clear timer, a dismiss control, or both, and every write to it should go through the one helper that owns that lifetime. A raw assignment at each call site is how the sidebar's error banner became permanent
- ❌ Don't add a second confirmation modal/step on top of the master-password-change form → ✅ the three-field form (current, new, confirm) is itself the friction gate; a nested confirm dialog is ceremony this app's "perceived speed" principle doesn't want
- ❌ Don't assume a floor, alpha coefficient, or surface ordering computed for one theme transfers to the other (v2.5) → ✅ re-derive from the theme's own worst case every time — §4.6's light glass floors are far tighter than dark's, §4.7's light window floor is wider than dark's, and modal/menu even swap which one is more restrictive; "it's the same formula, just different colors" is exactly the assumption that produces a shipped contrast failure
- ❌ Don't reuse `--glass-edge`'s dark-theme rgba (`rgba(255,255,255,0.08)`) under `[data-theme="light"]` → ✅ light mode has its own `--glass-edge: rgba(0,0,0,0.08)` — a light-on-light rim is invisible; this is why it's declared inside the light override block, not left to inherit
- ❌ Don't give `--color-backdrop` a light-mode override "for consistency with the theme" → ✅ it's deliberately unchanged in both themes (§4.1a) — a modal scrim recedes the app regardless of chrome color; making it light would defeat the purpose of a scrim
- ❌ Don't add a raw `@media (prefers-color-scheme: light)` block to `tokens.css` to implement "System" → ✅ theme resolution (including live OS-change tracking) is JS's job; CSS only ever reads the `data-theme` attribute the frontend sets (§4.1a, §9) — a parallel media-query path would let CSS and JS disagree about which theme is active
- ❌ Don't persist `"app-default-light"` as a distinct preset id (v2.6) → ✅ the stored id stays `"app-default"` in both themes and the frontend picks the variant at render time (§4.5a); a theme-dependent stored id breaks the round-trip the moment the user switches chrome themes, and violates ADR-0009's "the backend only ever persists an id" model
- ❌ Don't make Dracula, Nord, Solarized Dark/Light, or GitHub Light follow the chrome theme "for consistency with App Default" (v2.6) → ✅ App Default follows because it is *defined* as "derived from the app's own tokens" (§4.5a); the named palettes are chosen by name, and silently swapping Dracula for something else when the theme flips would be selecting a palette the user never picked
- ❌ Don't "fix" the contrast of Solarized Light, GitHub Light, Dracula, or Nord to make them pass AA → ✅ third-party reference palettes ship verbatim (§4.5a); their recognizability is the feature, and an altered Dracula is not Dracula. Only App Default (ours) is held to §7's bar
- ❌ Don't tighten the FR-14 glass floors because a light terminal preset can now sit under dark chrome (v2.6) → ✅ that combination is a documented accepted risk whose bound did not move (§4.6's v2.6 re-examination); holding it at AA needs a 0.94 menu floor = 76/765 see-through, re-creating exactly the imperceptibility v2.0 was written to fix. The escape hatches are `--glass-intensity: 0` and light chrome
- ❌ Don't assume App Default Light's background is interchangeable with any other light hex → ✅ it must equal light-mode `--color-background` (`#F3F4F7`); that identity is what keeps §4.6's Finding 2 (translucency is inert on the default preset) true in light mode, and breaking it silently resurrects a setting that visibly does nothing

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
9. **Terminal theme preset colors (§4.5) are not tokens** — implement them as the frontend-only data module architecture.md ADR-0009 specifies (`src/lib/theme-presets.ts`), not as additions to `tokens.css`/`tokens.json`. Rule 2's "never invent values" still applies to app-chrome colors; it does not extend to these — §4.5's tables are themselves the source of truth for them.
10. **App-chrome theme (§4.1a, v2.5) is driven by a `data-theme="dark"|"light"` attribute on `<html>`, set by frontend JS — never by a CSS media query.** The settings store resolves the user's Dark/Light/System preference to a concrete value (System reads `matchMedia('(prefers-color-scheme: light)')` and subscribes to its `change` event) and writes the attribute before first paint. Components never branch on theme in component logic or markup — they reference the same semantic tokens (`--color-background`, `--color-text`, etc.) in both themes, and `tokens.css`'s override block does the substitution. If you find yourself writing `if (theme === 'light')` in a component, stop — that almost certainly means a needed token doesn't exist yet; propose it instead (Rule 2).
11. **App Default is the one theme-aware preset (§4.5a, v2.6).** It has two variants (dark/light) selected by the resolved `data-theme` from Rule 10; every other preset is fixed regardless of chrome theme. Two invariants an implementation must preserve: the **persisted id stays `"app-default"`** for both variants (never a second id — ADR-0009 stores an id, and a theme-dependent id breaks the round-trip), and **App Default's background must equal the active `--color-background`** (`#0D0F14` dark / `#F3F4F7` light), which is what keeps §4.6's Finding 2 true. Resolve the variant where the `xterm.js` theme object is built, next to where FR-15's scrim alpha is already composed (§4.7 Finding 4) — not by mutating the preset data.

## 10. Changelog

| Version | Date | Change |
|---|---|---|
| 2.9 | 2026-07-29 | EVOLVE per direct product request (no PRD FR yet): Sidebar show/hide toggle's icon (Title Bar, components.md) changed from the hamburger (☰) to a sidebar-panel glyph, and made state-dependent again — outline "collapse" style when shown, filled "expand" style when hidden. This narrows, but doesn't reverse, v1.7's rationale for going state-independent: v1.7 was specifically about avoiding a *directional* swap tied to `settingsStore.sidebarPosition`; this icon still carries no left/right orientation in either variant, so it stays position-agnostic exactly as the hamburger did — only the icon's outline/filled style changes with state, not its direction. First inline-SVG icon in the app (every other icon to date is a text/emoji glyph — ⚙, ✕, ⋮, ▾, ▸); both variants normalized to `currentColor` (the source assets specified a hardcoded gray stroke) so `.btn-ghost`'s existing hover/color rule applies with no extra styling, and sized 16×16 (viewBox 24×24) with stroke-width bumped 1 → 1.5 for legibility at that display size. No new tokens; components.md's Sidebar show/hide toggle section and Title Bar Anatomy §2 updated to match. |
| 2.8 | 2026-07-29 | EVOLVE per direct product request (no PRD FR yet), following ADR-0013 (native window decorations replaced by custom in-app controls): new **Title Bar** pattern (components.md) — full window width, `--titlebar-height` (36px, revived from the orphaned `--tab-height`, unused since v1.3), three zones: left (⚙ Settings, + Add project — relocated from the sidebar footer), center (search + ☰ sidebar-toggle — relocated from the sidebar header, same pairing/behavior), right (minimize/maximize-restore/close, always right-anchored regardless of `settingsStore.sidebarPosition`). Close button gets one scoped hover override (danger red) rather than a fifth `Button` variant. §5 gains the Title Bar in the app-shell description and a new window drag/resize rule — the Title Bar's empty space is the drag region, and each window edge/corner needs an invisible resize-handle region, reusing `--pane-divider-hit-area`'s existing 6px-invisible-hit-area precedent rather than a new token; neither is optional once native decorations are off (ADR-0013). **Sidebar** (components.md) is now list-only — header and footer both emptied into the Title Bar and Settings Panel. **Sidebar show/hide toggle** loses its floating-corner trigger (the third of three): now redundant since its remaining Title Bar trigger is reachable regardless of hidden/shown state, unlike the removed trigger's old home *inside* the sidebar it was meant to reveal; `+page.svelte`'s `reveal-sidebar-wrap` is dead code to delete. **Settings Panel** gains a sixth group, **Data** (FR-07 export/import, ADR-0008) — same Export/Import buttons, same success-flash/error-banner lifecycle as the sidebar footer's v2.4-established rule, carried over verbatim except scoped to reset on modal close rather than persisting in always-visible chrome. No color/typography/accessibility-standard changes — this is a layout/chrome relocation, not a new visual direction. **Code-review fix round (same day):** the drag region used bare `data-tauri-drag-region` — verified against Tauri's actual injected script that bare mode only matches when the attributed element itself is the click target, silently missing empty space *inside* a zone (between ⚙ and "+ Add project", say); switched to `="deep"`, which matches any non-clickable descendant while still correctly excluding Button/`input`. A custom `dblclick` handler for maximize/restore was removed entirely — the same native script already invokes toggle-maximize on any double-click landing in a valid drag region, so the custom handler was firing a second, redundant toggle that canceled the first out. Behavior/Do-Don't above updated to match. |
| 2.7 | 2026-07-23 | EVOLVE per architecture.md v1.8 (keybinding registry extended to `sidebar.toggle`, Ctrl+B) — no new visual spec, same "behavioral only" precedent as v1.7's zoom/tab-cycling additions and the original Ctrl+Shift+C/V clipboard shortcuts. The existing "Sidebar show/hide toggle" pattern (v1.4, hamburger ☰ icon since v1.7) gains a keyboard trigger for its already-implemented `appStore.toggleSidebar()`; the button remains the only visual affordance. No new tokens, no visual direction change. |
| 2.6 | 2026-07-23 | EVOLVE + DRIFT FIX — added light terminal presets (§4.5a), reversing v1.6's "a light terminal preset is an explicit non-goal." **The drift this fixes matters as much as the feature:** §4.5 justified dark-only presets by "extending the app's dark-only stance (§1, §3)" — a premise **v2.5 deleted** when it gave chrome a light theme, leaving §4.5 standing on a rule that no longer existed. Three further sites asserted "every shipped terminal preset is dark" as load-bearing argument (§4.1a, and both of §4.6's accepted-risk bounds); all were re-examined rather than reworded. New presets: **Solarized Light** and **GitHub Light** (upstream palettes, verbatim) plus an **App Default Light** variant derived from §4.1a's light tokens — its `blue`/`magenta`/`cyan` had to be re-derived (`#1D63D2`/`#8B3FD9`/`#0E6E8C`) because the dark preset's fail AA on a light background (3.34/2.40/2.17), and its `bright*` row is *darker* than normal, the light-mode direction of "brighter." **The coupling rule (§4.5a) is the load-bearing decision:** App Default follows the chrome theme — not new coupling, but honoring its existing definition as "derived from §4.1's tokens," which v2.5 made two-valued — while every named palette stays a fixed manual choice. **This choice is what preserved §4.6's contrast math.** Re-derived the blurred backdrop per preset: dark presets average `#4D5055`–`#274A53` (at or under the existing `#56575A` model), light ones `#B0B1B5`–`#CFD1C6`. The dangerous combination is dark chrome + a light preset, where muted text falls to 3.19–3.89:1. Floors deliberately **unchanged**, for three computed reasons: the bound didn't move (every value sits inside the already-accepted pathological envelope of 3.27/2.72, and primary text stays ≥8.01:1); the coupling keeps "the user actively chose something unusual" true, which full independence would have invalidated; and holding AA there needs a 0.94 menu floor = 76/765 see-through, re-creating precisely the imperceptibility v2.0 was written to correct. Light chrome + light preset measures *better* than today (5.19–6.10:1). §4.6's Finding 2 survives on its real identity ("App Default's background equals the active `--color-background`") rather than a hex. §4.7/FR-15 untouched — its floors depend on the wallpaper, never on preset colors. Six new §8 rules and a new §9 rule 11 guard this area (theme-dependent preset ids, coupling the named palettes, "fixing" third-party palette contrast, tightening the glass floors). No token changes: presets have never been tokens, and this pass did not make them one. |
| 2.5 | 2026-07-23 | EVOLVE — added light theme, reversing the v1.0–v2.4 "dark-only for MVP" decision (§1). New §4.1a documents the mechanism (`data-theme` attribute, resolved by frontend JS from a Dark/Light/System preference — never a CSS media query) and the systematic-inversion rule: every role, hue, and relationship from §3 is preserved, only the neutral ramp (`--paper-*`/`--graphite-*`, replacing `--ink-*`/`--white-*`) and three accent shades (security, warning, danger — re-derived darker to clear AA on a light background) actually change. `--color-primary`/`--color-focus` needed **no** light-specific value — `#16741C` already clears 5.38:1+ against every light surface. Re-derived FR-14 (§4.6) and FR-15 (§4.7) for light mode rather than assuming the dark floors' shape transfers, and both re-derivations surfaced genuine, non-obvious asymmetries: light glass floors are far *tighter* than dark's (a light surface darkens as it goes more see-through over dark terminal content — the opposite dynamic from dark mode) and modal/menu even swap which one is more restrictive; light window-transparency's floor is *wider* than dark's (0.55 vs 0.64), because the black-wallpaper-on-light-paper composite chain saturates less aggressively per unit of alpha than the white-wallpaper-on-dark-ink chain does. Both re-derivations keep the same accepted-risk structure as their dark-mode originals (primary text guaranteed, muted text knowingly not, at the true worst-case bound). New Settings Panel group "Appearance" (components.md) — a three-option `Segmented Control` (Dark/Light/System), the first real 3-option instance of that component. Terminal theme presets (§4.5) are explicitly unaffected — they stay dark-only, by design, independent of this app-chrome switch. Seven new §8 rules guard the mistakes this area invites (assuming a floor transfers between themes, reusing the wrong-theme `--glass-edge`, giving `--color-backdrop` a light override, implementing "System" via `@media` instead of the JS-set attribute). |
| 1.0 | 2026-07-17 | Initial design system: brief, "Warp Modern" direction, full token set (verified contrast), 8 core components + 4 patterns. |
| 1.1 | 2026-07-18 | EVOLVE: added Tab drag-to-split interaction — new `dragging` Tab state, Split Pane Container drop-zone system (4-triangle targeting, no center zone — this app has no per-pane tab strips, unlike VS Code), new `--color-primary-bg-subtle` token, new "Tab drag-to-split" pattern. No visual direction change. |
| 1.2 | 2026-07-19 | EVOLVE per PRD v1.3: left-click on a sidebar project now switches to its existing tab instead of always duplicating; new "Menu" component (overflow + right-click context variant, identical content, keeps "Open in new tab" keyboard-reachable) replaces the old inline overflow-menu description in Sidebar Project List Item; new `open`/`active` left-edge bar states replace the unimplemented "opened once" dot-color idea from v1.0. No new tokens, no visual direction change. |
| 1.3 | 2026-07-19 | EVOLVE per PRD v1.4: horizontal tab bar removed entirely — sidebar is now the sole entry point for opening, switching, closing, and drag-sourcing terminal sessions. `Tab` component spec marked REMOVED (see its stub in components.md for rationale). Sidebar Project List Item gains a three-mode model by open-session count (0 / 1 / 2+), with 2+ auto-expanding into a new "Sidebar Session Sub-item" component — no manual expand/collapse toggle. Menu gains a conditional "Close terminal" item (exactly-1-session case only). Split Pane Container's pane header is now always rendered (previously gated by `multiPane`) since it is the only remaining "which project/session" indicator with no tab label to fall back on. Signature gradient reduced from **two** places to **one** (the unlock screen only) — deliberately not relocated to the sidebar (§2, §3, §4.1, §8 updated). `--tab-height` token is now orphaned (kept defined, unused) since its only consumer is removed. No new tokens, no visual direction change. |
| 1.4 | 2026-07-20 | EVOLVE per direct product decision (no PRD FR yet): Sidebar Project List Item's status dot is repurposed from path-validity to **has-open-session** (project-scope, independent of which tab is currently active) — this deliberately revives the dot-color idea v1.2's changelog notes was dropped in favor of the left-edge bar, now at the owner's explicit request; the two signals remain visually distinct (dot = "anything open here", bar = "this is the one on screen"). Path validity moves to text color only (`--color-text-muted` when invalid, `--color-text` when valid) and the path itself moves from an always-visible second line to a hover/focus-revealed tooltip (first real use of the previously-reserved `--z-tooltip` token) — Principle 5 updated to reflect that the pane header, not the sidebar row, is now the persistently-visible path location. New "Sidebar show/hide toggle" pattern: a manual, fully-implemented full-hide control, deliberately on a separate axis from the breakpoint icon-rail collapse described in components.md's Sidebar layout — code-review turned up that the icon-rail collapse itself was never actually implemented (token defined, nothing reads it), so components.md now marks it ❌ rather than implying it's a working baseline; the two are meant to compose independently whenever it does get built. New feature: Ctrl+Shift+C/V clipboard shortcuts in the terminal pane (no dedicated visual spec — behavioral only, xterm.js key-handler level). No new tokens beyond activating `--z-tooltip`; no visual direction change. |
| 1.5 | 2026-07-20 | EVOLVE per direct product decision (owner: replace purple with green): primary color changed from violet to green. Primitives `--violet-500/600/700/800` and `--pink-500` replaced by `--green-500/600/700/800` and `--cyan-500`; every semantic token that referenced them (`--color-primary`, `-hover`, `-active`, `--color-accent-gradient`, `--color-focus`, `--color-primary-bg-subtle`, `--shadow-glow-primary`) was re-derived from the new primitives, not hand-edited independently. New shades were computed (not eyeballed) to land on the same contrast ratios as before: `--color-primary` on white ≈5.9:1 (was 6.0:1), hover ≈8.0:1 (unchanged), primary-vs-background (focus/UI-component threshold) 3.2:1 (unchanged) — see §7. Because `--color-security` (emerald, ~158° hue) and the new primary (grass green, ~124° hue) are now both "green," picked the new primary's hue deliberately ~34° away plus a darker/less-saturated value so the two stay visually distinguishable side by side; §3 and §8 spell out that this separation is a backstop, not a replacement for the lock-icon pairing rule (Principle 3). Signature gradient becomes green→cyan ("aurora"), replacing violet→pink; both new stops individually fail text contrast same as before, so the decorative-only rule (Principle 2, §7) still applies unchanged. No component behavior, layout, or non-color token changed. |
| 1.8 | 2026-07-21 | EVOLVE per PRD v1.6 (FR-11, promoted to MVP): new `Sidebar Folder` component (components.md) — flat, drag-and-drop-managed project categorization, distinct from and composable with the existing session-count "grouped" display mode. Resolves PRD Q7 (reorder-vs-merge drop-zone distinction): each row's height splits into a three-band drop target (top/bottom ~25% = reorder-position insertion line, middle ~50% = merge-into full-row highlight), reusing `Split Pane Container`'s exact `--color-primary-bg-subtle`/`--color-primary` drop-zone token pairing rather than inventing a second vocabulary — reorder vs. merge is distinguished by geometry, not color, satisfying the color-alone accessibility rule for free. `Sidebar Project List Item` and the "Sidebar layout"/"Sidebar drag-to-split" pattern notes updated to reflect folders as an interleaved, equally-orderable top-level entry alongside ungrouped projects. No new tokens — every value is a reuse of existing color/spacing/motion tokens. Flagged, not resolved here: folder drag-drop currently has no keyboard-accessible equivalent (⚠️ TBD in components.md, owner: backend-implementer/design-implementer before build); a `grouped`-mode (2+ session) project row deliberately stays non-draggable for folder purposes too, uniform with its existing drag-to-split restriction, accepted as a known limitation rather than a conditional rule. |
| 1.6 | 2026-07-20 | EVOLVE per FR-13 (Settings Panel), architecture.md v1.1/ADR-0009/ADR-0010: added §4.5 Terminal theme presets (App Default + Dracula, Nord, Solarized Dark — a separate frontend-only palette system, not app-chrome tokens; resolves PRD Q6). New components (components.md): Theme Preset Card, Keybinding Row (+ its `recording`/conflict states), Segmented Control (2-option toggle, used for sidebar position). New pattern: Settings Panel (Modal, `form` variant, reused as-is — no new modal size needed since the theme picker uses a 2-column grid rather than forcing all 4 cards onto one row). Settings Panel deliberately deviates from Modal's "one primary button in the footer" default: everything except master-password-change autosaves per-control (same philosophy as the existing Notes/Textarea autosave precedent), so the footer holds only a dismiss action; master password change keeps its own scoped primary button ("Change password") since it's the one real submit-style action in the panel. Added keybinding safety rule (§8): captured combos must include Ctrl/Alt/Cmd, rejected otherwise — protects normal terminal typing from an accidental bare-key binding. No new design tokens required — everything composes from the existing token set. Fixed a stale HANDOFF.md reference to the gradient rule ("two places" → "one place," matching v1.3/v1.4's actual current state). |
| 2.4 | 2026-07-23 | BUG FIX + EVOLVE, from a user bug report. **Fix (§4.7):** the FR-15 v2.2/v2.3 work moved the terminal background onto an inner element, but `.pane` is what carries the padding and focus border — so the padding band between the outline and the terminal content was painted by nothing and read as a see-through gutter to the desktop. The alpha now sits on the padded element itself. Generalized into a new §8 rule: **whatever element owns a surface's padding/border must own its background** — under a transparent window an unpainted box is a hole, not merely a different shade. **Fix (Sidebar pattern):** the footer's error text had no lifetime and no dismiss control, so one transient failure left a permanent red line under Export/Import. Errors now auto-clear after 8s (longer than the 3s success flash — an error carries a reason that has to be read) and carry a ✕. Rule added: anything rendered into always-visible chrome needs an owned lifetime or a dismiss affordance. **EVOLVE (components.md):** `Sidebar Folder` rename moves from left-click to **right-click**, freeing left-click on the name to do what the rest of the header does (expand/collapse), with `F2` as the keyboard path; `Sidebar Project List Item` gains an inline ✕ in its exactly-1-session mode, matching the affordance `Sidebar Session Sub-item` already had. No token changes in this version. |
| 2.3 | 2026-07-22 | BUG FIX — §4.7's v2.1 layering rule ("surfaces stack additively... bounding the root bounds everything above it") was wrong and caused a real bug: `body` painted the root scrim across the whole viewport, and `TerminalPane` painted its own scrim on top for the pane region, compounding `0.64` + `0.64` to `0.87` — the terminal area rendered as the *most* opaque surface in the app instead of the most see-through. Corrected the rule to **exactly one surface owns the scrim per pixel** and enumerated the ownership per region (table in §4.7): Sidebar and TerminalPane keep their existing single-layer scrim unchanged; `body`/`html` now paint none, since layout coverage (§5) means they're never visible once unlocked; `TerminalArea`'s `.empty-state` gains its own scrim (new — components.md updated) since it's the actual owner when no pane is open and nothing else paints there; `UnlockScreen` switches from plain `--color-background` to `--color-background-scrim`, fixing a second bug where it never respected `--window-transparency` at all, contradicting FR-15's own edge case (NFR-8). Two new §8 rules guard against reintroducing double-scrim. No token values changed — this is a layering/ownership fix, not a floor re-derivation. |
| 2.2 | 2026-07-22 | BUG FIX — FR-15 left terminal panes opaque while every other surface went translucent. Added §4.7 Finding 4: **xterm 6.0.0 flattens a translucent theme background against black and paints it opaque**, so the scrim alpha cannot live in the xterm theme. Measured with two terminals differing only in `allowTransparency` over a striped backdrop: both stdev 0.00 (uniform, opaque), backdrop stdev 127.49. `allowTransparency` is inert in 6.0.0 — present only as a default value, never read, though still in the public typings. Fix: empty the xterm theme background, force `.xterm`/`.xterm-viewport`/`.xterm-screen` transparent in CSS, and paint the preset colour at the scrim alpha on the pane element behind — verified at stdev 127.49, indistinguishable from the bare backdrop. §4.5 presets remain opaque reference palettes (Q9 unaffected); each still renders its own colour, now translucent. |
| 2.1 | 2026-07-22 | EVOLVE per PRD v1.8.1 (FR-15, Native Transparent Window) + ADR-0012. Added §4.7 and a window-transparency token group (`--window-transparency`, `--window-scrim-alpha`, `--color-background-scrim`, `--color-surface-scrim`). **Resolves PRD Q11** — a wallpaper cannot be measured, but it *is* bounded, so the worst case is computable: a pure white wallpaper, which for light-text-on-dark-surface is the hardest backdrop. Unlike §4.6's discarded white-screen model this one is genuinely reachable, because nothing blurs or averages a wallpaper. Scrim floor set at α=0.64, where `--color-text` holds 4.70:1 over white. `--color-text-muted` does **not** (1.87:1) and that is a knowingly accepted trade taken by the user with the alternative on the table: the floor protecting muted text too is α=0.90, a 10% see-through that would repeat exactly the imperceptibility mistake v2.0 was written to fix. Added a layering rule — surfaces stack additively (sidebar 0.64 over root 0.64 = 0.87 total), so bounding the root bounds everything above it, and no surface may take an alpha below the root's. **Resolves PRD Q12, opposite to the intuitive answer:** a transparent window does *not* resurrect sidebar/terminal-pane glass. `backdrop-filter` samples the page's own backdrop, and the wallpaper is composited by the window manager *outside* the document — the same reason blur-behind-the-window is impossible on Linux. §4.6's Findings 1 and 2 therefore stand, now on grounds that no longer depend on the window being opaque. PRD Q9 also holds: §4.5 presets keep storing opaque hexes and FR-15 composes its alpha at runtime, so the palette/transparency separation is preserved. *(The mechanism stated here — applying the alpha inside the `xterm.js` theme — was **wrong** and is superseded by v2.2/§4.7 Finding 4: xterm flattens a translucent theme background against black and paints it opaque. Left in place as the historical record of what v2.1 decided; do not implement from this line.)* Four new §8 rules guard the mistakes this area invites. |
| 2.0 | 2026-07-22 | EVOLVE — re-derivation of FR-14's intensity range after real-app feedback that the shipped v1.9 effect was imperceptible. **The v1.9 floors were arithmetically correct but built on the wrong model:** they were derived against a 100%-white backdrop, when `backdrop-filter: blur()` *averages* a region rather than sampling its brightest pixel. A terminal densely filled with white glyphs averages `#56575A`, not `#FFFFFF`, so v1.9 was designing against a backdrop the blur can essentially never produce — over a normal dark terminal a modal moved only `#1C2029` → `#191D25`, a delta of 10/765. Floors re-derived against that realistic backdrop: modal `0.80 → 0.40`, menu `0.95 → 0.80`, raising measured see-through from 43→130/765 and ~36→143/765 respectively. `--glass-blur` raised 12px → 24px as *part of the argument*, not decoration: ~8–16px glyphs dissolve into the local mean under a 24px kernel, which is what makes the averaging model true — a larger radius makes the floors safer, never riskier (new §8 rule forbids lowering it below 24px without re-deriving). Added `--glass-edge` (decorative lit rim; a border, never under text). Documented an **accepted risk** rather than hiding it: a contiguous near-white region larger than the blur kernel (light-themed TUI, bright image, wide selection highlight) survives averaging and drops `--color-text-muted` to 3.27:1 (modal) / 2.72:1 (menu) at maximum intensity. Bounded by three facts — primary `--color-text` never drops below 6.85:1 so nothing becomes unreadable, all shipped presets are dark (§4.5), and intensity 0 is always reachable. §8's "don't widen the ranges" rule reworded from *never change* to *derive and document*, since this version is exactly the legitimate case it should permit. |
| 1.9 | 2026-07-22 | EVOLVE per PRD v1.7 (FR-14, Glassmorphic Surfaces): added §4.6 and a glass token group (`--glass-intensity`, per-surface alpha/blur derivations, `--color-surface-elevated-glass`, `--color-menu-glass`); Modal and Menu each gain a glass state in components.md. **Scope was cut from four surfaces to two during design, on measurement:** the sidebar is a flex sibling of the terminal area (§5), so nothing but flat `--color-background` sits behind it and `backdrop-filter` over a uniform color is a no-op; terminal-pane translucency is mathematically inert on the App Default preset, whose background *is* `--color-background` (identical composite at every alpha). That second fact resolves **PRD Q9** on evidence: translucency lives exclusively in app-chrome tokens and §4.5's terminal presets stay opaque — the §4.5 boundary is preserved, not crossed. **PRD Q10** is resolved structurally rather than by guidance: one `--glass-intensity` (0..1, default 0) feeds per-surface `calc()` ranges whose floors are contrast-verified in §7 (modal 1.00→0.80, menu 1.00→0.95), so no reachable slider position fails AA. Menus get the far tighter range because, unlike modals, they float directly over live terminal output with no `--color-backdrop` beneath — worst-case muted text over white output fails AA below α=0.95 (computed, §4.6 Finding 3), and blur does not rescue it since blur preserves average luminance. New §8 rules forbid extending glass to sidebar/panes, adding alpha to a theme preset, widening the token ranges by hand, and emitting `blur(0px)` at intensity 0 (NFR-9 — a zero blur still pays the compositing cost, which matters more here because ADR-0006 already removed the WebGL renderer's headroom). |
| 1.7 | 2026-07-20 | EVOLVE per architecture.md v1.3 (keybinding registry extended to zoom + tab-cycling actions, no new visual spec needed for those — behavioral only, same as the original Ctrl+Shift+C/V clipboard shortcuts precedent, FR-13 v1.4). Sidebar show/hide toggle's icon changed from direction-flipping ◀/▶ (which had to swap based on `settingsStore.sidebarPosition`) to a single consistent hamburger (☰) in both hidden/shown states and both sidebar positions — simpler, no swap logic needed, standard convention for a sidebar/menu toggle. No new tokens, no visual direction change. |
