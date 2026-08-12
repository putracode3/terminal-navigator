# ADR-0013: Disable native window decorations; render custom window controls in-app

- **Status:** accepted
- **Date:** 2026-07-29
- **Drivers:** direct user request (no PRD FR yet, same category as design.md's v1.4 sidebar-toggle pattern), CON-5

## Context

The user wants an in-app top bar carrying search, sidebar toggle, settings, and add-project, with the window's minimize/maximize/close controls rendered as custom buttons anchored to its right edge — replacing the OS-drawn title bar entirely, not sitting alongside it.

`tauri.conf.json`'s `main` window currently omits `decorations`, which defaults to `true`: the OS still draws its own title bar and control buttons above the app's content. A custom, app-styled control triplet cannot be drawn *inside* a native decoration — Tauri only exposes an all-or-nothing switch (`decorations: true|false`), set at window-creation time in `tauri.conf.json`, the same shape ADR-0012 already established for `transparent`. There is no partial mode ("native frame, custom buttons").

Removing native decorations also removes two things the OS/WM was doing for free: dragging the window by its title bar, and resizing it by grabbing an edge. Both must be re-implemented in the frontend once `decorations: false` is set, or the window becomes effectively immovable and fixed-size despite `resizable: true` staying in config.

CON-5 (`docs/backend/architecture.md` §2): primary target OS is Linux; Windows/macOS support is optional and, per architecture.md risk #4, not yet tested at all.

## Options considered

### Option A — Keep native decorations (status quo)
No config or permission change. Rejected outright: it cannot produce the requested custom, right-anchored control set — native decorations are drawn by the OS/WM, not the app, and are not stylable from web content.

### Option B — `decorations: false` uniformly on every platform; one custom control set, always right-anchored
A single code path: the window is borderless everywhere, the frontend draws one title-bar pattern with the same button positions regardless of OS. Matches the request literally ("still make in right") and CON-5's Linux-primary stance — Windows/macOS, already flagged as untested (architecture.md risk #4), simply inherit the same chrome rather than a second, unverified code path.

### Option C — Platform-idiomatic hybrid
`decorations: false` with custom right-aligned controls on Windows/Linux, but a macOS-specific path using Tauri's overlay title-bar style to keep native traffic-light buttons (left-aligned, OS-drawn) while still exposing a draggable region. More native-feeling on macOS, but doubles the chrome implementation and manual-verification surface (this project's launch-environment charter, `docs/qa/test-plan.md` §5.1, already treats environment/platform-dependent chrome as a real bug class per the `ec19eff` incident) for a platform CON-5 explicitly deprioritizes and architecture.md risk #4 records as not yet run at all.

## Decision

**Option B.** `decorations` is set to `false` unconditionally on the `main` window in `tauri.conf.json`. One custom window-control pattern (minimize / maximize-or-restore / close, right-anchored) renders on every platform; no OS-specific branch.

Frontend capabilities are added to `src-tauri/capabilities/default.json`. `core:window:default` (granted via `core:default`) is almost entirely read-only queries (`is-maximized`, `is-decorated`, …); its **one** state-changing member is `allow-internal-toggle-maximize` — which matters, see the correction below. Trimmed during implementation to exactly what the frontend calls, not the broader set originally drafted here — a Tauri capability is a real attack-surface control (limits what the webview can invoke over IPC), so an unused grant is cost with no offsetting benefit, not harmless margin:

- `core:window:allow-minimize`
- `core:window:allow-toggle-maximize` — covers both directions from one control (`toggleMaximize()`); `allow-maximize`/`allow-unmaximize` are **not** granted since nothing calls those commands individually
- `core:window:allow-close`
- `core:window:allow-start-dragging` — **required by the declarative drag region**, see the correction below
- `core:window:allow-start-resize-dragging` — resizing by dragging an edge/corner is normally supplied by the OS/WM; with decorations off, nothing grants it unless the frontend adds its own resize-handle regions that call this command

### Correction (2026-07-29, same day — found by the first manual run of `docs/qa/test-plan.md` §5.1 step 6)

This ADR originally stated that `core:window:allow-start-dragging` was **not** needed, on the premise that "the declarative `data-tauri-drag-region` attribute is read by wry directly at the webview level, not through the Tauri command/permission pipeline." **That premise is false**, and it made the window unmovable.

Tauri's injected drag script (`tauri-2.11.5/src/window/scripts/drag.js`, verified on disk for the exact pinned version) resolves the drag region in JS and then invokes an ordinary IPC command:

```js
const cmd = e.detail === 2 ? 'internal_toggle_maximize' : 'start_dragging'
window.__TAURI_INTERNALS__.invoke('plugin:window|' + cmd)
```

The attribute only decides *whether* to invoke; the invoke itself is fully subject to capability permissions. With `allow-start-dragging` withheld, every single-click drag was denied and the window could not be moved at all.

Double-click-to-maximize kept working throughout and **masked the bug**: it dispatches `internal_toggle_maximize`, the one state-changing command already inside `core:window:default`. That divergence — declarative gesture works, drag doesn't, both from the same attribute — is the diagnostic signature of this failure.

**Generalized rule:** in Tauri v2 a declarative `data-tauri-*` attribute is a *trigger*, not a permission bypass. Any window-state change it produces still needs its command's permission granted.

No new Rust module and no new Tauri command are introduced — same shape as ADR-0012 ("one key in `tauri.conf.json`, no window-builder code"). Everything here is either static config or calls through `@tauri-apps/api/window`'s existing JS surface.

## Consequences

- The requested chrome (custom right-anchored min/max/close, in-app top bar) becomes buildable; this ADR unblocks ui-ux-designer's title-bar pattern spec and design-implementer's build of it.
- Composes cleanly with ADR-0012: that ADR already makes the window unconditionally transparent-capable; this one only changes who draws the frame around that already-transparent surface. Neither decision touches the other's config key.
- **Negative:** window dragging and edge/corner resizing, previously free from the OS, must now be built explicitly in the frontend (a `data-tauri-drag-region` area in the new top bar; resize-handle regions at the window edges calling `startResizeDragging`) — flagged here as an implementation obligation for ui-ux-designer/design-implementer, not a detail to discover late.
- **Negative:** double-click-on-title-bar-to-maximize is no longer automatic and must be wired explicitly on the drag region if wanted.
- **Negative:** on Windows and macOS, the app now visibly departs from native window-chrome convention (no Snap-layout flyout on the maximize button, no left-aligned traffic lights) — accepted per CON-5, and adds no *new* platform risk beyond what architecture.md risk #4 already carries as untested/optional.
- **Revisit trigger:** if the author actually starts building and testing on Windows or macOS (architecture.md risk #4's own trigger) and the uniform chrome reads as genuinely wrong there, revisit toward Option C's hybrid.
