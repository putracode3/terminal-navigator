# Component Specifications — Terminal Navigator

> Companion to `design.md`. All values below are token references from `tokens.css` — never hardcode a raw hex/px value when implementing these. If a value has no token, stop and propose a token addition rather than inventing one.

---

## Button

**Purpose:** Triggers a single explicit action (add project, save, unlock, confirm/cancel in dialogs).
**Use instead:** For navigation between existing views, prefer a plain link-style control if one exists; Button is for actions, not navigation.

### Anatomy
1. Container — the clickable surface
2. Icon (optional) — leading, `--space-2` gap to label
3. Label — text

### Variants
| Variant | When to use | Key differences |
|---|---|---|
| primary | The single main action of a view/dialog (e.g. "Unlock", "Save project") | bg `--color-primary`, text `--color-on-primary` |
| secondary | Supporting actions (e.g. "Cancel") | bg transparent, border `--color-border-strong`, text `--color-text` |
| ghost | Low-emphasis actions inside dense UI (e.g. toolbar icons, "+ Add" in sidebar) | bg transparent, no border, text `--color-text-muted`, bg turns `--color-surface-elevated` on hover |
| danger | Destructive actions (e.g. "Delete project") | bg transparent, border `--color-danger`, text `--color-danger`; on hover bg `--color-danger-bg-subtle` |

### Sizes
| Size | Height | Padding-x | Font |
|---|---|---|---|
| md (default) | `--control-height-md` (32px) | `--space-3` | `--text-sm` / `--weight-medium` |
| sm | `--control-height-sm` (24px) | `--space-2` | `--text-xs` / `--weight-medium` |
| icon-only | `--control-height-md` (32px, square) | `--space-0` (centered icon) | — |

### States
| State | Visual change |
|---|---|
| default | as specified per variant |
| hover | primary → bg `--color-primary-hover`; secondary/ghost → bg `--color-surface-elevated`; danger → bg `--color-danger-bg-subtle` |
| focus-visible | outline 2px `--color-focus`, offset 2px, `--radius-sm` matched to button radius |
| active (pressed) | primary → bg `--color-primary-active`; others → same as hover, translateY(1px) |
| disabled | opacity 0.4; cursor not-allowed; not focusable; no hover/active transitions |
| loading | label replaced by a small spinner (border-based, uses `--color-on-primary` or `--color-text` depending on variant); button width locked to its resting width to prevent layout shift; not clickable |

### Behavior
- Click fires the action; loading state begins immediately on click if the action is async (e.g. unlocking, saving to the encrypted file), so the user always gets instant feedback (NFR-7 — perceived speed matters as much as actual speed).
- Background/border color transitions use `--duration-fast` with `--ease-out`.

### Accessibility
- Renders as a native `<button>` (or platform equivalent) — never a `<div>` with a click handler.
- Keyboard: `Enter` / `Space` activates.
- `disabled` buttons are removed from tab order; `loading` buttons stay in tab order but ignore activation.
- Icon-only buttons require an accessible label (`aria-label` or platform equivalent).

### Do / Don't
- ✅ Do: use exactly one `primary` button per view/dialog — it is the one action a user should default to.
- ❌ Don't: put the gradient (`--color-accent-gradient`) as a button's solid fill — it fails text contrast at the pink end (see design.md §7). Gradient is decorative-only.
- ❌ Don't: use `danger` variant for anything that isn't destructive/irreversible (e.g. don't use it for "Cancel").

---

## Input (text field, incl. Path field variant)

**Purpose:** Single-line text entry — project name, manual path entry, master password, setup commands.
**Use instead:** For multi-line content (notes), use Textarea.

### Anatomy
1. Label — above the field, always visible (never placeholder-only)
2. Container — the field itself
3. Leading icon/affix (optional) — e.g. lock icon for password fields
4. Text content
5. Trailing affix (optional) — e.g. "Browse…" button for the Path variant
6. Help/error text — below the field

### Variants
| Variant | When to use | Key differences |
|---|---|---|
| default | Free text (name, commands) | as anatomy above, no affixes |
| path | Project path entry (FR-02) | trailing affix is a `Button` (secondary, sm, label "Browse…") that opens the native OS folder picker and fills the field; field itself stays editable for manual entry |
| password | Master password (unlock screen) | leading lock icon `--color-text-muted`; text content masked; trailing affix is a ghost icon-button toggling mask/reveal |

### Sizes
| Size | Height | Padding-x | Font |
|---|---|---|---|
| md (default) | `--control-height-md` (32px) | `--space-3` | `--text-sm` |

### States
| State | Visual change |
|---|---|
| default | bg `--color-surface`, border 1px `--color-border-strong`, text `--color-text` |
| hover | border color unchanged; cursor text |
| focus-visible | border 1px `--color-primary`; outer glow `0 0 0 2px` at 20% opacity of `--color-primary` (approximate via a dedicated focus-ring, not `--shadow-glow-primary` which is reserved for the unlock screen's ambient glow) |
| filled | same as default, distinguished only by content presence — no separate visual treatment needed |
| disabled | opacity 0.5; bg `--color-surface`; cursor not-allowed |
| error | border 1px `--color-danger`; help text area shows the error message in `--color-danger`, `--text-xs` |

### Behavior
- The `path` variant validates on blur: if the typed/selected path does not exist, it immediately enters `error` state with message "This path doesn't exist" (FR-02 acceptance criteria).
- The `password` variant submits on `Enter` (equivalent to clicking the primary Unlock button).

### Accessibility
- Label is a real `<label>` (or platform equivalent) programmatically associated with the field — never a floating text block.
- Error text is associated via `aria-describedby` (or platform equivalent) and announced when it appears.
- Password reveal toggle has an accessible label that changes with state ("Show password" / "Hide password").

### Do / Don't
- ✅ Do: keep the label visible at all times — this app stores sensitive data, and placeholder-only labels that disappear on focus create ambiguity users can't afford here.
- ❌ Don't: validate the `path` field on every keystroke — validate on blur/submit only, so the user isn't shown an error while still mid-typing (matches FR-02: validate before save, not while typing).

---

## Textarea (Notes)

**Purpose:** Multi-line free text — per-project notes (FR-05), setup command lists when more than one command.
**Use instead:** Single-line values (name, single path) use Input.

### Anatomy
1. Label
2. Container — resizable text area
3. Security indicator — small inline `Security Badge` (see below) pinned top-right of the container, communicating "these notes are encrypted at rest"
4. Autosave status text — below the field (e.g. "Saved" / "Saving…")

### Variants
| Variant | When to use |
|---|---|
| default | Standard notes editing |

### Sizes
| Size | Min-height | Padding | Font |
|---|---|---|---|
| md (default) | 6 lines (~`--space-16` × 2.5) | `--space-3` | `--text-sm` / `--font-family-sans`; use `--font-family-mono` only if the note content is a command snippet the user explicitly formats as code |

### States
| State | Visual change |
|---|---|
| default | bg `--color-surface`, border 1px `--color-border-strong`, text `--color-text` |
| focus-visible | border 1px `--color-primary`, same focus ring as Input |
| saving | autosave status text reads "Saving…" in `--color-text-muted` |
| saved | autosave status text reads "Saved" in `--color-text-muted`, fades out after 2s |
| disabled | opacity 0.5, cursor not-allowed (used only while the app is locked/unlocking) |

### Behavior
- Autosaves on blur and on a debounce (~1s of inactivity) — never requires an explicit "Save" click for notes, since FR-05 treats notes as always-persisted state, not a form to submit.
- Vertically resizable by the user (drag handle at bottom-right corner); horizontal resize disabled (container width follows its parent panel).

### Accessibility
- Real `<textarea>` (or platform equivalent), labelled.
- Autosave status changes are polite live-region announcements, not assertive interruptions.

### Do / Don't
- ✅ Do: always show the Security Badge on this component — notes are exactly the kind of place credentials end up (per NFR-3), and the user must never wonder whether a given piece of UI is protected.
- ❌ Don't: add a manual "Save" button — it contradicts the autosave behavior and creates ambiguity about whether unsaved changes exist.

---

## Sidebar Project List Item

**Purpose:** Represents one saved project in the sidebar list — the sole entry point for opening, switching, closing, and dragging its terminal session(s) (FR-08 v1.4: there is no tab bar; the sidebar does everything a tab bar used to). Also the entry point into editing a project (FR-01).

### Anatomy
1. Container — full-width row
2. Status dot (leading) — small circle indicating path validity (see States) — validity only, never overloaded to mean "has an open tab" (see the left-edge bar below for that)
3. Project name — `--text-sm` / `--weight-medium`
4. Path (secondary line, truncated) — `--text-xs` / `--font-family-mono` / `--color-text-muted`
5. Overflow menu button (trailing, appears on hover/focus) — opens the Menu component (anchored variant)
6. Session count (implicit, not rendered as its own element) — determines the row's behavior mode below; when it's 2+, a list of `Sidebar Session Sub-item`s renders directly beneath this row, indented, as part of the same list flow (no wrapping box/border — see that component's spec)

### Variants
| Variant | When to use |
|---|---|
| default | Path exists and is valid |
| invalid | Path no longer exists on disk (edge case from FR-01) |

### Sizes
| Size | Height | Padding |
|---|---|---|
| default | auto (two text lines + `--space-2` vertical padding) | `--space-3` horizontal |

### States
| State | Visual change |
|---|---|
| default | bg transparent, status dot `--color-security` (path valid) |
| hover | bg `--color-surface-elevated`; overflow menu button becomes visible (only in the 0/1-session modes — see Behavior) |
| focus-visible | outline 2px `--color-focus`, offset -2px (inset, since the row is full-width) |
| open (exactly 1 session open, and it is not the currently active tab) | left edge gets a `--border-width-sm` `--color-border-strong` bar — a quiet hint that left-clicking here will *switch*, not open a duplicate |
| active (exactly 1 session open, and it is the currently active tab) | left edge gets a `--border-width-md` `--color-primary` bar (supersedes the `open` bar); bg `--color-surface-elevated` |
| grouped (2+ sessions open) | no left-edge bar of its own (an individual sub-item carries `active` instead — see Sidebar Session Sub-item); row loses hover/pointer affordances that imply direct clickability, since it no longer performs a switch action itself |
| invalid | status dot `--color-danger`; path text `--color-danger`; row remains clickable but clicking shows an inline message instead of opening a tab |

### Behavior — three modes by session count (FR-08 v1.4)
This component's interactivity depends entirely on how many tabs are currently open for it. The transition between modes is automatic (recomputed from `terminalStore.tabs` on every change) — there is no manual expand/collapse the user has to operate.

**0 open sessions:**
- Left-click opens a new tab for this project (FR-08/FR-03).
- Draggable: dragging this row onto a pane spawns a *fresh* session directly at the drop position (Split Pane Container's Drop zones) — there is no existing session to reuse, so this is the one drag case that results in a new PTY rather than moving one.
- Right-click / "⋮" Menu: "Open in new tab", Edit, Delete. No "Close terminal" (nothing open to close).

**Exactly 1 open session:**
- Left-click switches to (activates) that tab.
- Draggable: dragging this row moves that exact session (reused, not respawned) into the drop target.
- Right-click / "⋮" Menu: "Open in new tab" (adds a second — this is what flips the row into `grouped` mode), "Close terminal" (closes the one open session), Edit, Delete.

**2+ open sessions ("grouped"):**
- The row itself becomes non-interactive for switching: left-click does nothing (it no longer has one single tab to switch to), and it is **not draggable** (ambiguous — which of its sessions would be dragged?). It still renders normally otherwise (name, path, status dot) — it now reads as a group label for the `Sidebar Session Sub-item` list beneath it.
- Right-click / "⋮" Menu still works, still project-scoped: "Open in new tab" (adds another session to the group), Edit, Delete. No "Close terminal" here — with 2+ sessions, closing is unambiguous only per sub-item (see that component).
- Switching, closing, and dragging all move down to the individual `Sidebar Session Sub-item`s.

### Accessibility
- Row is a single focusable, actionable element (`role="button"` or native list-item button) in the 0/1-session modes; in `grouped` mode it is still focusable (for its Menu) but is not a button performing a switch action — its accessible role/behavior should reflect that it's inert for activation purposes (e.g. it can remain a heading-like static element with just its Menu control focusable within it).
- Status (`valid`/`invalid`) is conveyed by both color and text (the path line itself, or an inline error), never by color alone.
- The `open`/`active` left-edge bars are a supplementary hint, not the only signal of tab state.
- Drag has no keyboard equivalent — acceptable only because every outcome it can produce (spawn-into-split, move-into-split) is also reachable via `Split Pane Container`'s existing toolbar split buttons once a tab is already active, same rule as the original drag-to-split pattern.

### Do / Don't
- ✅ Do: truncate long paths in the middle (e.g. `/home/user/…/my-project`) rather than at the end, since the end of a path is usually the most identifying part (the folder name).
- ✅ Do: recompute the session-count mode reactively — a row must flip from `open`/`active` to `grouped` the instant a second session opens (e.g. via Menu → "Open in new tab"), not on next render/reload.
- ❌ Don't: reuse the "invalid path" red for the `open`/`active` states — they must stay visually distinct (see States table).
- ❌ Don't: let the status dot (validity) and the left-edge bar (open/active) collapse into one signal — they answer different questions and must stay two separate visual channels.
- ❌ Don't: make the `grouped` parent row draggable "just in case" — an ambiguous drag source is worse than no drag source; the sub-items exist precisely to remove that ambiguity.

---

## Sidebar Session Sub-item

**Purpose:** Represents exactly one open terminal session, shown only beneath a `Sidebar Project List Item` that currently has 2+ sessions open (FR-08 v1.4). This is where switching, closing, and dragging move to once a single row can no longer unambiguously represent "the" session.
**Use instead:** For a project with 0 or 1 sessions, there is no sub-item list at all — the parent row alone handles everything (see its Behavior section). Never render a single sub-item on its own.

### Anatomy
1. Container — indented row, nested directly under its parent `Sidebar Project List Item` in the same list (no wrapping box)
2. Status dot (leading, small) — reuses the same running/ready/error semantics the removed Tab component used to show (aggregate status of that tab's pane tree)
3. Label — `"Session {n}"`, `n` numbered by creation order (1-indexed, stable per tab — closing "Session 1" does not renumber "Session 2")
4. Close button (trailing, appears on hover/focus) — small `✕`

### Sizes
| Size | Height | Padding |
|---|---|---|
| default | `--control-height-sm` (24px) | `--space-3` horizontal, plus `--space-4` additional left indent under the parent's own padding |

### States
| State | Visual change |
|---|---|
| default | text `--color-text-muted`, `--text-xs` |
| hover | bg `--color-surface-elevated`; close button becomes visible |
| focus-visible | outline 2px `--color-focus`, offset -2px |
| active (this is the currently active tab) | text `--color-text`; left edge gets a `--border-width-md` `--color-primary` bar (identical treatment to the parent row's own `active` state, just narrower in scope — now it's this one line, not the whole project row) |
| dragging | opacity 0.4 while a drag is in progress, matching the removed Tab component's own `dragging` state — this component inherits that exact treatment since it inherits the responsibility |
| status: running | status dot pulses `--color-primary`, `--duration-slow` cycle, respects `prefers-reduced-motion` |
| status: error | status dot `--color-danger` |

### Behavior
- Click switches to (activates) this specific tab.
- Draggable: dragging this sub-item moves its exact session (reused, not respawned) into the drop target — same mechanics as dragging a 1-session parent row.
- Close button closes exactly this session, nothing else. If this was the second-to-last session for the project (i.e. one remains after closing), the parent row and its one remaining session collapse back to the 1-session mode automatically — the sub-item list disappears and the parent row resumes being directly clickable/draggable.

### Accessibility
- Each sub-item is independently focusable and keyboard-activatable (`Enter`/`Space` switches to it), consistent with the parent row's own pattern.
- Close button has an accessible label (`"Close Session {n}"`).

### Do / Don't
- ✅ Do: keep sub-item numbering stable — renumbering on every close would make "Session 2" refer to a different actual terminal moments after the user memorized it.
- ❌ Don't: give sub-items their own Menu/right-click — a single Close button is the only action they need; anything project-level (Edit, Delete, Open in new tab) stays on the parent row, which remains reachable even while sub-items are showing.

---

## Menu (overflow + context)

**Purpose:** A small floating list of actionable items for one target (e.g. a Sidebar Project List Item). This app has no separate "context menu vs. dropdown" visual language — an anchored trigger (click a button) and a context trigger (right-click the target) summon the exact same menu.
**Use instead:** For app-wide navigation, use plain links/buttons, not a Menu. For a single primary action, use a Button — Menu is for a *choice* between actions.

### Anatomy
1. Container — floating panel
2. Menu item(s) — one row per action; optionally `danger`-styled for destructive actions (e.g. Delete)

### Variants
| Variant | Trigger | Positioning |
|---|---|---|
| anchored | Click on a dedicated trigger button (e.g. Sidebar Project List Item's "⋮") | Below and right-aligned to the trigger |
| context | Right-click anywhere on the target row | At the cursor position, clamped so the menu never renders off-screen |

Both variants render **identical content** for the same target and share every state/behavior below — only how they're summoned and positioned differs. This is a hard rule, not a coincidence of the current item list — see Do/Don't.

### Sizes
| Size | Min-width | Padding |
|---|---|---|
| default | `--menu-min-width` (128px) | `--space-1` |

### States
| State | Visual change |
|---|---|
| closed | not rendered |
| open | bg `--color-surface-elevated`, border `--border-width-sm` `--color-border`, `--radius-md`, `--shadow-md` |
| item default | text `--color-text`, `--text-sm` |
| item hover / focus-visible | bg `--color-surface` |
| item danger | text `--color-danger` (e.g. Delete) |

### Behavior
- Opens on click (anchored) or right-click (context, which also suppresses the browser's native right-click menu on the target). Only one Menu is ever open anywhere in the app — opening a second closes the first, including switching which row's context menu is showing if the user right-clicks a different row.
- Closes on: selecting an item, clicking outside, pressing `Escape`, or its target scrolling out of view.
- Selecting an item both performs the action and closes the menu — there is no multi-select or "stay open" mode.
- The item list may depend on the target's own state (e.g. Sidebar Project List Item's Menu shows "Close terminal" only when it has exactly one open session) — that's expected and does not violate the anchored/context parity rule below, which is about both variants agreeing with *each other* at a given moment, not about the list being frozen over time.

### Accessibility
- `role="menu"` on the container, `role="menuitem"` on each item; opening moves focus to the first item.
- `ArrowDown`/`ArrowUp` moves focus between items (wrapping at the ends); `Enter`/`Space` activates the focused item.
- `Escape` closes the menu and returns focus to whatever had focus before it opened (the "⋮" button for anchored; the row itself for context).
- The **context** variant is reachable without a mouse *indirectly*: because its item list is identical to the anchored variant's (see Behavior/Do-Don't), and the anchored trigger is a normal focusable, keyboard-activatable button, every action the context menu offers remains reachable by keyboard. This project does not implement a dedicated `Shift+F10`/menu-key handler, because it would be redundant with the always-present "⋮" button, not because a right-click-only action exists anywhere.

### Do / Don't
- ✅ Do: keep the anchored and context variants' item lists identical for the same target — this is what makes the keyboard-accessibility argument above true. Adding an item to one without the other quietly breaks it.
- ❌ Don't: nest a Menu inside a Menu, or open a Menu from within a Modal's own action (not a pattern this app uses anywhere — if a future feature seems to need it, that's a new pattern to design, not an extension of this one).

---

## Tab (terminal tab bar) — REMOVED in v1.4

**This component no longer exists.** FR-08 v1.4 removed the horizontal tab-bar widget entirely; the sidebar now owns everything this component used to do (open, switch, close, drag-to-split — see `Sidebar Project List Item` and `Sidebar Session Sub-item`). This section is kept as a stub, not deleted outright, so a search for "Tab" in this document finds an explanation instead of silence — see design.md's changelog (v1.3) for why it existed in the first place.

**Consequence for the signature gradient element:** the active-tab underline was one of the gradient's two exclusive homes (design.md Principle 2). With this component gone, the gradient (`--color-accent-gradient`) now appears in exactly **one** place app-wide: the unlock screen's ambient glow. Sidebar Project List Item's and Sidebar Session Sub-item's `active` states use a **solid** `--color-primary` bar, not the gradient — deliberately not "promoted" to the gradient's old role, to avoid forcing a two-stop diagonal gradient onto a 2px-wide vertical bar where it would barely read as a gradient at all (see those components' States tables). design.md §2/§3/§4.1 are updated accordingly in this same change-set.

---

## Split Pane Container

**Purpose:** Holds one or more terminal instances for the currently active tab, arranged in a resizable horizontal/vertical grid (FR-08). Fills the entire main content area — with the tab bar removed in v1.4, there is no chrome above it.

### Anatomy
1. Grid container
2. Pane(s) — each wraps exactly one terminal instance (rendered by the `xterm.js` component, out of design-system scope beyond its container)
3. Divider(s) — draggable resize handles between sibling panes
4. Pane header — **always present** (changed in v1.4; used to appear only when 2+ panes existed). Shows the pane's working directory (mono, truncated) and a small close-pane button. This is now the *only* remaining "which project/session am I looking at" indicator anywhere in the app, since there is no tab bar to show a label — see Do/Don't.
5. Drop-zone overlay (transient — only exists while a sidebar row or session sub-item is being dragged over a pane, see Behavior — Drag to split)

### Variants
| Variant | When to use |
|---|---|
| single (no dividers) | Tab has exactly one pane — the common case. Still shows the pane header (v1.4). |
| split | Tab has 2+ panes, arranged per the user's horizontal/vertical split choices |

### Sizes
N/A — panes fill available space; minimum pane size is `--pane-min-width` × `--pane-min-height` (160×120px — below this, further splitting of that pane is disabled, not silently allowed to overflow).

### States
| State | Visual change |
|---|---|
| default pane | border `--border-width-sm` `--color-border` between panes |
| focused pane (has keyboard input focus) | border `--border-width-sm` `--color-primary` around that pane only — critical: this is how the user knows which pane their typing goes to |
| divider default | 1px `--color-border`, invisible extra hit area `--pane-divider-hit-area` for easier grabbing |
| divider hover | divider color `--color-border-strong`; cursor becomes resize (row/col-resize per orientation) |
| divider dragging | divider color `--color-primary` while actively dragged |
| drop-zone active (a sidebar row/sub-item is being dragged over this pane) | see the dedicated drop-zone table below |

### Drop zones (drag-to-split targeting)

While a sidebar item (a `Sidebar Project List Item` in its 0/1-session mode, or a `Sidebar Session Sub-item`) is being dragged over a pane, that pane is divided by its two diagonals into **four triangular zones** — top, right, bottom, left — with no separate "center" zone. This is a deliberate simplification, not an oversight: this app has no per-pane tab strip for a center-drop ("add as a tab in this group," VS Code's convention) to mean anything — the sidebar itself is the only tab strip there is. Covering the whole pane with exactly four directional zones removes the ambiguous case by construction instead of specifying a dead zone.

| Zone | Trigger region | Visual feedback | Result on drop |
|---|---|---|---|
| Top | Upper triangle (between the two diagonals) | Overlay covers the top half: bg `--color-primary-bg-subtle`, `--border-width-md` solid `--color-primary` on the inner edge | Pane splits `column`; the dragged session becomes the new top sibling |
| Bottom | Lower triangle | Overlay covers the bottom half, same treatment | Pane splits `column`; the dragged session becomes the new bottom sibling |
| Left | Left triangle | Overlay covers the left half, same treatment | Pane splits `row`; the dragged session becomes the new left sibling |
| Right | Right triangle | Overlay covers the right half, same treatment | Pane splits `row`; the dragged session becomes the new right sibling |
| Invalid target (hovering a pane that belongs to the exact tab being dragged) | — | No overlay appears at all; cursor shows the platform's "not-allowed" affordance | Drop is rejected; the sidebar item returns to its normal state. Only applies when the drag source already has a live session (0-session sources have no "self" to collide with — every pane is a valid target for them) |

The overlay's highlighted half previews the *resulting* pane's approximate bounds (half of the target pane), not the whole tab area — this stays accurate for a fresh split; when the drop lands on a pane that's already part of a same-direction split (auto-flatten, per `terminal.svelte.ts`'s `splitPane`), the preview still communicates "roughly here," which is sufficient given the actual final share is visible immediately after drop.

### Behavior
- Splitting a pane (via toolbar button, shortcut, or drag-to-split) divides it along the chosen axis; each resulting pane spawns its own independent PTY session — **except** drag-to-split from a source that already had a live session (a `Sidebar Project List Item` with 1 open session, or any `Sidebar Session Sub-item`), which reuses that exact session verbatim (nothing reconnects or flickers). Dragging a `Sidebar Project List Item` with **0** open sessions is the one case where drag-to-split *does* spawn a fresh session directly into the new pane — there's nothing existing to reuse (FR-08 v1.4).
- **Drag to split**: dropping a dragged sidebar item on a pane grafts (or spawns, per above) the session into the target tab's tree at the drop position (see the drop-zone table above for which edge maps to which split direction). If the source was a `Sidebar Project List Item` with exactly 1 session, that project's row updates to reflect it's now `active` wherever the graft landed. If the source was a `Sidebar Session Sub-item`, only that one sub-item's session moves — its siblings are unaffected. Dropping outside any pane is a no-op — no confirmation needed since nothing changed.
- Dragging a divider resizes its two adjacent panes proportionally; other panes in the grid are unaffected.
- Closing a pane with a live foreground process shows a confirmation before closing (PRD FR-08 edge case, exact confirmation copy is a `⚠️ TBD` in the PRD — use the Modal spec until that copy is finalized). If it's the tab's last remaining pane, closing it closes the tab itself, same as using Menu's "Close terminal" or a `Sidebar Session Sub-item`'s close button.
- Only one pane can be "focused" at a time; clicking anywhere in a pane (including its terminal content) focuses it.

### Accessibility
- Pane focus state must be visually unambiguous even for a user glancing quickly — this is a UI component conveying essential information (which pane receives keystrokes), so its 3:1 non-text contrast requirement is verified in design.md §7.
- Dividers are keyboard-operable: focus a divider (`Tab`), resize with `Arrow` keys in fixed increments.
- Drag-to-split has no keyboard equivalent — acceptable only because every outcome it can produce is also reachable via the toolbar split buttons (for splitting) or Menu/`Sidebar Session Sub-item` actions (for opening/switching/closing), which remain the accessible path.

### Do / Don't
- ✅ Do: always show which pane is focused, even with only one pane in the tab (subtle is fine, but never absent) — consistency prevents the user from having to "hunt" for focus when they do split later.
- ✅ Do: always render the pane header (v1.4) — it is load-bearing now, not decorative; without a tab bar, it's the only place a project/path is visible once you're looking at the terminal area.
- ❌ Don't: let a pane shrink below its minimum size via drag — clamp the drag instead of allowing a pane to become unusably small.
- ❌ Don't: show a drop-zone overlay when the hovered pane belongs to the exact tab currently being dragged — that operation is invalid (a tree can't be grafted into itself) and must look unavailable, not just fail silently on drop.
- ❌ Don't: invent a fifth "center = move without splitting" zone — that reintroduces the per-pane-tab-strip concept this app doesn't have. If that capability is ever wanted, it's a new pattern to design deliberately, not a corner case to bolt on here.

---

## Modal / Dialog

**Purpose:** Focused, blocking interaction for a self-contained task: Add/Edit Project form, confirmations (close tab/pane with running process, delete project), Unlock screen is a **full-page** pattern, not a Modal (see Patterns).

### Anatomy
1. Backdrop — covers the app, dismisses on click for non-destructive dialogs only
2. Container — centered
3. Header — title + close button
4. Body — form content or message
5. Footer — action buttons, right-aligned, secondary before primary in reading order (Cancel, then the primary action)

### Variants
| Variant | When to use | Key differences |
|---|---|---|
| form | Add/Edit Project | wider (480px), scrollable body if content exceeds viewport |
| confirm | Delete/close-with-running-process confirmations | narrower (360px), no scroll, primary button is `danger` variant when the action is destructive |

### Sizes
| Size | Width | Max-height |
|---|---|---|
| form | 480px | 80vh |
| confirm | 360px | auto |

### States
| State | Visual change |
|---|---|
| entering | backdrop fades in (`--duration-base`), container scales from 0.98→1 + fades in, `--ease-out` |
| open | backdrop bg `--color-backdrop` |
| exiting | reverse of entering, `--duration-fast` |

### Behavior
- `Escape` closes non-destructive dialogs; for `confirm` dialogs guarding a destructive action, `Escape` is equivalent to Cancel (never to the destructive action).
- Clicking the backdrop closes `form` dialogs only if the form is unedited (pristine); if edited, backdrop click is a no-op and only explicit Cancel/close works — prevents accidental loss of typed data.

### Accessibility
- `role="dialog"`, `aria-modal="true"`, labelled by its header title.
- Focus moves to the first interactive element on open, and returns to the element that triggered the dialog on close.
- Focus is trapped within the dialog while open (`Tab`/`Shift+Tab` cycle within it).

### Do / Don't
- ✅ Do: put exactly one primary button in the footer (per the Button spec's rule).
- ❌ Don't: use a `confirm` dialog for the Unlock screen — unlock is a full-page pattern (see Patterns), not a dismissible overlay, since there is nothing behind it to see yet.

---

## Security Badge

**Purpose:** A small, consistent visual signal that the data in view is encrypted/protected — used on the Notes editor, the Unlock screen, and the Add/Edit Project form wherever commands/notes fields appear.

### Anatomy
1. Icon — lock glyph
2. Label (optional, omitted in the compact inline variant) — e.g. "Encrypted"

### Variants
| Variant | When to use | Key differences |
|---|---|---|
| inline (icon-only) | Pinned corner of Textarea, form field hints | icon only, `--text-xs` size, `--color-security` |
| labeled | Unlock screen, empty states, first-run explanation | icon + label, on `--color-security-bg-subtle` pill background, text `--color-on-security` is not used here — use `--color-security` text directly on the subtle bg (verified 7.96:1, see design.md §7) |
| error | Decryption failed (wrong password, corrupted file) | icon changes to a broken-lock/alert glyph, color `--color-danger`, bg `--color-danger-bg-subtle` |

### Sizes
| Size | Icon | Font |
|---|---|---|
| inline | 12px | `--text-xs` |
| labeled | 16px | `--text-xs` / `--weight-medium` |

### States
This is a status indicator, not an interactive control — no hover/focus/active states. It may be wrapped in a tooltip trigger (see Behavior).

### Behavior
- Hovering/focusing an `inline` badge shows a tooltip: "This field is encrypted at rest" (or the localized equivalent per design.md §6).
- Never animates except the `error` variant, which may use a single, non-repeating attention pulse on first appearance (respects `prefers-reduced-motion`).

### Accessibility
- Icon has an accessible label even when the text label is visually omitted (`inline` variant) — the meaning must never depend on color alone.

### Do / Don't
- ✅ Do: use this exact badge everywhere sensitive data is shown or entered — consistency is what builds the user's trust that "if I don't see this badge, this field might not be protected" (a real, deliberate signal, not decoration).
- ❌ Don't: introduce a second "security" visual language (e.g. a different icon or color) anywhere in the app — `--color-security` (emerald) is reserved exclusively for this meaning.

---

## Patterns

### Unlock screen (full-page, not a Modal)
Centered card (max-width 360px) vertically centered in the viewport, background is the plain `--color-background` (no sidebar/chrome visible yet — nothing exists to show until data is decrypted). Composition, top to bottom: app icon/wordmark, `Security Badge` (labeled variant, "Encrypted"), `Input` (password variant), primary `Button` ("Unlock", full-width of the card), error text area (uses Input's error-state message styling) shown only after a failed attempt. The card sits on a very subtle radial application of `--shadow-glow-primary` behind it — as of v1.4, this is the **only** place the signature gradient glow appears anywhere in the app (its other home, the removed Tab component's active-state underline, no longer exists — see `Tab (terminal tab bar) — REMOVED in v1.4`). Vertical rhythm between elements: `--space-6` between the badge and the input, `--space-4` between input and button.

### Add/Edit Project form (Modal, `form` variant)
Field order top-to-bottom: Name (Input, default), Path (Input, path variant — Browse button per FR-02), Setup commands (Textarea, one command per line), Notes (Textarea, with Security Badge). `--space-6` between fields. Footer: Cancel (secondary) then Save (primary). On open for "Edit", fields are pre-filled; on open for "Add", Path's Browse button is the first focused element (the primary entry method per the user's stated preference) rather than the Name field.

### Terminal split grid area (renamed in v1.4 — was "Terminal tab + split grid area")
No tab bar (removed v1.4). The active tab's `Split Pane Container` fills the *entire* main content area, edge to edge, from the top of the window down. Switching which tab is active (via the sidebar) swaps the entire pane grid instantly (panes belonging to inactive tabs keep their PTY sessions alive in the background per architecture.md §5.3 — switching must never feel like "loading", reinforcing NFR-7). When no tab is open at all (fresh unlock, nothing clicked yet), this area shows an empty state: centered text, `--color-text-muted`, `--text-sm`, e.g. "Select a project from the sidebar to open a terminal here."

### Sidebar layout
Fixed width 260px (collapses to a 56px icon-only rail below `--bp-sidebar-collapse`). Top-to-bottom: search input (compact `Input`, sm size), scrollable list of `Sidebar Project List Item`s (each optionally followed by its `Sidebar Session Sub-item` list when it has 2+ open sessions — the list's total height is therefore dynamic, not fixed-row-height; the scroll container already handles this, no extra layout work needed), pinned footer with a ghost `Button` ("+ Add project").

### Sidebar drag-to-split (renamed in v1.4 — was "Tab drag-to-split")
1. User presses and moves a `Sidebar Project List Item` (in its 0- or 1-session mode) or a `Sidebar Session Sub-item` past the browser's native drag threshold → the dragged element enters its `dragging` state (opacity 0.4); a translucent drag image follows the cursor. A `Sidebar Project List Item` in its `grouped` (2+ session) mode is not draggable at all — see that component's Behavior.
2. As the cursor moves over any `Split Pane Container`, the pane directly under the cursor computes which of its four triangular zones (Split Pane Container's Drop zones table) the cursor is in, and shows that zone's overlay. Moving between panes, or between zones within one pane, updates the overlay live — only one overlay is ever visible at a time.
3. If the drag source already has a live session and the cursor is over the pane holding that exact session, no overlay appears (invalid target, "not-allowed" cursor) — the same self-graft guard as before. A 0-session source has no such pane, so every pane is a valid target for it.
4. On drop over a valid zone: if the source had a live session, it grafts into the target pane's position, split along that zone's direction, and is reused (not respawned) — nothing reconnects or flickers. If the source had no session yet (a `Sidebar Project List Item` with 0 open tabs), a fresh one spawns directly into that new pane position instead. Either way, the target tab becomes active and the overlay clears.
5. On drop anywhere invalid (outside a pane, or on the source's own pane): no-op, the dragged element returns to its normal state — this is the browser's native drag-cancel behavior, not a custom animation to build.

This pattern has no dedicated component of its own — it's existing `Sidebar Project List Item`, `Sidebar Session Sub-item`, and `Split Pane Container` states composed into one interaction, which is why it's documented here rather than as a new spec entry.
