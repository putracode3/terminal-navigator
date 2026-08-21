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
- ❌ Don't: put the gradient (`--color-accent-gradient`) as a button's solid fill — both of its stops fail text contrast (see design.md §7). Gradient is decorative-only.
- ❌ Don't: use `danger` variant for anything that isn't destructive/irreversible (e.g. don't use it for "Cancel").

---

## Input (text field, incl. Path field variant)

**Purpose:** Single-line text entry — project name, manual path entry, the Migration prompt's legacy password (v3.0 — its only remaining `password`-variant use), setup commands.
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
| password | Legacy password (Migration prompt, v3.0 — was "Master password (unlock screen)"; shown conditionally, at most once per installation) | leading lock icon `--color-text-muted`; text content masked; trailing affix is a ghost icon-button toggling mask/reveal |

### Sizes
| Size | Height | Padding-x | Font |
|---|---|---|---|
| md (default) | `--control-height-md` (32px) | `--space-3` | `--text-sm` |

### States
| State | Visual change |
|---|---|
| default | bg `--color-surface`, border 1px `--color-border-strong`, text `--color-text` |
| hover | border color unchanged; cursor text |
| focus-visible | border 1px `--color-primary`; outer glow `0 0 0 2px` at 20% opacity of `--color-primary` (approximate via a dedicated focus-ring, not `--shadow-glow-primary` which is reserved for the Migration prompt's ambient glow) |
| filled | same as default, distinguished only by content presence — no separate visual treatment needed |
| disabled | opacity 0.5; bg `--color-surface`; cursor not-allowed |
| error | border 1px `--color-danger`; help text area shows the error message in `--color-danger`, `--text-xs` |

### Behavior
- The `path` variant validates on blur: if the typed/selected path does not exist, it immediately enters `error` state with message "This path doesn't exist" (FR-02 acceptance criteria).
- The `password` variant submits on `Enter` (equivalent to clicking the Migration prompt's primary "Migrate" button, v3.0 — was "Unlock").

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
3. Autosave status text — below the field (e.g. "Saved" / "Saving…")

**v3.0:** previously had a third anatomy item, a `Security Badge` pinned top-right communicating "these notes are encrypted at rest" — removed along with the component (ADR-0014; design.md Principle 3's retirement). Not replaced; there is no longer a differential protection claim to make about this field versus any other.

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
| disabled | opacity 0.5, cursor not-allowed (defined for completeness; not currently triggered by any app state as of v3.0 — its original trigger, the pre-ADR-0014 locked/unlocking state, no longer exists) |

### Behavior
- Autosaves on blur and on a debounce (~1s of inactivity) — never requires an explicit "Save" click for notes, since FR-05 treats notes as always-persisted state, not a form to submit.
- Vertically resizable by the user (drag handle at bottom-right corner); horizontal resize disabled (container width follows its parent panel).

### Accessibility
- Real `<textarea>` (or platform equivalent), labelled.
- Autosave status changes are polite live-region announcements, not assertive interruptions.

### Do / Don't
- ❌ Don't: add a manual "Save" button — it contradicts the autosave behavior and creates ambiguity about whether unsaved changes exist.

---

## Sidebar Project List Item

**Purpose:** Represents one saved project in the sidebar list — the sole entry point for opening, switching, closing, and dragging its terminal session(s) (FR-08 v1.4: there is no tab bar; the sidebar does everything a tab bar used to). Also the entry point into editing a project (FR-01). May render at the sidebar's top level or nested one level inside a `Sidebar Folder` (FR-11, v1.8) — its own anatomy, states, and behavior are identical either way; only its list position/indentation changes.

### Anatomy
1. Container — full-width row
2. Project name — `--text-sm` / `--weight-medium`
3. Path (focus reveal only, not part of the row's resting layout) — shown in a small floating tooltip anchored below the name via CSS `:focus-visible` on the row (v1.5 change, see States): reveals on genuine keyboard Tab-navigation only, not mouse hover, a plain left-click, or the autofocus that lands on the context/overflow menu's first item when it opens — all of those used to trip it via `:focus-within`, which matches on any descendant focus regardless of input method. `--text-xs` / `--font-family-mono`, full path (untruncated; wraps if it doesn't fit rather than truncating, since the tooltip isn't width-constrained like the row). Text color signals path validity: `--color-text` when valid, `--color-text-muted` when invalid (de-emphasized, not alarmed — `--color-danger` is reserved for the inline error message only, see States). Tooltip uses `--z-tooltip`.
4. Inline close button (trailing, before the overflow menu; **only in the exactly-1-session mode**, appears on hover/focus) — "✕", closes that one session. Added v2.4: closing a lone session previously required opening the ⋮ Menu, two steps behind a hidden surface for the most common action on an open project, while `grouped` mode had a one-click ✕ on every `Sidebar Session Sub-item`. Deliberately absent in the 0-session mode (nothing to close) and in `grouped` mode ("close" is ambiguous there — which session? — and each sub-item already carries its own). The Menu's "Close terminal" item stays as-is: same action, two entry points, exactly like `Sidebar Folder`'s chevron-vs-header-body toggle.
5. Overflow menu button (trailing, appears on hover/focus) — opens the Menu component (anchored variant)
6. Session count (implicit, not rendered as its own element) — determines the row's behavior mode below; when it's 2+, a list of `Sidebar Session Sub-item`s renders directly beneath this row, indented, as part of the same list flow (no wrapping box/border — see that component's spec)

**v1.5 — status dot removed:** the leading "has 1+ open sessions" dot was dropped as redundant with the left-edge `open`/`active` bar (see States) — that bar already tells the same "is anything running here, and is it the one on screen" story for the 0/1-session modes, and `grouped` mode makes it visually obvious via the rendered `Sidebar Session Sub-item` list beneath the row. `--color-security` remains reserved for encryption/trust signals elsewhere (badge, sync status text) — see design.md.

### Variants
| Variant | When to use |
|---|---|
| default | Path exists and is valid |
| invalid | Path no longer exists on disk (edge case from FR-01) |

### Sizes
| Size | Height | Padding |
|---|---|---|
| default | auto (single text line + `--space-2` vertical padding — the path no longer occupies a permanent second line, see Anatomy) | `--space-3` horizontal |

### States
| State | Visual change |
|---|---|
| default (no open session) | bg transparent |
| hover / focus-visible | bg `--color-surface-elevated`; overflow menu button becomes visible (only in the 0/1-session modes — see Behavior); focus-visible additionally gets outline 2px `--color-focus`, offset -2px (inset, since the row is full-width) and reveals the path tooltip (`--z-tooltip`) — hover and mouse-triggered focus no longer do (v1.5 change, see Anatomy) |
| open (exactly 1 session open, and it is not the currently active tab) | left edge gets a `--border-width-sm` `--color-border-strong` bar — a quiet hint that left-clicking here will *switch*, not open a duplicate |
| active (exactly 1 session open, and it is the currently active tab) | left edge gets a `--border-width-md` `--color-primary` bar (supersedes the `open` bar); bg `--color-surface-elevated` |
| grouped (2+ sessions open) | no left-edge bar of its own (an individual sub-item carries `active` instead — see Sidebar Session Sub-item); row loses hover/pointer affordances that imply direct clickability, since it no longer performs a switch action itself |
| invalid | path tooltip text `--color-text-muted` (see Anatomy); row remains clickable but clicking shows an inline message instead of opening a tab |

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
- The row itself becomes non-interactive for switching: left-click does nothing (it no longer has one single tab to switch to), and it is **not draggable** (ambiguous — which of its sessions would be dragged?). It still renders normally otherwise (name, path) — it now reads as a group label for the `Sidebar Session Sub-item` list beneath it.
- Right-click / "⋮" Menu still works, still project-scoped: "Open in new tab" (adds another session to the group), Edit, Delete. No "Close terminal" here — with 2+ sessions, closing is unambiguous only per sub-item (see that component).
- Switching, closing, and dragging all move down to the individual `Sidebar Session Sub-item`s.

### Accessibility
- Row is a single focusable, actionable element (`role="button"` or native list-item button) in the 0/1-session modes; in `grouped` mode it is still focusable (for its Menu) but is not a button performing a switch action — its accessible role/behavior should reflect that it's inert for activation purposes (e.g. it can remain a heading-like static element with just its Menu control focusable within it).
- The full path is always available to assistive tech via an `aria-label`/`aria-describedby` on the row (e.g. `"${name}, ${path}"`), independent of the focus-visible tooltip — a screen reader user should never need to trigger a focus state to learn the path. The visual tooltip itself is `aria-hidden` (it would otherwise duplicate that announcement).
- Path validity (`valid`/`invalid`) is conveyed by both the tooltip text color and the inline error message shown on click, never by color alone.
- The `open`/`active` left-edge bars are a supplementary hint, not the only signal of that state.
- Drag has no keyboard equivalent — acceptable only because every outcome it can produce (spawn-into-split, move-into-split) is also reachable via `Split Pane Container`'s existing toolbar split buttons once a tab is already active, same rule as the original drag-to-split pattern.

### Do / Don't
- ✅ Do: reveal the path only on genuine keyboard focus (`:focus-visible`, not `:focus-within`), anchored near the row, not inline in the resting layout — keeps the row visually calm at rest (design.md Principle 1); the full, untruncated path is fine to show there since the tooltip isn't width-constrained like the row itself. Not on mouse hover, left-click, or right-click (v1.5 change) — the overflow menu button and background highlight remain hover-revealed, just not the path tooltip.
- ✅ Do: recompute the session-count mode reactively — a row must flip from `open`/`active` to `grouped` the instant a second session opens (e.g. via Menu → "Open in new tab"), not on next render/reload.
- ❌ Don't: use `--color-danger` for path invalidity anymore — de-emphasize with `--color-text-muted` instead, and reserve `--color-danger` for the inline "path no longer exists" error message only (v1.4 change — see States).
- ❌ Don't: reuse the `open`/`active` left-edge bar treatment for anything else — they must stay visually distinct from both the status dot and the invalid-path signal.
- ❌ Don't: let the status dot (project-scope: has an open session) and the left-edge bar (tab-scope: open/active) collapse into one signal — a project can have an open session (dot lit) while a *different* project's tab is the one currently active (no bar on this row) — they answer different questions and must stay two separate visual channels.
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

## Sidebar Folder (FR-11, v1.8)

**Purpose:** A user-organized, flat (non-nesting) container for grouping related `Sidebar Project List Item`s in the sidebar, created and managed entirely by drag-and-drop. Deliberately distinct from — and composable with — the automatic **"grouped (2+ sessions open)"** display mode described in `Sidebar Project List Item`'s States: that mode is about *session count* on one project; a Folder is about *user-chosen categorization* across many projects. A project can be inside a Folder and independently be in its own session-count "grouped" mode at the same time — the two nest (see Anatomy), never conflict.

### Anatomy
1. Header row — full-width, same row rhythm as `Sidebar Project List Item` (`--space-2` vertical / `--space-3` horizontal padding)
2. Expand/collapse chevron (leading) — "▾" expanded, "▸" collapsed, small icon-only control, same glyph-as-text convention as this app's other icons (✕, ⋮, ☰)
3. Folder name — `--text-sm` / `--weight-medium`; becomes an inline editable text field in the `renaming` state (see States)
4. Member count (trailing, muted) — e.g. "(3)", `--text-xs` / `--color-text-muted` — the one piece of wayfinding available while collapsed, since collapsing hides the member list entirely
5. Member list (below the header, rendered only while expanded) — an ordered list of `Sidebar Project List Item`s, each keeping its own existing anatomy/behavior completely unchanged (including still rendering its own `Sidebar Session Sub-item` list beneath it if it has 2+ open sessions — now nested one level deeper), indented under the folder header the same way a `Sidebar Session Sub-item` is indented under its parent project row today (no wrapping box/border — same flat-list convention, just one more indent level)

### Variants
| Variant | When to use |
|---|---|
| expanded | Default; shows the member list |
| collapsed | User has toggled the chevron; persists across restarts per folder (unencrypted preferences store — same mechanism FR-13's sidebar-position/theme prefs already use, per ADR-0011; the exact per-folder key shape is backend-implementer's concern) |

### Sizes
| Size | Height | Padding |
|---|---|---|
| default | auto (single text line + `--space-2` vertical padding — identical rhythm to `Sidebar Project List Item`) | `--space-3` horizontal |

### States
| State | Visual change |
|---|---|
| default | bg transparent |
| hover / focus-visible | bg `--color-surface-elevated`; focus-visible additionally gets outline 2px `--color-focus`, offset -2px (inset) |
| renaming | Folder name text is replaced by an inline text input, pre-filled with the current name and selected, `--border-width-sm` `--color-primary` border (same edit-affordance treatment as `Input`'s focus state) |
| drop target — reorder band (top/bottom ~25% of the header's height) | thin `--border-width-md` `--color-primary` horizontal line at the row's top or bottom edge, whichever band is hovered |
| drop target — merge band (middle ~50% of the header's height) | full header bg `--color-primary-bg-subtle`, `--border-width-md` `--color-primary` border around the whole header — **identical treatment to `Split Pane Container`'s drop-zone overlay**, reused deliberately rather than invented fresh (see Do/Don't) |
| invalid drop target | no overlay at all, "not-allowed" cursor — applies whenever the drag source is a `grouped`-mode `Sidebar Project List Item`, a `Sidebar Session Sub-item`, or another Folder header being dropped on the merge band of anything (see Behavior) |

### Behavior

**Creation:** Dragging a `Sidebar Project List Item` in its 0- or 1-session mode onto the **merge band** of another top-level project row (also 0/1-session, also not already in a folder) creates a new Folder containing both. The new folder is named after the **target** row — the one the cursor released onto (e.g. dragging "frontend-app" onto "backend-api" creates a folder named "backend-api" containing both). This is a deliberate, arbitrary-but-consistent default — the row that "stays put" under the cursor becomes the anchor name — flagged here as a judgment call, not a PRD-specified detail; revisit if a different default (e.g. always "New Folder") reads better in practice.

**Joining an existing folder:** Dragging a project row onto the merge band of **any** project row that already belongs to a folder, or onto a Folder header's merge band directly, adds the dragged project to that same folder — inserted immediately after the row it was dropped onto, or appended to the end if dropped on the folder header itself. This never creates a second, nested folder (folders are flat-only, ADR-0011) — it always resolves to "join this existing folder."

**Reordering:** Dropping on the **reorder band** (top or bottom ~25%) of any row — a project row or a Folder header — inserts the dragged item at that position instead of merging, within whichever list the target row lives in (top-level, or inside a specific folder). A Folder header is itself draggable for reordering its own top-level position among other folders/ungrouped projects this way, but is never a drag-to-split source and can never be dropped onto another row's merge band (a folder cannot join or be nested inside another folder).

**Moving out to top level:** Dragging a project row that's currently inside a folder onto empty list space below the last row, or a dedicated top-level "ungrouped" drop target at the top of the list, moves it back to top level (no longer any folder's member).

**Auto-delete when empty:** The instant a folder's member list reaches zero (its last project dragged out, or deleted via FR-01), the Folder header disappears from the list immediately — no confirmation, no visible empty state, since an empty folder cannot exist even momentarily in the underlying data model (ADR-0011).

**Rename:** **Right-click** anywhere on the folder header enters `renaming` (v2.4 change — it was left-click on the name through v2.3). `Enter` or blur commits the new name; `Escape` cancels, reverting to the previous name; committing an empty/whitespace-only name also reverts to the previous name rather than saving a blank label. Right-clicking *while already renaming* is left alone, so the text field keeps the webview's native cut/copy/paste menu.

The old left-click gesture made the row's most frequent action — expand/collapse — unreachable on the widest, most obvious part of the row, and dropped the user into an edit field they hadn't asked for. Right-click also matches `Sidebar Project List Item`, where right-click already means "act on this row" (its Menu). The asymmetry is deliberate and worth stating: the project row's right-click opens a Menu, the folder header's performs its single action directly, because a folder header has exactly one such action and a one-item menu is ceremony.

**Expand/collapse:** Clicking the chevron, **the folder name**, or any other part of the header body toggles `expanded`/`collapsed` (v2.4: the name is no longer carved out as a separate left-click target, since rename moved to right-click — the whole header row now does one consistent thing on left-click). State persists per-folder across restarts.

### Accessibility
- The header still exposes both actions (toggle collapse, edit name) without either being reachable only by accident, but v2.4 separates them by **gesture** rather than by target: left-click/`Enter` anywhere on the header toggles collapse, right-click renames. Since a right-click has no keyboard equivalent, the focusable name element carries **`F2`** as rename's keyboard path — the OS convention in file managers and IDE trees, and unlike the old `Enter`-on-the-name binding it cannot collide with activating the element's own collapse toggle. The name element keeps its `title="Right-click to rename"` hint so the gesture is discoverable rather than hidden.
- Member count is available to assistive tech via the header's accessible name (e.g. `aria-label="My Folder, 3 projects, collapsed"`), not conveyed by the visible "(3)" text alone.
- ⚠️ TBD: drag has no keyboard equivalent, consistent with every other drag interaction in this app — but every drag-only outcome here (create folder, join folder, reorder, move out) needs a non-drag equivalent (e.g. Menu actions "Move to folder…" / "Remove from folder") before this ships, since the PRD's acceptance criteria describe only the drag path. Flagged for resolution during backend-implementer/design-implementer's pass, not silently dropped.

### Do / Don't
- ✅ Do: reuse `Split Pane Container`'s exact drop-zone token pairing (`--color-primary-bg-subtle` fill + `--color-primary` border) for the merge band — one visual vocabulary for "you're about to combine into this" app-wide, not a second one invented for the sidebar.
- ✅ Do: distinguish reorder vs. merge by **geometry** (thin line vs. full-row fill), not color — both use the same `--color-primary` family, satisfying the "never convey state by color alone" accessibility rule for free (design.md §7).
- ✅ Do: keep a `Sidebar Project List Item` inside a folder fully unchanged in its own anatomy/behavior/states — a folder is purely a list-position/grouping concept; it never wraps or restyles the project row itself.
- ❌ Don't: make a `grouped`-mode (2+ open sessions) `Sidebar Project List Item` a folder drag source. It's already not a drag-to-split source for ambiguity reasons (that component's Behavior); this spec deliberately keeps "not draggable once grouped" a single uniform rule rather than making draggability conditional on which gesture is intended. Known limitation, accepted: the user must reduce a project to 0/1 open sessions before it can join or create a folder — one simple rule beats two purpose-conditional ones (design.md Principle 1); revisit only if this friction is actually felt in practice.
- ❌ Don't: show any drop-zone overlay on a `Sidebar Session Sub-item` — folders group projects, not individual sessions; sub-items are never folder drop targets, merge or reorder.
- ❌ Don't: invent a fourth drop geometry or a color-only reorder/merge distinction — the three-band split (top/middle/bottom) is the whole rule, the same discipline `Split Pane Container`'s Drop zones already applies by explicitly rejecting a fifth center zone.

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
| open, glass enabled (FR-14, v2.0) | as `open`, but bg `--color-menu-glass` + `backdrop-filter: blur(var(--glass-blur))` + a 1px top rim in `--glass-edge`. The menu's alpha range (`1.00 → 0.80`) is deliberately tighter than the Modal's (`1.00 → 0.40`) — a Menu floats directly over live terminal output with no `--color-backdrop` beneath it to damp bright content (design.md §4.6). Counter-intuitively the menu still reads as *more* see-through at its floor (143/765 vs the modal's 130/765), precisely because the modal's backdrop mutes what shows through — do not "fix" this by equalising the two ranges. Not emitted at all when `--glass-intensity` is 0 |
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
- ❌ Don't: reuse `--color-surface-elevated-glass` (the Modal's token) on a Menu because both surfaces are `--ink-850` at rest — the two tokens exist precisely because their safe alpha ranges differ 3× (modal reaches 0.40, menu stops at 0.80), and swapping them puts muted text below AA over bright terminal output at high intensity.
- ❌ Don't: nest a Menu inside a Menu, or open a Menu from within a Modal's own action (not a pattern this app uses anywhere — if a future feature seems to need it, that's a new pattern to design, not an extension of this one).

---

## Tab (terminal tab bar) — REMOVED in v1.4

**This component no longer exists.** FR-08 v1.4 removed the horizontal tab-bar widget entirely; the sidebar now owns everything this component used to do (open, switch, close, drag-to-split — see `Sidebar Project List Item` and `Sidebar Session Sub-item`). This section is kept as a stub, not deleted outright, so a search for "Tab" in this document finds an explanation instead of silence — see design.md's changelog (v1.3) for why it existed in the first place.

**Consequence for the signature gradient element:** the active-tab underline was one of the gradient's two exclusive homes (design.md Principle 2). With this component gone, the gradient (`--color-accent-gradient`) now appears in exactly **one** place app-wide: the Migration prompt's ambient glow (v3.0 — was "the unlock screen's," see design.md Principle 2's v3.0 re-examination for why it moved there and stayed). Sidebar Project List Item's and Sidebar Session Sub-item's `active` states use a **solid** `--color-primary` bar, not the gradient — deliberately not "promoted" to the gradient's old role, to avoid forcing a two-stop diagonal gradient onto a 2px-wide vertical bar where it would barely read as a gradient at all (see those components' States tables). design.md §2/§3/§4.1 are updated accordingly in this same change-set.

---

## Split Pane Container

**Purpose:** Holds one or more terminal instances for the currently active tab, arranged in a resizable horizontal/vertical grid (FR-08). Fills the entire main content area — with the tab bar removed in v1.4, there is no chrome above it.

### Anatomy
1. Grid container
2. Pane(s) — each wraps exactly one terminal instance (rendered by the `xterm.js` component, out of design-system scope beyond its container)
3. Divider(s) — draggable resize handles between sibling panes
4. Pane header — **always present** (changed in v1.4; used to appear only when 2+ panes existed). Shows the pane's working directory (mono, truncated) and a small close-pane button. This is now the *only* remaining "which project/session am I looking at" indicator anywhere in the app, since there is no tab bar to show a label — see Do/Don't. **v3.1:** also the drag handle for relocating the pane itself within its tab (see Behavior — Drag to move), whenever the tab has 2+ panes — carved out from the close-pane button, which keeps its own click behavior.
5. Drop-zone overlay (transient — only exists while a sidebar row/session sub-item, or another pane's own header, is being dragged over a pane — see Behavior — Drag to split / Drag to move)

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
| drop-zone active (a sidebar row/sub-item, or another pane, is being dragged over this pane) | see the dedicated drop-zone table below |
| pane header, draggable (v3.1 — its tab has 2+ panes) | cursor `grab` on hover over the header, outside the close-pane button |
| pane being dragged via its own header (v3.1) | opacity 0.4 on the whole pane while the drag is in progress — same treatment `Sidebar Session Sub-item`'s `dragging` state already uses, reused rather than invented fresh |

### Drop zones (drag-to-split targeting)

While a sidebar item (a `Sidebar Project List Item` in its 0/1-session mode, or a `Sidebar Session Sub-item`) is being dragged over a pane, that pane is divided by its two diagonals into **four triangular zones** — top, right, bottom, left — with no separate "center" zone. This is a deliberate simplification, not an oversight: this app has no per-pane tab strip for a center-drop ("add as a tab in this group," VS Code's convention) to mean anything — the sidebar itself is the only tab strip there is. Covering the whole pane with exactly four directional zones removes the ambiguous case by construction instead of specifying a dead zone.

**v3.1 — pane-to-pane drag reuses this exact same targeting.** When the drag source is another pane's own header instead of a sidebar item, the same four zones, same overlay treatment, and same directional mapping apply verbatim — see Behavior — Drag to move for what happens on drop (a relocation) instead of what's spawned/grafted.

| Zone | Trigger region | Visual feedback | Result on drop |
|---|---|---|---|
| Top | Upper triangle (between the two diagonals) | Overlay covers the top half: bg `--color-primary-bg-subtle`, `--border-width-md` solid `--color-primary` on the inner edge | Pane splits `column`; the dragged session becomes the new top sibling |
| Bottom | Lower triangle | Overlay covers the bottom half, same treatment | Pane splits `column`; the dragged session becomes the new bottom sibling |
| Left | Left triangle | Overlay covers the left half, same treatment | Pane splits `row`; the dragged session becomes the new left sibling |
| Right | Right triangle | Overlay covers the right half, same treatment | Pane splits `row`; the dragged session becomes the new right sibling |
| Invalid target (hovering a pane that belongs to the exact tab being dragged) | — | No overlay appears at all; cursor shows the platform's "not-allowed" affordance | Drop is rejected; the sidebar item returns to its normal state. Only applies when the drag source already has a live session (0-session sources have no "self" to collide with — every pane is a valid target for them) |
| Invalid target — dragging a pane onto itself (v3.1) | any zone of the pane currently being dragged | No overlay appears at all; cursor shows the platform's "not-allowed" affordance | Drop is rejected; the pane returns to its normal state. Only relevant to pane-sourced drags — a sidebar item never collides with itself this way |

The overlay's highlighted half previews the *resulting* pane's approximate bounds (half of the target pane), not the whole tab area — this stays accurate for a fresh split; when the drop lands on a pane that's already part of a same-direction split (auto-flatten, per `terminal.svelte.ts`'s `splitPane`), the preview still communicates "roughly here," which is sufficient given the actual final share is visible immediately after drop.

### Behavior
- Splitting a pane (via toolbar button, shortcut, or drag-to-split) divides it along the chosen axis; each resulting pane spawns its own independent PTY session — **except** drag-to-split from a source that already had a live session (a `Sidebar Project List Item` with 1 open session, or any `Sidebar Session Sub-item`), which reuses that exact session verbatim (nothing reconnects or flickers). Dragging a `Sidebar Project List Item` with **0** open sessions is the one case where drag-to-split *does* spawn a fresh session directly into the new pane — there's nothing existing to reuse (FR-08 v1.4).
- **Drag to split**: dropping a dragged sidebar item on a pane grafts (or spawns, per above) the session into the target tab's tree at the drop position (see the drop-zone table above for which edge maps to which split direction). If the source was a `Sidebar Project List Item` with exactly 1 session, that project's row updates to reflect it's now `active` wherever the graft landed. If the source was a `Sidebar Session Sub-item`, only that one sub-item's session moves — its siblings are unaffected. Dropping outside any pane is a no-op — no confirmation needed since nothing changed.
- **Drag to move (v3.1):** dragging a pane's own header (not a sidebar item) onto another pane relocates it. The dragged pane detaches from its current position in the tree — its sibling is promoted to fill the freed space, identical to the collapse that already happens when that pane is closed (see below) — then grafts at the drop position per the same directional zone mapping `Drag to split` uses. The exact PTY session moves with it; nothing reconnects or respawns, same guarantee sidebar-sourced drags with a live session already make. Because `Split Pane Container` only ever renders the active tab's own pane tree, this is inherently confined to panes within that one tab — there is no cross-tab case to define, unlike sidebar-sourced drags (which can already target any pane in the active tab regardless of which tab the dragged *session* itself belongs to). A pane that is the sole pane in its tab (the `single` variant) has no other same-tab pane to drop onto and is therefore not a drag source at all — same "no drag source with zero possible outcomes" rule `Sidebar Project List Item` already applies to its `grouped` mode. Dropping outside any pane, or back onto the position it started from, is a no-op.
- Dragging a divider resizes its two adjacent panes proportionally; other panes in the grid are unaffected.
- Closing a pane with a live foreground process shows a confirmation before closing (PRD FR-08 edge case, exact confirmation copy is a `⚠️ TBD` in the PRD — use the Modal spec until that copy is finalized). If it's the tab's last remaining pane, closing it closes the tab itself, same as using Menu's "Close terminal" or a `Sidebar Session Sub-item`'s close button.
- Only one pane can be "focused" at a time; clicking anywhere in a pane (including its terminal content) focuses it.

### Accessibility
- Pane focus state must be visually unambiguous even for a user glancing quickly — this is a UI component conveying essential information (which pane receives keystrokes), so its 3:1 non-text contrast requirement is verified in design.md §7.
- Dividers are keyboard-operable: focus a divider (`Tab`), resize with `Arrow` keys in fixed increments.
- Drag-to-split has no keyboard equivalent — acceptable only because every outcome it can produce is also reachable via the toolbar split buttons (for splitting) or Menu/`Sidebar Session Sub-item` actions (for opening/switching/closing), which remain the accessible path.
- **RESOLVED v3.2 (PRD FR-08 v1.17):** drag-to-move now has a keyboard equivalent — `pane.moveLeft`/`moveRight`/`moveUp`/`moveDown` (default Alt+Shift+Arrow*, architecture.md §5.6), relocating the *focused* pane one step in the given direction. Reuses `pane.moveFocus*`'s own geometric-neighbor lookup to find which pane is adjacent, then the same detach-and-graft `movePaneWithinTab` uses for the drag path — no separate mechanism, no new tree logic. Same no-op rules as `pane.moveFocus*`: does nothing at the edge of the grid, and does nothing when the focused pane is its tab's only one (nothing adjacent to relocate onto).

### Do / Don't
- ✅ Do: always show which pane is focused, even with only one pane in the tab (subtle is fine, but never absent) — consistency prevents the user from having to "hunt" for focus when they do split later.
- ✅ Do: always render the pane header (v1.4) — it is load-bearing now, not decorative; without a tab bar, it's the only place a project/path is visible once you're looking at the terminal area.
- ✅ Do (v3.1): reuse the exact same 4-zone drop overlay and "not-allowed" invalid-target treatment for pane-sourced drags as sidebar-sourced ones — one drop-zone vocabulary for the whole component, not a second invented for the new source type.
- ❌ Don't: let a pane shrink below its minimum size via drag — clamp the drag instead of allowing a pane to become unusably small.
- ❌ Don't: show a drop-zone overlay when the hovered pane belongs to the exact tab currently being dragged — that operation is invalid (a tree can't be grafted into itself) and must look unavailable, not just fail silently on drop.
- ❌ Don't: invent a fifth "center = move without splitting" zone — that reintroduces the per-pane-tab-strip concept this app doesn't have. If that capability is ever wanted, it's a new pattern to design deliberately, not a corner case to bolt on here.
- ❌ Don't (v3.1): let a single-pane tab's lone pane initiate a drag — it has no valid same-tab target, and a drag affordance with zero possible outcomes is worse than none (same rule `Sidebar Project List Item`'s `grouped` mode already follows).
- ❌ Don't (v3.1): let the pane-header drag handle swallow clicks meant for the close-pane button — carve it out of the draggable region exactly as sidebar rows already carve out their trailing controls.

---

## Modal / Dialog

**Purpose:** Focused, blocking interaction for a self-contained task: Add/Edit Project form, confirmations (close tab/pane with running process, delete project). The Migration prompt (v3.0, was "Unlock screen") is a **full-page** pattern, not a Modal (see Patterns).

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
| open, glass enabled (FR-14, v2.0) | container bg `--color-surface-elevated-glass` + `backdrop-filter: blur(var(--glass-blur))` + a 1px top rim in `--glass-edge`; backdrop layer unchanged (`--color-backdrop`). Alpha range `1.00 → 0.40` — wider than the Menu's because the `--color-backdrop` beneath already damps the content (design.md §4.6). Applies only when `--glass-intensity` > 0 — at 0 the container keeps solid `--color-surface-elevated`, drops the rim, and `backdrop-filter` is **not emitted at all** (NFR-9) |

### Behavior
- `Escape` closes non-destructive dialogs; for `confirm` dialogs guarding a destructive action, `Escape` is equivalent to Cancel (never to the destructive action).
- Clicking the backdrop closes `form` dialogs only if the form is unedited (pristine); if edited, backdrop click is a no-op and only explicit Cancel/close works — prevents accidental loss of typed data.

### Accessibility
- `role="dialog"`, `aria-modal="true"`, labelled by its header title.
- Focus moves to the first interactive element on open, and returns to the element that triggered the dialog on close.
- Focus is trapped within the dialog while open (`Tab`/`Shift+Tab` cycle within it).

### Do / Don't
- ✅ Do: put exactly one primary button in the footer (per the Button spec's rule) — **except** an all-autosave `form` dialog (v1.6: Settings Panel, see Patterns), whose footer holds only a dismiss action since there is no draft state to submit. This is the one documented exception; don't extend it to Add/Edit Project, which is explicitly not autosave (Behavior, above).
- ❌ Don't: use a `confirm` dialog for the Migration prompt (v3.0, was "Unlock screen") — it's a full-page pattern (see Patterns), not a dismissible overlay, since there is nothing behind it to see yet.

---

## Security Badge — REMOVED in v3.0

**This component no longer exists.** ADR-0014 removed master-password encryption entirely (project data is now a plain file, protected only by OS file permissions — the same protection level for every byte this app persists, no field-level distinction left). The badge made a true, specific claim while encryption existed ("this field's contents are encrypted, unlike the rest of the app"); once every field has identical protection, that claim can't be made honestly anymore — showing it everywhere would dilute it to decoration, showing it selectively would be arbitrary. Code already dropped both call sites (`Textarea.svelte`'s Notes field, and the old `UnlockScreen.svelte`) in the same change that removed the component file. This section is kept as a stub, not deleted outright, so a search for "Security Badge" in this document finds an explanation instead of silence — see design.md's Principle 3 (retired in place, same v3.0 change) for the full rationale, and its changelog entry for what else moved in the same pass.

**Consequence for `--color-security`/`--color-security-bg-subtle`:** not removed — repurposed. Their one surviving use in shipped code (`SettingsModal.svelte`'s Data-group export/import success flash) is a positive-confirmation signal now, unrelated to encryption. See design.md §3/§4.1 for the updated token role and why the CSS variable names themselves are deliberately left unchanged (a rename would require a code edit, out of scope for this documentation-only pass).

---

## Theme Preset Card (v1.6, FR-13)

**Purpose:** Lets the user pick one of the fixed terminal theme presets (design.md §4.5) — a self-demonstrating swatch, not an abstract color picker (there is no per-color custom picker in this app, by PRD decision).
**Use instead:** For a binary or small exclusive choice that isn't a color preview (e.g. sidebar position), use Segmented Control instead — don't force this component's visual weight onto choices that don't need a preview.

### Anatomy
1. Container — card, one per preset
2. Mini terminal preview — a small rectangle rendered in the preset's own `background`, showing 2–3 lines of sample mono text in `foreground` plus a short run of 4–5 ANSI colors (red/green/yellow/blue/cyan) as a compact swatch strip beneath the text — the preview *is* the proof, not a decorative stand-in
3. Preset name — below the preview, `--text-sm` / `--weight-medium`, `--color-text` (app-chrome text color, not the preset's own foreground — the label is UI chrome, not terminal content)
4. Selected indicator — checkmark icon, top-right corner of the card, shown only when selected

### Variants
None — one visual treatment; selection state is carried by States below, not a variant.

### Sizes
N/A — cards are laid out in a 2-column CSS grid (`grid-template-columns: repeat(2, 1fr)`, gap `--space-3`) inside the Settings Panel; width follows the modal's own content width, no fixed card width token needed. Card padding `--space-3`; mini preview fixed at a 16:9-ish rectangle sized to comfortably fit 2 lines of `--text-xs` mono text (implementer's call within that ratio — not pixel-critical, this is a preview, not real terminal content).

**v2.6 — the grid stays 2-column at 6 presets.** The roster grew from 4 to 6 (App Default, Dracula, Nord, Solarized Dark, Solarized Light, GitHub Light), i.e. 2 rows → 3 rows. Do not widen to 3 columns to "save vertical space": the Settings Panel body already scrolls (Modal `form` variant), and a third column shrinks each mini preview below the width where 2 lines of `--text-xs` mono text remain legible — which would defeat the preview's entire purpose (see Do/Don't). Vertical growth is free here; horizontal is not.

### States
| State | Visual change |
|---|---|
| default (not selected) | card border `--border-width-sm` `--color-border`, bg `--color-surface` |
| hover / focus-visible | card border `--color-border-strong`; focus-visible additionally gets the standard 2px `--color-focus` outline, offset 2px |
| selected | card border `--border-width-md` `--color-primary` (solid — **never** the gradient, see design.md §8); checkmark appears, `--color-primary` |

### Behavior
- Click selects the preset immediately — applies to every currently open terminal pane on click, no separate "Apply"/"Save" (Settings Panel autosaves per-control, see Patterns below). Exactly one card is selected at a time (radio semantics, not multi-select).
- No hover preview-swap of the panes behind the modal — the card's own mini preview is the only preview; committing is instant on click, matching this app's "perceived speed" principle (design.md Principle 1) rather than a two-step preview-then-confirm.
- **App Default's card is theme-aware (v2.6, design.md §4.5a).** It renders one card, not two, and its mini preview shows whichever variant the current chrome theme resolves to — so switching Appearance (Dark/Light/System) visibly re-renders this one card's preview while the other five stay put. Its label stays plain "App Default" in both themes: the card already *shows* which variant is active via the preview, so a "(Light)" suffix would restate what the swatch demonstrates. Selecting it persists the id `"app-default"` in both themes — never a variant-specific id.

### Accessibility
- Rendered as a radio-group (`role="radiogroup"` on the grid container, `role="radio"` + `aria-checked` per card), not plain buttons — this is a mutually-exclusive single choice.
- Arrow keys move selection between cards (same convention as Menu's item navigation); `Enter`/`Space` selects the focused card.
- Selection is conveyed by both the border color and the checkmark icon, never color alone.

### Do / Don't
- ✅ Do: render the mini preview using the preset's *actual* color values (background/foreground/a few ANSI colors) — it must be trustworthy evidence of what the terminal will look like, not a stylized abstraction.
- ❌ Don't: use `--color-accent-gradient` anywhere on this component, selected or not — see design.md §8.
- ❌ Don't: add a live full-app preview or a separate "Apply" step — selection is immediate (Behavior, above).
- ❌ Don't: render App Default as two separate cards ("App Default Dark" / "App Default Light") — it is one preset with one persisted id whose preview follows the chrome theme (design.md §4.5a). Two cards would imply two independently selectable settings and reintroduce the theme-dependent id §8 forbids.
- ❌ Don't: hard-code the mini preview's swatch text color to `--color-text` — the preview must use the *preset's* own `foreground`, which for a light preset is dark. A preview that stays light-on-dark while the real terminal renders dark-on-light is exactly the untrustworthy abstraction the first rule forbids.

---

## Keybinding Row (v1.6, FR-13)

**Purpose:** One row per rebindable action (architecture.md §5.6's 8-action registry — clipboard copy/paste, pane split-bottom/split-right, pane move-focus×4) — shows the action's current combo and lets the user capture a new one, with live conflict detection.
**Use instead:** This is specific to the fixed action registry; don't repurpose it for arbitrary "pick a value from a list" needs — use Menu for those.

### Anatomy
1. Action label — plain text, left-aligned, `--text-sm` `--color-text` (e.g. "Copy selection", "Split pane down")
2. Combo chip(s) — the current key combination, rendered as small monospace tags (one chip per key segment, e.g. separate `Ctrl` `Shift` `V` chips, or one combined chip — implementer's call, but always `--font-family-mono`, `--text-xs`, bg `--color-surface`, border `--border-width-sm` `--color-border-strong`, `--radius-sm`, padding `--space-1` `--space-2`)
3. Rebind trigger — trailing ghost `Button`, sm, label "Rebind"
4. Inline status text (conditional) — appears only during `recording`/`conflict`/`rejected` states, below the chip(s)

### Variants
None — states (below) carry all visual differentiation.

### Sizes
| Size | Height | Padding |
|---|---|---|
| default | auto (content height + `--space-2` vertical) | `--space-3` horizontal, matching other Settings Panel rows |

### States
| State | Visual change |
|---|---|
| default | as Anatomy |
| hover / focus-visible (row) | bg `--color-surface-elevated`; Rebind button becomes visible (hidden until hover/focus, matching Sidebar Session Sub-item's close-button convention) |
| recording | combo chip area replaced by a placeholder chip reading "Press a key combination…", border `--border-width-md` `--color-primary` (pulsing per `--duration-slow`, respects `prefers-reduced-motion` → static if reduced), Rebind button becomes a "Cancel" ghost button in its place |
| conflict (captured combo already used by another action) | placeholder chip gets `--border-width-md` `--color-danger`; inline status text below reads "Already used by {other action label}", `--color-danger`, `--text-xs`; recording stays active so the user can immediately try a different combo — it does not auto-cancel |
| rejected (captured combo has no Ctrl/Alt/Cmd modifier) | same visual treatment as `conflict`; inline text reads "Must include Ctrl, Alt, or Cmd" — recording stays active, same reasoning |
| saved (briefly, after a successful capture) | chip(s) update to the new combo; inline status text below reads "Saved", `--color-text-muted`, fades after 2s — identical convention to Textarea's autosave status |

### Behavior
- Clicking "Rebind" enters `recording`: the row starts listening for the next keydown. `Tab` and `Escape` are never captured as part of a binding — `Escape` always cancels recording (reverts to the previous combo, no save) and **does not** propagate to close the Settings modal; `Tab` always ends recording as a cancel and moves focus normally (protects the modal's own focus trap). This is a deliberate override of Modal's global Escape-closes-dialog behavior, scoped to exactly this row, exactly while recording.
- Any other keydown is captured as the candidate combo (`event.preventDefault()` is called unconditionally during capture — this row is actively "owning" the next keystroke, the same discipline `TerminalPane.svelte`'s clipboard handler now follows after its 2026-07-20 fix, generalized here to every capture).
- Validation order on capture: (1) reject if no Ctrl/Alt/Cmd modifier present → `rejected`; (2) else check against every other action's current combo → `conflict` if it matches one; (3) else commit — persist immediately (no separate save step, Settings Panel autosaves) and enter `saved`.
- The conflict/modifier check re-runs against the in-memory keybindings map on every capture attempt while still recording — the user can retry immediately without re-clicking "Rebind."

### Accessibility
- `recording`/`conflict`/`rejected`/`saved` status text changes are announced via a polite live region (design.md §7 — same convention as Textarea's autosave announcements).
- The row's accessible name includes the action label and its current combo (e.g. `"Copy selection, currently Ctrl+Shift+C"`), not just the label — a screen reader user should be able to identify the binding without visually parsing chips.
- "Rebind"/"Cancel" is a real, keyboard-activatable `Button` — recording can be entered and exited without a mouse.

### Do / Don't
- ✅ Do: keep recording active through a `conflict`/`rejected` rejection — forcing the user to re-click "Rebind" after every failed attempt is unnecessary friction this app's speed principle doesn't want.
- ❌ Don't: allow a combo with no Ctrl/Alt/Cmd to be captured — an unmodified letter key would fire on every normal keystroke typed into the terminal (see design.md §8). This is a hard rule, not a soft warning.
- ❌ Don't: silently overwrite the other action when a conflict is detected — always block and require the user to choose a different combo.

---

## Segmented Control (v1.6, FR-13)

**Purpose:** A small, exclusive choice between 2 (occasionally 3) plainly-labeled options where a preview isn't needed — used for Settings Panel's sidebar-position toggle (Left / Right) and, as of v2.5, its appearance toggle (Dark / Light / System) — the component's first real 3-option instance.
**Use instead:** For a choice that benefits from a visual preview (e.g. theme), use Theme Preset Card. For a longer list of options, use Menu instead — this component doesn't scroll or support more than a handful of options.

### Anatomy
1. Container — a single pill-shaped track holding all options, border `--border-width-sm` `--color-border-strong`, `--radius-md`
2. Option(s) — one segment per choice, equal width, text label only (no icon required)

### Variants
None for MVP — text-label segments only.

### Sizes
| Size | Height | Font |
|---|---|---|
| default | `--control-height-md` (32px) | `--text-sm` / `--weight-medium` |

### States
| State | Visual change |
|---|---|
| segment default (unselected) | bg transparent, text `--color-text-muted` |
| segment hover | text `--color-text` |
| segment selected | bg `--color-primary`, text `--color-on-primary` (same solid pairing as Button primary — verified contrast, design.md §7) |
| segment focus-visible | outline 2px `--color-focus`, offset 2px |

### Behavior
- Click (or `Enter`/`Space` when focused) selects a segment immediately — applies instantly, no separate save step (same autosave philosophy as the rest of Settings Panel). Exactly one segment is selected at all times; there is no "none selected" state.
- Selecting a segment moves the whole selected-segment background in a single `--duration-fast` transition, not an instant snap — this is feedback, not decoration, so it stays even under reduced motion (it's a one-shot transition, not a loop or pulse).

### Accessibility
- `role="radiogroup"` on the container, `role="radio"` + `aria-checked` per segment.
- `ArrowLeft`/`ArrowRight` moves selection between segments (wrapping at the ends); `Enter`/`Space` also activates the focused segment directly (not required to move focus first).

### Do / Don't
- ✅ Do: keep option count small (2, at most 3) — this is a compact toggle, not a substitute for Menu.
- ❌ Don't: use this for a choice that needs a preview (colors, images) — Theme Preset Card exists for exactly that case.

---

## Patterns

### Migration prompt (full-page, not a Modal) — v3.0, renamed from "Unlock screen"

**Shown conditionally, not on every launch.** ADR-0014 removed master-password encryption; this screen now appears **at most once, ever, per pre-existing installation** — only when `init_store` reports the data file is still in the pre-ADR-0014 encrypted format. A fresh install, or any machine that's already migrated, goes straight to the project list and never sees this pattern at all. Component: `MigrationPrompt.svelte`.

Centered card (max-width 360px) vertically centered in the viewport, background is the plain `--color-background` (no sidebar/chrome visible yet). Composition, top to bottom: app name ("Terminal Navigator", `--text-2xl`/`--weight-semibold`), an explainer line (`--text-sm`/`--color-text-muted`) stating plainly what's happening and that it's one-time — e.g. "Your existing project data is still in the old encrypted format. Enter your previous master password once to migrate it — you won't be asked again." — `Input` (password variant, label "Previous master password"), primary `Button` ("Migrate", full-width of the card, v3.0 — was "Unlock"), error text shown via Input's own error-state styling after a failed attempt (message "Legacy password is incorrect," per design.md §6). **No `Security Badge`** — removed in v3.0 along with the component (design.md Principle 3). The card sits on a very subtle radial application of `--shadow-glow-primary` behind it — this remains the **only** place the signature gradient glow appears anywhere in the app (design.md Principle 2, re-examined and kept in v3.0 for a new reason: this is now the app's rarest and highest-stakes screen, not its most universal one). Vertical rhythm between elements: `--space-6` between the explainer and the input, `--space-4` between input and button.

### Add/Edit Project form (Modal, `form` variant)
Field order top-to-bottom: Name (Input, default), Path (Input, path variant — Browse button per FR-02), Setup commands (Textarea, one command per line), Notes (Textarea). `--space-6` between fields. Footer: Cancel (secondary) then Save (primary). On open for "Edit", fields are pre-filled; on open for "Add", Path's Browse button is the first focused element (the primary entry method per the user's stated preference) rather than the Name field.

### Terminal split grid area (renamed in v1.4 — was "Terminal tab + split grid area")
No tab bar (removed v1.4). The active tab's `Split Pane Container` fills the *entire* main content area, edge to edge, from the top of the window down. Switching which tab is active (via the sidebar) swaps the entire pane grid instantly (panes belonging to inactive tabs keep their PTY sessions alive in the background per architecture.md §5.3 — switching must never feel like "loading", reinforcing NFR-7). When no tab is open at all (fresh unlock, nothing clicked yet), this area shows an empty state: centered text, `--color-text-muted`, `--text-sm`, e.g. "Select a project from the sidebar to open a terminal here."

**Background, v2.3:** the empty state's container paints `--color-background-scrim`, not plain `--color-background` — it is the scrim owner for this region per design.md §4.7's layering rule (nothing renders beneath it; `body` deliberately paints nothing). When a pane *is* open, `Split Pane Container`/`TerminalPane` owns the scrim instead (via `paneBackground()`) and the empty state isn't in the DOM at all — the two are mutually exclusive by the surrounding `{#if}`, so there is never a moment both paint at once.

### Title Bar (v2.8, ADR-0013)

**Purpose:** Replaces the native OS title bar entirely (`decorations: false`, ADR-0013) — this is the app's only window chrome, always rendered, full window width, fixed to the very top of the app shell above both the sidebar and the terminal area. Height `--titlebar-height` (36px — v2.8 revives the token orphaned since v1.3's tab-bar removal rather than defining a new one).

**Anatomy — three zones in a single row, `--space-3` horizontal edge padding, `--space-2` gap between buttons within a zone:**
1. **Left zone:** a ghost icon `Button` ("Settings", ⚙), then a ghost `Button` ("+ Add project") — same pairing and order as the sidebar footer's old `.add-row`, just relocated.
2. **Center zone**, horizontally centered in the *full window width* (not the space remaining after the side zones, so it stays visually centered regardless of how the left/right zones' widths differ): the project search `Input` (compact, sm size), then a ghost icon `Button` ("Hide sidebar" / "Show sidebar", state-dependent sidebar-panel glyph — v2.9, see Sidebar show/hide toggle below) at its trailing edge — the exact pairing the sidebar's old header row used, unchanged in behavior.
3. **Right zone, always right-anchored regardless of `settingsStore.sidebarPosition`:** three window-control buttons in fixed order — minimize, maximize/restore, close.

**Window controls (right zone) — states:**
| Button | Icon | Variant | Notes |
|---|---|---|---|
| Minimize | ─ | ghost, icon size | calls the window's minimize command |
| Maximize | □ | ghost, icon size | shown when the window is not maximized |
| Restore | ❐ | ghost, icon size | shown instead of Maximize when the window *is* maximized — the icon must track live window state (a resize/state-change listener, not just an optimistic flip on click), since the OS/WM can also change maximized state outside this button (double-click the bar, a WM snap gesture) |
| Close | ✕ | ghost, icon size, **scoped hover override** | same ✕ glyph already used for "close" everywhere else in this app (Modal, error-dismiss, session sub-item) |

The close button's hover is the one deliberate deviation from plain `ghost`: instead of ghost's usual `--color-surface-elevated` hover, it hovers to `--color-danger-bg-subtle` background with `--color-danger` icon color — matching the near-universal OS convention that the close control reddens on hover. This is a **component-local CSS override inside the Title Bar pattern only**, not a fifth `Button` variant — see Do/Don't.

**Behavior:**
- The empty space in each zone (anywhere not covered by an actual control) is the window's drag region — `data-tauri-drag-region="deep"` (not bare/unvalued) on the bar's root element, ADR-0013. Tauri's bare mode only counts a click as drag-region when the attributed element itself is the exact click target; since every zone is its own wrapping `<div>` between the root and its buttons, bare mode would silently miss the empty space *inside* a zone (e.g. the gap between ⚙ and "+ Add project") and only work in the wider gaps *between* zones. `deep` mode fixes that — any descendant with no clickable tag/role of its own (per Tauri's own `isClickableElement` check) still counts, so the whole documented "empty space in each zone" area works, not just the bar's outermost background.
- Double-clicking the drag region toggles maximize/restore automatically — this is Tauri's own native behavior for any element that resolves as a drag region (same mousedown handler that starts the drag also invokes `internal_toggle_maximize` on the second click), **not something this component implements itself**. Do not add a custom `dblclick` handler that also calls `toggleMaximize()` — it fires in addition to, not instead of, the native invoke, so one double-click ends up toggling twice and appears to do nothing.
- Resizing by dragging a window edge or corner is a **global app-shell behavior, not part of this component** — see design.md §5's resize-handle rule. The Title Bar's own bottom edge is not a resize handle.
- Sidebar-toggle behavior (click, hidden/shown state, icon) is unchanged from the pattern it was relocated from — see Sidebar show/hide toggle, below.

**Accessibility:**
- All six buttons are native `<button>` elements (the `Button` component) — full keyboard reachability (Tab order, Enter/Space activation) comes for free, same as everywhere else this component is used.
- Dragging to move or resize the window has no in-app keyboard equivalent — this is unchanged from the native-decorations baseline (window move/resize by mouse-drag has never had an app-level keyboard path) and OS-level window-management shortcuts (e.g. Alt+F7/F8 on Linux, Win+Arrow on Windows) are unaffected by `decorations: false` and remain the accessible path.
- Icon-only buttons keep explicit `aria-label`s ("Minimize", "Maximize"/"Restore" — matching current state, "Close").

**Do / Don't:**
- ✅ Do: keep the window-control trio right-anchored and in minimize → maximize/restore → close order on every platform — ADR-0013 chose one uniform layout, not a macOS-specific reordering.
- ✅ Do: implement the close button's hover as a scoped override local to this component.
- ❌ Don't: add a fifth `Button` variant (e.g. `"window-close"`) for the close hover — that widens every other `Button` call site's decision space for a treatment exactly one button in the whole app needs.
- ❌ Don't: let the maximize/restore icon go stale after an external state change (WM snap, double-click, OS shortcut) — it must reflect live state, not just the last click made through it.
- ❌ Don't: use bare `data-tauri-drag-region` (no value / `"true"`) on the bar's root expecting it to cover every zone's empty space — Tauri only treats that as a match when the attributed element itself is the click target, so it silently misses empty space inside a zone. Use `="deep"` — see Behavior above.
- ❌ Don't: add a custom `dblclick` handler that calls `toggleMaximize()` — Tauri already does this natively for any valid drag region; a second handler double-toggles and the window appears not to respond.
- ❌ Don't: assume the fix above is proven correct from code review alone — `data-tauri-drag-region`/native double-click handling are resolved below the DOM (wry/the window manager), invisible to jsdom and to reading the code. Verify empty-space dragging and double-click-to-maximize manually (this is exactly the class of launch/environment-dependent behavior `docs/qa/test-plan.md` §5.1's charter exists for).

### Sidebar layout
Fixed width 260px. Spec calls for collapsing to a 56px icon-only rail below `--bp-sidebar-collapse` (automatic, no manual control) — **❌ not yet implemented**: the token is defined in tokens.css but as of v1.4 nothing in `src/` reads it (no media query/logic wires it up). Treat this as a known gap, not a working baseline to build on top of, until it's actually built.

**v2.8:** the sidebar is now list-only — no header, no footer. It sits directly below the Title Bar and contains nothing but the scrollable list of top-level entries — each either a `Sidebar Project List Item` (optionally followed by its `Sidebar Session Sub-item` list when it has 2+ open sessions) or a `Sidebar Folder` header (optionally followed by its own indented member list, per that component's Anatomy) interleaved in one user-orderable sequence (FR-11, v1.8) — the list's total height is therefore dynamic, not fixed-row-height; the scroll container already handles this, no extra layout work needed. Search, the sidebar-toggle button, "+ Add project", and Settings all moved to the new Title Bar pattern above; Export/Import moved into the Settings Panel's new Data group (below). Nothing replaces them here — an empty header/footer would be dead chrome.

### Sidebar show/hide toggle (v1.4, icon updated post-FR-13, trigger set reduced v2.8, icon updated again v2.9)
A manual, user-driven, fully-implemented control — intentionally on a separate axis from the (currently unimplemented, see Sidebar layout above) breakpoint collapse: that one is "narrow window, still present as an icon rail", this one is "fully hidden, 0px, gone until brought back." When the breakpoint collapse above does get built, it and this toggle should keep working independently of each other. Two triggers as of v2.8 (was three), same state.

**v2.9:** the hamburger (☰) is replaced by a sidebar-panel glyph, and the icon is state-dependent again (unlike the v1.7 hamburger, which was deliberately one consistent glyph): an outline "collapse" icon when the sidebar is shown (the available action is hide), a filled "expand" icon when it's hidden (the available action is show). Both are inline SVG (`viewBox 0 0 24 24`, 16×16 display), `currentColor`-based so they follow `.btn-ghost`'s existing text-color/hover rule with no extra styling. This is a narrower reversal than it looks: v1.7 dropped state-dependence specifically to avoid a *directional* swap tied to `settingsStore.sidebarPosition` (◀ needing to become ▶ depending on which side the sidebar is docked). This icon still doesn't encode direction — both variants are left/right-agnostic — so it stays independent of sidebar position exactly as the hamburger did; only the icon's *style* (outline vs. filled), not orientation, changes with state.
1. A ghost icon `Button` in the Title Bar's center zone (trailing edge of the search field) — reachable regardless of whether the sidebar is currently shown or hidden, since the Title Bar itself is always rendered; hides or shows it.
2. The rebindable `sidebar.toggle` keybinding (design.md v2.7, default Ctrl+B, architecture.md §5.6) — flips the same state as the button above; no new visual affordance, works from either hidden or shown state, and unlike every other keybinding action does not require an active tab/pane to exist.

**Removed in v2.8:** the small floating ghost icon `Button` that used to sit fixed to the app shell's top corner (`--z-dropdown`), rendered only while the sidebar was hidden, was the sole way to bring the sidebar back once trigger 1 above lived *inside* the sidebar itself and disappeared with it. Now that trigger 1 lives in the always-visible Title Bar instead, it already reaches the hidden state directly — the floating button became a second control doing exactly the same thing, so it is removed rather than kept as a redundant fallback. `+page.svelte`'s `reveal-sidebar-wrap` and its CSS are dead code to delete, not a pattern to keep implementing.

No animation requirement beyond the existing transition tokens (Principle 1: perceived speed over decoration) — an instant width/visibility change is preferable to a slide that delays the terminal area reclaiming the space.

### Sidebar drag-to-split (renamed in v1.4 — was "Tab drag-to-split")
*Note: this is one of two things a sidebar drag can now mean — dropping over a `Split Pane Container` pane (this pattern) vs. dropping over another sidebar row (`Sidebar Folder`'s Behavior, FR-11 v1.8). Same drag gesture and drag source, disambiguated entirely by what's under the cursor at drop time, same as the reorder-vs-merge disambiguation within the folder pattern itself.*
1. User presses and moves a `Sidebar Project List Item` (in its 0- or 1-session mode) or a `Sidebar Session Sub-item` past the browser's native drag threshold → the dragged element enters its `dragging` state (opacity 0.4); a translucent drag image follows the cursor. A `Sidebar Project List Item` in its `grouped` (2+ session) mode is not draggable at all — see that component's Behavior.
2. As the cursor moves over any `Split Pane Container`, the pane directly under the cursor computes which of its four triangular zones (Split Pane Container's Drop zones table) the cursor is in, and shows that zone's overlay. Moving between panes, or between zones within one pane, updates the overlay live — only one overlay is ever visible at a time.
3. If the drag source already has a live session and the cursor is over the pane holding that exact session, no overlay appears (invalid target, "not-allowed" cursor) — the same self-graft guard as before. A 0-session source has no such pane, so every pane is a valid target for it.
4. On drop over a valid zone: if the source had a live session, it grafts into the target pane's position, split along that zone's direction, and is reused (not respawned) — nothing reconnects or flickers. If the source had no session yet (a `Sidebar Project List Item` with 0 open tabs), a fresh one spawns directly into that new pane position instead. Either way, the target tab becomes active and the overlay clears.
5. On drop anywhere invalid (outside a pane, or on the source's own pane): no-op, the dragged element returns to its normal state — this is the browser's native drag-cancel behavior, not a custom animation to build.

This pattern has no dedicated component of its own — it's existing `Sidebar Project List Item`, `Sidebar Session Sub-item`, and `Split Pane Container` states composed into one interaction, which is why it's documented here rather than as a new spec entry.

### Settings Panel (v1.6, FR-13 — Modal, `form` variant)

Reuses Modal's existing `form` variant chrome as-is (480px, `--modal-width-form`, scrollable body) — no new modal size needed. Opened from the Title Bar's ⚙ `Button` (v2.8 — was a sidebar footer button through v2.7; see Sidebar layout, above). **Five groups (v3.0 — was six; the "Master password" group was removed, ADR-0014)**, top to bottom, each separated by `--space-6` and a `--text-lg`/`--weight-semibold` section heading (same title treatment as the Modal header itself, one step down in the hierarchy):

1. **Appearance** (v2.5) — one `Segmented Control` ("Dark" / "Light" / "System"), design.md §4.1a. Deliberately its own group, not folded into "Theme" below — this controls app-chrome color, §4.5 draws an explicit, load-bearing line between that and the terminal color presets in the next group, and collapsing the two headings would blur a distinction the design system otherwise goes out of its way to keep visible.
2. **Theme** — a `Theme Preset Card` grid (2 columns), one card per design.md §4.5 preset: App Default, Dracula, Nord, Solarized Dark, Solarized Light, GitHub Light (6 as of v2.6 — grid stays 2-column, see that component's Sizes). This group governs **terminal content** colors only; the Appearance group above governs app chrome. The two are deliberately separate systems (design.md §4.5), with exactly one link between them: App Default's card follows the Appearance setting (§4.5a).
3. ~~**Master password**~~ — **removed, v3.0 (ADR-0014).** Previously three `Input` (password variant) fields plus a `Security Badge` and a scoped "Change password" submit button — the app's master password concept no longer exists (ADR-0005/ADR-0010, its architectural basis, are both superseded by ADR-0014), so there's nothing left to rotate here. Kept as a stub line rather than silently renumbered away, so a reader following an old reference to "group 3" finds an explanation instead of a mismatch.
4. **Keybindings** — a list of 8 `Keybinding Row`s, one per architecture.md §5.6's registry, grouped visually by area (Clipboard: copy/paste; Panes: split-bottom/split-right/move-focus×4) via a `--text-xs`/`--color-text-muted` sub-label, not a second heading level. A single `--text-xs`/`--color-text-muted` helper line under the section heading sets expectations honestly: "Some combinations may be intercepted by your desktop environment before this app sees them" — a plain disclaimer rather than attempting per-combo OS-reserved detection, which isn't reliable enough across platforms to promise (see architecture.md risk #5).
5. **Sidebar position** — one `Segmented Control` ("Left" / "Right").
6. **Data** (v2.8, relocated from the sidebar footer — FR-07 export/import, ADR-0008) — two `Button` (secondary, sm), "Export" and "Import", same pairing/order as before. Below them, the same status affordances the sidebar footer used to own, carried over verbatim rather than redesigned: a `--text-xs`/`--color-security` success flash ("Exported" / "Imported — project list replaced", fades after 3s — v3.0: `--color-security` here is now a plain positive-confirmation signal, not an encryption-trust one, see design.md §3) and an error banner (`--color-danger` text + a ✕ dismiss button, auto-clears after 8s — longer than the success flash, per design.md's v2.4 rule that an error carries a reason that has to be read). **Scoping change from v2.7:** this state now lives inside a modal instead of always-visible chrome, so it resets (clears any pending flash/error) whenever the Settings Panel closes — a stale "Exported" flash or dismissed error should never reappear the next time the modal is reopened.

(Group numbers 4–6 are kept as originally assigned rather than renumbered down to 3–5, matching the stub convention above — group 3 is a deliberate gap, not a typo.)

**Every group in this modal autosaves per-control** (the Appearance Segmented Control, Theme Preset Card selection, every Keybinding Row capture, the Sidebar position Segmented Control) — **unconditionally, as of v3.0.** Before ADR-0014, master password change was the one exception (its own explicit, scoped submit button, since it had real hard-to-reverse consequences); with that group gone, the modal is now a clean, single-pattern instance of the autosave philosophy the design system already applies to Notes/Textarea, with no exception left to carve out. **Data's Export/Import buttons remain their own third category** — not a saved setting at all, just a one-shot triggered action (like a `Button` anywhere else in the app), so "autosave vs. explicit submit" doesn't apply to them either way.

**Footer:** a single `Button` (secondary, "Done") — dismiss only, since nothing here needs a global "Save." `Escape` and backdrop-click both close the modal unconditionally (no pristine-check gate, unlike Add/Edit Project) — every applied setting is already saved the instant it was changed, so there's no accidental-data-loss risk the pristine gate exists to prevent elsewhere.

**Escape precedence:** while any `Keybinding Row` is in its `recording` state, `Escape` is consumed by that row (cancels recording) and does not reach the Modal's own Escape-to-close handler — see Keybinding Row's Behavior. Modal's normal Escape-to-close resumes the instant no row is recording.
