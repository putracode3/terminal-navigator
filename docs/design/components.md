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

**Purpose:** Represents one saved project in the sidebar list; primary entry point into opening a terminal (FR-03) or editing a project.

### Anatomy
1. Container — full-width row
2. Status dot (leading) — small circle indicating path validity (see States)
3. Project name — `--text-sm` / `--weight-medium`
4. Path (secondary line, truncated) — `--text-xs` / `--font-family-mono` / `--color-text-muted`
5. Overflow menu button (trailing, appears on hover/focus) — opens Edit/Delete/Duplicate actions

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
| default | bg transparent, status dot `--color-security` (valid/ready — reuses the security-accent hue deliberately, signaling "trusted/good") if never opened, or neutral `--color-text-muted` dot once opened at least once — exact dot semantics: green dot only used for the "path validated" concept, not overloaded for "currently open" (see Do/Don't) |
| hover | bg `--color-surface-elevated`; overflow menu button becomes visible |
| focus-visible | outline 2px `--color-focus`, offset -2px (inset, since the row is full-width) |
| active (open in a tab) | left edge gets a 2px `--color-primary` bar; bg `--color-surface-elevated` |
| invalid | status dot `--color-danger`; path text `--color-danger`; row remains clickable but clicking shows an inline message instead of opening a tab |

### Behavior
- Click opens the project in a **new tab** (FR-08) — never replaces an existing open tab.
- Overflow menu (Edit / Delete / Duplicate) opens on click of the trailing button, or via a keyboard context-menu key.
- Drag handle is not in MVP scope (reordering is not a specified requirement) — do not add one speculatively.

### Accessibility
- Row is a single focusable, actionable element (`role="button"` or native list-item button), with the overflow menu as a separately focusable nested control.
- Status (`valid`/`invalid`) is conveyed by both color and text (the path line itself, or an inline error), never by color alone.

### Do / Don't
- ✅ Do: truncate long paths in the middle (e.g. `/home/user/…/my-project`) rather than at the end, since the end of a path is usually the most identifying part (the folder name).
- ❌ Don't: reuse the "invalid path" red for the "currently open" active state — they must stay visually distinct (see States table).

---

## Tab (terminal tab bar)

**Purpose:** Represents one open project session in the main terminal area (FR-08); switches which tab's split-pane grid is visible.

### Anatomy
1. Container — `draggable` (see Behavior — Drag to split)
2. Project name label
3. Status indicator (leading, small dot) — reflects the tab's auto-run/setup command state
4. Close button (trailing, appears on hover/focus)

### Variants
| Variant | When to use |
|---|---|
| default | Normal open tab |

### Sizes
| Size | Height | Padding-x | Font |
|---|---|---|---|
| default | `--tab-height` (36px) | `--space-3` | `--text-sm` |

### States
| State | Visual change |
|---|---|
| inactive | bg transparent, text `--color-text-muted`, bottom border none |
| hover | bg `--color-surface-elevated`, close button becomes visible |
| active (selected) | bg `--color-surface-elevated`, text `--color-text`, bottom border 2px using `--color-accent-gradient` (this is the design's signature element — see design.md §3) |
| focus-visible | outline 2px `--color-focus`, offset -2px |
| running (setup command executing) | status dot pulses using `--color-primary` at reduced opacity, `--duration-slow` pulse cycle; respects `prefers-reduced-motion` (pulse becomes a static dot, no animation) |
| error (PTY failed to spawn) | status dot `--color-danger`; hovering/focusing the dot shows the error reason in a tooltip |
| dragging | opacity 0.4 on the tab itself while a drag is in progress; the browser's native drag image (a translucent copy of the tab) follows the cursor — see Behavior — Drag to split |

### Behavior
- Clicking a Sidebar Project List Item always creates a new Tab (never reuses an existing one for a different project) — see FR-08.
- Clicking the close button (or a global "close tab" shortcut) closes the tab; if any pane inside has a foreground process running, show a confirmation before closing (PRD FR-08 edge case, exact confirmation copy is a `⚠️ TBD` in the PRD — implement a generic confirm dialog using the Modal spec below until that copy is finalized).
- Tabs scroll horizontally (do not wrap) when there are more tabs than fit; no tab overflow menu in MVP.
- **Drag to split** (see Split Pane Container's matching section and the "Tab drag-to-split" pattern below for the full flow): pressing and moving a tab past the platform's native drag threshold picks it up; dropping it on a pane elsewhere absorbs that tab's entire pane tree into the target tab as a new split, and removes the dragged tab from the tab bar. Dragging is available regardless of which project the source and target tabs belong to — there is no same-project restriction.

### Accessibility
- Tab list uses the standard tab/tablist/tabpanel pattern: `Arrow Left/Right` moves focus between tabs, `Enter`/`Space` activates, the corresponding pane grid is the tabpanel.
- Close button has an accessible label ("Close {project name}").
- Drag-to-split is a mouse/pointer-only affordance (matching the native HTML drag-and-drop it's built on) — it must never be the *only* way to reach a piece of functionality. It isn't: every split it can produce is also reachable via the Split Pane Container's existing toolbar split buttons, so keyboard-only users lose no capability.

### Do / Don't
- ✅ Do: keep the active-tab gradient underline as the *only* place in the whole app (besides the unlock screen glow) that uses the raw gradient — this is what makes it a signature element instead of visual noise (design principle in design.md §2).
- ❌ Don't: animate the gradient (e.g. shifting hue) — it stays a static two-stop gradient; motion is reserved for state changes, not decoration.
- ❌ Don't: give the drag ghost/preview the gradient treatment either — dragging is a manipulation state, not the signature "this is active" moment; opacity-0.4 is enough.

---

## Split Pane Container

**Purpose:** Holds one or more terminal instances inside a Tab, arranged in a resizable horizontal/vertical grid (FR-08).

### Anatomy
1. Grid container
2. Pane(s) — each wraps exactly one terminal instance (rendered by the `xterm.js` component, out of design-system scope beyond its container)
3. Divider(s) — draggable resize handles between sibling panes
4. Pane header (thin, appears only when 2+ panes exist) — shows the pane's working directory (mono, truncated) and a small close-pane button
5. Drop-zone overlay (transient — only exists while a tab is being dragged over a pane, see Behavior — Drag to split)

### Variants
| Variant | When to use |
|---|---|
| single (no dividers, no pane header) | Tab has exactly one pane — the common case |
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
| drop-zone active (a dragged tab is hovering this pane) | see the dedicated drop-zone table below |

### Drop zones (drag-to-split targeting)

While a Tab is being dragged over a pane, that pane is divided by its two diagonals into **four triangular zones** — top, right, bottom, left — with no separate "center" zone. This is a deliberate simplification, not an oversight: VS Code's center-drop ("add as a tab in this group") has no equivalent here, because panes don't have their own per-pane tab strips in this app — every tab lives in the single global tab bar (Tab spec, Anatomy). Covering the whole pane with exactly four directional zones removes the ambiguous case by construction instead of specifying a dead zone.

| Zone | Trigger region | Visual feedback | Result on drop |
|---|---|---|---|
| Top | Upper triangle (between the two diagonals) | Overlay covers the top half: bg `--color-primary-bg-subtle`, `--border-width-md` solid `--color-primary` on the inner edge | Pane splits `column`; dragged tab's pane tree becomes the new top sibling |
| Bottom | Lower triangle | Overlay covers the bottom half, same treatment | Pane splits `column`; dragged tab's pane tree becomes the new bottom sibling |
| Left | Left triangle | Overlay covers the left half, same treatment | Pane splits `row`; dragged tab's pane tree becomes the new left sibling |
| Right | Right triangle | Overlay covers the right half, same treatment | Pane splits `row`; dragged tab's pane tree becomes the new right sibling |
| Invalid target (hovering the pane that belongs to the tab being dragged) | — | No overlay appears at all; cursor shows the platform's "not-allowed" affordance | Drop is rejected; dragged tab returns to its original tab-bar position |

The overlay's highlighted half previews the *resulting* pane's approximate bounds (half of the target pane), not the whole tab area — this stays accurate for a fresh split; when the drop lands on a pane that's already part of a same-direction split (auto-flatten, per `terminal.svelte.ts`'s `splitPane`), the preview still communicates "roughly here," which is sufficient given the actual final share is visible immediately after drop.

### Behavior
- Splitting a pane (via toolbar button, shortcut, or drag-to-split) divides it along the chosen axis; each resulting pane spawns its own independent PTY session — **except** drag-to-split, which reuses the dragged tab's existing session(s) verbatim (nothing reconnects or flickers; the terminal content that moves is exactly the terminal content that was already running).
- **Drag to split**: dragging a Tab and dropping it on a pane grafts that tab's entire pane tree into the target tab's tree at the drop position (see the drop-zone table above for which edge maps to which split direction), then removes the dragged tab from the tab bar entirely — its content now lives inside the target tab. The target tab becomes active. If the dragged tab itself had multiple panes, the whole subtree moves together, not just one pane. Dropping outside any pane (e.g. back onto the tab bar, or anywhere that isn't a pane) is a no-op — the tab returns to its original position, no confirmation needed since nothing changed.
- Dragging a divider resizes its two adjacent panes proportionally; other panes in the grid are unaffected.
- Closing a pane with a live foreground process shows the same confirmation pattern as closing a Tab (see Tab's Behavior section).
- Only one pane can be "focused" at a time; clicking anywhere in a pane (including its terminal content) focuses it.

### Accessibility
- Pane focus state must be visually unambiguous even for a user glancing quickly — this is a UI component conveying essential information (which pane receives keystrokes), so its 3:1 non-text contrast requirement is verified in design.md §7.
- Dividers are keyboard-operable: focus a divider (`Tab`), resize with `Arrow` keys in fixed increments.
- Drag-to-split has no keyboard equivalent (see Tab's Accessibility note) — this is acceptable only because every outcome it can produce is also reachable via the toolbar split buttons, which remain the accessible path.

### Do / Don't
- ✅ Do: always show which pane is focused, even with only one pane in the tab (subtle is fine, but never absent) — consistency prevents the user from having to "hunt" for focus when they do split later.
- ❌ Don't: let a pane shrink below its minimum size via drag — clamp the drag instead of allowing a pane to become unusably small.
- ❌ Don't: show a drop-zone overlay when the hovered pane belongs to the tab currently being dragged — that operation is invalid (a tree can't be grafted into itself) and must look unavailable, not just fail silently on drop.
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
Centered card (max-width 360px) vertically centered in the viewport, background is the plain `--color-background` (no sidebar/chrome visible yet — nothing exists to show until data is decrypted). Composition, top to bottom: app icon/wordmark, `Security Badge` (labeled variant, "Encrypted"), `Input` (password variant), primary `Button` ("Unlock", full-width of the card), error text area (uses Input's error-state message styling) shown only after a failed attempt. The card sits on a very subtle radial application of `--shadow-glow-primary` behind it — the second (and last) place the signature gradient glow appears (see Tab's active-state note). Vertical rhythm between elements: `--space-6` between the badge and the input, `--space-4` between input and button.

### Add/Edit Project form (Modal, `form` variant)
Field order top-to-bottom: Name (Input, default), Path (Input, path variant — Browse button per FR-02), Setup commands (Textarea, one command per line), Notes (Textarea, with Security Badge). `--space-6` between fields. Footer: Cancel (secondary) then Save (primary). On open for "Edit", fields are pre-filled; on open for "Add", Path's Browse button is the first focused element (the primary entry method per the user's stated preference) rather than the Name field.

### Terminal tab + split grid area
Tab bar (`--tab-height`) pinned to the top of the main content area, horizontally scrollable. Below it, the active tab's `Split Pane Container` fills all remaining space. Switching tabs swaps the entire pane grid instantly (panes belonging to inactive tabs keep their PTY sessions alive in the background per architecture.md §5.3 — switching tabs must never feel like "loading", reinforcing NFR-7).

### Sidebar layout
Fixed width 260px (collapses to a 56px icon-only rail below `--bp-sidebar-collapse`). Top-to-bottom: search input (compact `Input`, sm size), scrollable list of `Sidebar Project List Item`s, pinned footer with a ghost `Button` ("+ Add project").

### Tab drag-to-split
1. User presses and moves a `Tab` past the browser's native drag threshold → that Tab enters its `dragging` state (opacity 0.4); a translucent drag image follows the cursor.
2. As the cursor moves over any `Split Pane Container`, the pane directly under the cursor computes which of its four triangular zones (Tab spec / Split Pane Container's Drop zones table) the cursor is in, and shows that zone's overlay. Moving between panes, or between zones within one pane, updates the overlay live — only one overlay is ever visible at a time.
3. Hovering the pane belonging to the dragged tab itself shows no overlay (invalid target, "not-allowed" cursor).
4. On drop over a valid zone: the dragged tab's entire pane tree grafts into the target pane's position, split along that zone's direction (Split Pane Container Behavior); the dragged tab is removed from the tab bar; the target tab becomes active; the overlay clears.
5. On drop anywhere invalid (outside a pane, or on the source tab's own pane): no-op, the tab returns to the tab bar exactly where it was — this is the browser's native drag-cancel behavior, not a custom animation to build.

This pattern has no dedicated component of its own — it's existing `Tab` and `Split Pane Container` states composed into one interaction, which is why it's documented here rather than as a new spec entry.
