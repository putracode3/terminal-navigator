# ADR-0012: Create the window transparent unconditionally; control see-through in CSS

- **Status:** accepted
- **Date:** 2026-07-22
- **Drivers:** FR-15, NFR-10, CON-6, NFR-8, NFR-7

## Context

FR-15 makes the app window itself see-through to the desktop (the real window transparency Tilix has), with a user-adjustable intensity in the Settings modal that must apply **immediately, without an app restart**, and persist across restarts.

Two facts about the stack decide the shape of this, and both were measured rather than assumed:

1. **`transparent` is a window-*creation* attribute, not a runtime setting.** In `tauri` 2.11.5 it exists only as a builder method (`WebviewWindowBuilder::transparent`, `WindowBuilder::transparent`) — there is no `set_transparent()`. Underneath, `tao` 0.35 requests the GDK RGBA visual and calls `set_app_paintable` at window construction (`platform_impl/linux/window.rs`), and `wry` 0.55 sets the webview background to alpha-0 at webview construction (`webkitgtk/mod.rs`). None of that can be re-decided once the window exists. A runtime `set_background_color()` *does* exist on `Window`/`Webview`/`WebviewWindow`, but it cannot retroactively give a window an RGBA visual it was not created with.

2. **The window flag was never the blocker.** An initial spike concluded that Tauri's `"transparent": true` "does not work" on this stack and that native GTK/WebKitGTK work would be required. **That conclusion was wrong** (PRD §4.3 records the correction). The flag worked; the *CSS root layer* was still painting an opaque canvas, because only `body` had been made transparent while `<html>` kept an opaque background.

Evidence from the corrected spike, using the pixel-measurement method this project already relies on (see ADR-0006's revisit, which caught a rendering defect the same way):

- The spike window reported **Depth 32** — an RGBA visual — against a control `xterm` at Depth 24.
- Its empty regions read `srgb(5,5,7)`, exactly `0.35 × #0D0F14`: the app's own `rgba(…, 0.35)` layer compositing over **alpha-0**, not over a solid colour. A window painting an opaque canvas would have read `#0D0F14` itself.

**Not yet visually confirmed:** that the desktop is actually seen through the window. XWayland blocks screen-level capture in this environment (`import -window root` and `import -screen` both fail), so the composited result cannot be captured from the harness. The measurements above establish that the app produces a correctly transparent surface; whether the compositor then blends it is CON-6's territory and must be confirmed by eye on a real build.

## Options considered

### Option A — Toggle `transparent` per the user's setting
Set the window flag from the persisted preference at startup. Matches intuition ("the setting controls transparency"), and a window that the user has turned the effect off for is a plain opaque window with no RGBA visual at all.

Fatal against FR-15: the flag is creation-time only, so every change of the slider would require **recreating the window or restarting the app** — directly violating FR-15's "applies immediately, without an app restart" criterion, and destroying every running PTY session in the process (ADR-0007: sessions live in the backend but the webview holds their rendered buffers).

### Option B — Create the window transparent **always**; express intensity purely in CSS
`"transparent": true` is a fixed, unconditional property of the window in `tauri.conf.json`. The user's setting never touches it. What the slider actually drives is the alpha of the app's own root background layer — CSS, live, no restart. "Off" is that layer at alpha 1.0, which is visually identical to a conventional opaque window.

Cost: the window always carries an RGBA visual and `app_paintable`, even for a user who never enables the effect.

### Option C — Two windows, or window recreation on change
Recreate the window when the setting changes, preserving state across the swap. Technically satisfies "no restart" in a narrow sense, but requires re-attaching every webview/terminal view and is a large amount of machinery for a cosmetic preference. Rejected on principle 2 (simplest architecture meeting the NFRs) — it buys nothing Option B does not already deliver.

## Decision

**Option B.** `"transparent": true` is set unconditionally in `tauri.conf.json`'s window definition and is never varied at runtime. The window is created transparent-capable on every launch, for every user.

Consequences of that being unconditional:

- **The app must always paint its own background.** Because the window no longer supplies an opaque canvas, the CSS root layer becomes load-bearing: if it is ever fully transparent by accident, the app renders as a floating ghost. The root background is therefore an app-controlled value (driven by the FR-15 intensity), never `transparent` outright — see NFR-10.
- **No Rust-side window-builder code is introduced.** The window is still declared entirely in `tauri.conf.json`, as it is today; this ADR adds one key to that file and no new module. The intensity value itself rides the existing `settings_store` path (ADR-0009) as another non-sensitive preference readable before unlock (NFR-8) — the same treatment FR-14's glass intensity already gets.

### PRD Q13 — `color-scheme: dark` stays

Q13 asked whether `<html>`'s `color-scheme: dark` had to be removed, since it was present when the original spike failed and it exists to drive native form-control rendering (notably the master-password field).

**It stays.** Tested directly: with `color-scheme: dark` retained *and* an explicit `background: transparent` added to `<html>`, the window still measured Depth 32 with empty pixels at `srgb(5,5,7)` — identical to the run where `color-scheme` had been removed. The declaration is not in conflict with transparency; what defeated the original spike was the *absent explicit background* on the root element, not `color-scheme` itself. The earlier spike changed both at once and so could not distinguish them.

Rule for implementers: **do not remove `color-scheme: dark`** to "fix" transparency. Set an explicit background on the root instead. Removing it would regress native form-control and scrollbar rendering — including the password field — for no transparency benefit.

## Consequences

- FR-15's "applies immediately, no restart" is satisfied without any window-lifecycle machinery; the whole feature is a CSS variable plus a persisted number.
- **CON-6 (compositing WM required) becomes a property of the app as shipped, not of a user setting.** On a non-compositing WM the RGBA visual is simply not honoured and the window renders opaque — the safe direction, and the same prerequisite Tilix carries. The app cannot reliably detect in advance whether compositing will occur, so it must not try to branch on it; it renders the same way either way and lets the compositor decide.
- Because the window is always transparent-capable, **any future bug that makes the root background transparent becomes visible as a see-through app rather than a black screen** — a louder, easier-to-diagnose failure than the silent black-canvas failure that misled the first spike.
- NFR-7: no measurable cost is expected from the RGBA visual itself; the cost of the feature is compositing work the WM does. This has not been measured, and unlike FR-14's `backdrop-filter` it is not per-frame app work.

**Revisit trigger:** if the always-transparent window is found to cost measurable performance on a non-compositing system, or if a Tauri release adds a genuine runtime transparency setter, revisit Option A — the decision here is forced by the creation-time-only constraint, so removing that constraint invalidates the reasoning. Verify any such change with the Depth-32 + pixel-value method used here, not by "it looks fine".
