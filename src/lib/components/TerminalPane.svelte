<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { listen } from "@tauri-apps/api/event";
	import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
	import { Terminal } from "@xterm/xterm";
	import { FitAddon } from "@xterm/addon-fit";
	import { fitTerminal } from "$lib/terminal-fit";
	import { WebLinksAddon } from "@xterm/addon-web-links";
	import "@xterm/xterm/css/xterm.css";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { writeTerminal, resizeTerminal } from "$lib/api";
	import { getThemePreset, withWindowTransparency, paneBackground } from "$lib/theme-presets";
	// design.md §9 rule 11: App Default is theme-aware, so every preset lookup
	// here needs the RESOLVED chrome theme (not settingsStore.themeMode, which
	// may be "system"). This is the single resolution point for terminal
	// content — no other component branches on theme.
	import { themeStore } from "$lib/stores/theme.svelte";
	import { matchesCombo } from "$lib/keybindings";
	import { settingsStore } from "$lib/stores/settings.svelte";
	import { getTerminalHandle, registerTerminalHandle, type TerminalHandle } from "$lib/terminal-registry";

	let {
		sessionId,
		focused = false,
		active = true,
		onFocus,
		onExit,
	}: {
		sessionId: string;
		focused?: boolean;
		/** Whether this pane's tab is the one currently shown in the terminal
		 *  area (see TerminalArea.svelte — every open tab's tree stays mounted
		 *  so a backgrounded session's xterm.js buffer is never lost, only the
		 *  active tab's is visible). Gates the focus effect below so a
		 *  backgrounded pane can't steal real browser keyboard focus, and so
		 *  switching back to a tab re-focuses its pane even though `focused`
		 *  itself didn't change while it was hidden. */
		active?: boolean;
		onFocus: () => void;
		/** Called when the shell exits on its own (user typed `exit`, the
		 *  shell crashed, etc.) — the backend has no scrollback to replay and
		 *  will send no more output, so the pane should close the same way it
		 *  would if the user clicked "Close pane" themselves. */
		onExit: () => void;
	} = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let term: Terminal | undefined;
	let fitAddon: FitAddon | undefined;
	/** The session's persistent resources (xterm.js `Terminal`, its
	 *  scrollback, its PTY subscriptions) — created once per session id, then
	 *  reused across any number of `<TerminalPane>` remounts. See
	 *  `$lib/terminal-registry`'s own doc comment for why this indirection
	 *  exists at all: some tree restructurings (a perpendicular split on an
	 *  already-split tab, a drag-to-split graft) force Svelte to destroy and
	 *  recreate this component even though the underlying shell session never
	 *  closed, and no amount of `{#each}` keying can prevent that — the
	 *  restructuring moves the leaf's key into an `{#each}` block that didn't
	 *  exist a moment ago. */
	let handle: TerminalHandle | undefined;
	/** FR-13 follow-up (terminal.zoomIn/zoomOut, architecture.md §5.6):
	 *  per-*session* (via `handle.fontSize`, so it survives the remounts
	 *  above the same way scrollback does), not persisted across app
	 *  restarts. Falls out naturally from where the keyboard handler already
	 *  lives — `attachCustomKeyEventHandler` only fires for whichever pane
	 *  actually has focus, so zoom is inherently per-pane with no extra
	 *  coordination needed; Ctrl+Scroll is separately hover-scoped (a wheel
	 *  listener on this pane's own container), independent of keyboard focus,
	 *  same as how wheel scrolling works anywhere else. Ephemeral-across-
	 *  restarts by design — consistent with appStore.sidebarHidden also not
	 *  persisting, unlike the theme preset, which does
	 *  (settingsStore/settings_store). */
	const FONT_SIZE_MIN = 8;
	const FONT_SIZE_MAX = 32;
	const FONT_SIZE_STEP = 1;
	let fontSize = 13;

	function cssVar(name: string): string {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	}

	/** Shared by the terminal.zoomIn/zoomOut keybindings (below) and the
	 *  Ctrl+Scroll gesture (template) — clamped so it can't reach a
	 *  degenerate (unreadable, or 0-row/0-col) size. Re-fits and reports the
	 *  new row/col count to the backend PTY the same way any other resize
	 *  does (reportResize, inside onMount) — the shell needs to know its
	 *  dimensions actually changed. */
	function applyZoom(delta: number) {
		if (!term || !fitAddon || !handle) return;
		const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, fontSize + delta));
		if (next === fontSize) return;
		fontSize = next;
		handle.fontSize = next;
		term.options.fontSize = fontSize;
		fitTerminal(term, fitAddon);
		resizeTerminal(sessionId, term.rows, term.cols).catch((err) =>
			console.error(`resizeTerminal(${sessionId}) failed:`, err),
		);
	}

	/** WebLinksAddon fires this for a plain click too — xterm.js itself does
	 *  no modifier gating, it just activates whatever link the pointer is
	 *  over. Requiring Ctrl+left-click here (VS Code/Tilix convention) is
	 *  what keeps a bare click selecting/positioning in the shell instead of
	 *  hijacking it to open a browser. */
	function openTerminalLink(event: MouseEvent, uri: string) {
		if (!event.ctrlKey || event.button !== 0) return;
		openUrl(uri).catch((err) => console.error(`openUrl(${uri}) failed:`, err));
	}

	/** Serializes a write onto the session's (not just this component
	 *  instance's) write queue — shared by typed input (onData) and a
	 *  Ctrl+Shift+V paste, so a paste can never race ahead of/behind
	 *  keystrokes typed just before or after it, and so ordering survives a
	 *  remount too (see `handle.writeQueue`'s own doc comment). */
	function queueWrite(data: string) {
		if (!handle) return;
		handle.writeQueue = handle.writeQueue
			.then(() => writeTerminal(sessionId, data))
			.catch((err) => console.error(`writeTerminal(${sessionId}) failed:`, err));
	}

	onMount(() => {
		const existing = getTerminalHandle(sessionId);

		if (!existing) {
			const newTerm = new Terminal({
				fontFamily: cssVar("--font-family-mono"),
				fontSize,
				// FR-13/design.md §4.5: a named preset's full Theme (background,
				// foreground, cursor, cursorAccent, all 16 ANSI colors) —
				// replaces the old partial CSS-var-derived object that left the
				// ANSI palette as xterm's unspecified defaults.
				theme: withWindowTransparency(
					getThemePreset(settingsStore.themePreset, themeStore.resolved).theme,
					settingsStore.windowTransparency,
				),
			});
			const newFitAddon = new FitAddon();
			newTerm.loadAddon(newFitAddon);
			newTerm.loadAddon(new WebLinksAddon(openTerminalLink));

			// ADR-0006's own pre-approved revisit trigger: WebGL proved unreliable
			// (debugger session 2026-07-21) — @xterm/addon-webgl 0.19.0 paired with
			// @xterm/xterm 6.0.0 creates a healthy WebGL2 context (no errors, correct
			// size, isContextLost() false) but never actually issues a single visible
			// draw call — confirmed via direct gl.readPixels() on the framebuffer,
			// independent of write content (alt-screen vs plain text) and addon load
			// order relative to term.open(). Falling back to the default renderer
			// app-wide, as ADR-0006 anticipated, rather than the WebGL addon.

			// A floating container, not `containerEl` itself: `term.open()` is
			// only ever called once, here, at creation. Every mount (this one
			// included) re-parents this same element into its own `containerEl`
			// via a plain `appendChild` below — see terminal-registry.ts.
			const wrapperEl = document.createElement("div");
			wrapperEl.style.height = "100%";
			wrapperEl.style.width = "100%";
			newTerm.open(wrapperEl);

			let markInitialResizeDone: () => void = () => {};
			const initialWriteQueue = new Promise<void>((resolve) => {
				markInitialResizeDone = resolve;
			});

			const newHandle: TerminalHandle = {
				term: newTerm,
				fitAddon: newFitAddon,
				wrapperEl,
				unlistenOutput: () => {},
				unlistenExit: () => {},
				// Calls through `reportResize` field, not a closure over this
				// specific mount's `reportResize` function — see that field's
				// own doc comment in terminal-registry.ts for why.
				resizeObserver: new ResizeObserver(() => newHandle.reportResize()),
				writeQueue: initialWriteQueue,
				markInitialResizeDone,
				initialResizeDone: false,
				fontSize,
				reportResize: () => {}, // overwritten below on every mount
			};
			handle = newHandle;
			registerTerminalHandle(sessionId, handle);

			// A full-screen TUI (opencode, vim, htop…) switches to the alternate
			// screen buffer, which has no scrollbar — `fitTerminal` gives the
			// grid the strip FitAddon reserves for one, so the TUI reaches the
			// pane's edge instead of leaving a band of pane colour beside it.
			// That means the grid width depends on the buffer, so refit when it
			// flips. Deferred to a microtask: this fires from inside xterm's
			// parser, and resizing the terminal from within a parse would be
			// re-entrant. Goes through the handle's `reportResize` field (not a
			// closure) for the same remount reason as the ResizeObserver above.
			newTerm.buffer.onBufferChange(() => {
				queueMicrotask(() => newHandle.reportResize());
			});

			newTerm.onData((data) => queueWrite(data));

			listen<string>(`pty://output/${sessionId}`, (event) => {
				getTerminalHandle(sessionId)?.term.write(event.payload);
			}).then((fn) => {
				const h = getTerminalHandle(sessionId);
				if (h) h.unlistenOutput = fn;
			});

			// No payload: the shell's end of the pty just closed on its own (the
			// user typed `exit`, the shell crashed, etc.) — there's no more
			// output coming and nothing to replay, so react exactly as if the
			// user had clicked this pane's own "Close pane" button.
			listen(`pty://exit/${sessionId}`, () => {
				onExit();
			}).then((fn) => {
				const h = getTerminalHandle(sessionId);
				if (h) h.unlistenExit = fn;
			});
		} else {
			handle = existing;
		}

		term = handle.term;
		fitAddon = handle.fitAddon;
		fontSize = handle.fontSize;

		if (containerEl) containerEl.appendChild(handle.wrapperEl);

		// Ctrl+C/Ctrl+V are already SIGINT and (in most shells) a no-op-ish
		// paste-via-bracketed-paste is not universal, so this app defaults to
		// the Ctrl+Shift+C/V convention most terminal emulators (incl. the
		// user's prior Tilix) use for clipboard, to avoid colliding with the
		// PTY's own use of the unshifted combo — but FR-13 lets the user
		// rebind it, so the actual combo checked here comes from
		// settingsStore, not a hardcoded modifier check.
		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown") return true;

			if (matchesCombo(event, settingsStore.keybindings["clipboard.copy"])) {
				// preventDefault: returning false below only tells xterm.js to
				// skip its own default keydown handling — it does NOT suppress
				// the DOM event, since this is an addEventListener callback
				// (not an inline onkeydown), so the browser/webview's own
				// default action for the key combo still runs otherwise.
				event.preventDefault();
				const selection = term?.getSelection();
				if (selection) writeText(selection).catch((err) => console.error("clipboard write failed:", err));
				return false;
			}

			if (matchesCombo(event, settingsStore.keybindings["clipboard.paste"])) {
				// Without this, WebKitGTK's native "Paste" edit action for
				// Ctrl+Shift+V still fires and dispatches its own `paste`
				// ClipboardEvent at xterm's hidden textarea — which xterm.js
				// handles itself via its own built-in paste listener,
				// inserting the same clipboard text a second time (the
				// "paste happens twice" bug).
				event.preventDefault();
				// term.paste() (not a raw queueWrite) — it wraps the data in
				// bracketed-paste markers when the shell has that mode on, so
				// a multi-line paste is inserted as one block for the user to
				// review rather than each embedded newline being read as an
				// Enter press and executing intermediate lines immediately.
				// It still funnels through the same term.onData → queueWrite
				// path registered below, so write ordering is unaffected.
				readText()
					.then((text) => {
						if (text) term?.paste(text);
					})
					.catch((err) => console.error("clipboard read failed:", err));
				return false;
			}

			if (matchesCombo(event, settingsStore.keybindings["terminal.zoomIn"])) {
				event.preventDefault();
				applyZoom(FONT_SIZE_STEP);
				return false;
			}

			if (matchesCombo(event, settingsStore.keybindings["terminal.zoomOut"])) {
				event.preventDefault();
				applyZoom(-FONT_SIZE_STEP);
				return false;
			}

			return true;
		});

		// Ctrl+Scroll — a fixed gesture (architecture.md §5.6), not a
		// rebindable registry entry. This MUST be xterm's own
		// attachCustomWheelEventHandler hook (code review B1), not a separate
		// DOM `wheel` listener on an ancestor element: xterm registers its own
		// wheel listener directly on its own viewport, which runs first and
		// (with no scrollback — the common case: a fresh prompt, or any
		// program using the alternate screen like vim/less/htop) converts an
		// un-intercepted wheel into literal ESC[A/ESC[B arrow keys sent to the
		// shell — an ancestor's bubble-phase preventDefault() runs too late to
		// stop that. Returning `false` here skips xterm's default wheel
		// handling entirely, exactly like attachCustomKeyEventHandler does for
		// keydown, above.
		term.attachCustomWheelEventHandler((event) => {
			if (!event.ctrlKey) return true;
			event.preventDefault();
			applyZoom(event.deltaY < 0 ? FONT_SIZE_STEP : -FONT_SIZE_STEP);
			return false;
		});

		// Do NOT call fitAddon.fit() synchronously here: on first creation,
		// `term.open()` just inserted the terminal's DOM into a wrapper whose
		// flex-computed size may not have been laid out by the browser yet
		// (this is a well-documented xterm.js FitAddon race, independent of
		// any font-loading concern) — and on a reused handle, `containerEl`
		// was just as freshly mounted, same concern. Measuring too early
		// yields an under-sized cols/rows that then never gets corrected —
		// the visible symptom is a terminal that renders smaller than its
		// pane, with empty space around it. A double requestAnimationFrame
		// guarantees at least one full layout+paint pass has completed first:
		// the browser always recalculates layout before running rAF
		// callbacks, and a callback scheduled from inside one rAF is
		// guaranteed to run in the *next* frame, after that frame's own
		// layout is done.
		//
		// `active` gates this the same way it gates the focus effect below:
		// TerminalArea.svelte backgrounds a tab via `display: none`, which
		// collapses this pane's container to 0x0 — the ResizeObserver fires
		// for that collapse exactly like any other resize. Without this
		// guard, backgrounding a tab would fit()/resize() the terminal (and
		// the backend PTY) down toward that degenerate size, then have to
		// resize it straight back up when the tab is reactivated; switching
		// tabs quickly let that shrink-then-grow race land mid-flight,
		// visibly flashing the terminal at the wrong size before it settled
		// (regression). Reactivating a tab still refits correctly: the same
		// display:none -> flex flip fires a genuine ResizeObserver
		// notification for the real size, by which point `active` is already
		// true again.
		function reportResize() {
			if (!fitAddon || !term || !active || !handle) return;
			fitTerminal(term, fitAddon);
			resizeTerminal(sessionId, term.rows, term.cols)
				.catch((err) => console.error(`resizeTerminal(${sessionId}) failed:`, err))
				.finally(() => {
					// Only relevant once, right after this session's very first
					// resize — a reused handle resolved this long ago.
					if (handle && !handle.initialResizeDone) {
						handle.initialResizeDone = true;
						handle.markInitialResizeDone();
					}
				});
		}

		// Every mount overwrites this — see the field's own doc comment.
		handle.reportResize = reportResize;

		requestAnimationFrame(() => {
			requestAnimationFrame(reportResize);
		});

		handle.resizeObserver.disconnect();
		if (containerEl) handle.resizeObserver.observe(containerEl);
	});

	// Deliberately does NOT unsubscribe/dispose anything — this component can
	// be destroyed for reasons that have nothing to do with the session
	// actually closing (see `handle`'s own doc comment above, and
	// `$lib/terminal-registry`). Real teardown happens exactly once, via
	// `disposeTerminalHandle`, called by whichever code path just confirmed
	// the session's shell process is genuinely gone.
	onDestroy(() => {});

	$effect(() => {
		if (focused && active) term?.focus();
	});

	/** Regression: switching tabs away and back left a backgrounded split's
	 *  non-focused pane showing blank content, only repainting once the user
	 *  clicked it. `reportResize`'s own fit()/resize() call above is *not* a
	 *  reliable repaint trigger here — @xterm/addon-fit's `fit()` is a no-op
	 *  (skips both `resize()` and the render service's `clear()`) whenever the
	 *  container's size didn't actually change, which is the common case for
	 *  a tab regaining visibility. The only thing that happened to repaint the
	 *  *focused* pane was `term.focus()` above incidentally forcing a fresh
	 *  render frame — a side effect this pane never got since it wasn't the
	 *  focused one. Forcing a full-row refresh on every `active` transition to
	 *  true, independent of focus, repaints every backgrounded pane a tab
	 *  brings back, not just whichever one last had keyboard focus. */
	$effect(() => {
		if (active && term) term.refresh(0, term.rows - 1);
	});

	// FR-13: applies the newly-selected preset to this (already-open) pane
	// immediately, per the acceptance criteria — no separate "Apply" step.
	$effect(() => {
		// Reads themeStore.resolved, so this effect also re-runs when the user
		// switches Appearance — that is what repaints an already-open pane from
		// App Default dark to App Default light without reopening it.
		const preset = getThemePreset(settingsStore.themePreset, themeStore.resolved);
		const transparency = settingsStore.windowTransparency;
		if (!term) return;
		// FR-15: `allowTransparency` is deliberately NOT set — measured inert
		// in xterm 6.0.0 (see withWindowTransparency's note). The alpha lives
		// on .pane below, not in the xterm theme.
		term.options.theme = withWindowTransparency(preset.theme, transparency);
	});
</script>

<!-- FR-15: the pane, not xterm, carries the terminal background. xterm
     flattens a translucent theme background against black and paints it
     opaque (see theme-presets.ts), so the alpha has to live here.

     It must sit on `.pane` specifically — the element inside the
     (transparent-when-unfocused) border. The pane has no padding
     (components.md → Split Pane Container → Pane body, v3.3), but the grid
     holds whole character cells only, so up to one cell width on the right
     and one line height at the bottom are left over; `.pane`'s background
     is what paints that remainder. Painting an inner child instead would
     leave it see-through under FR-15's transparent window. -->
<div
	class="pane"
	class:focused
	role="presentation"
	style:background-color={paneBackground(
		getThemePreset(settingsStore.themePreset, themeStore.resolved).theme,
		settingsStore.windowTransparency,
		themeStore.resolved,
	)}
	onclick={onFocus}
	onfocusin={onFocus}
>
	<div class="xterm-container" bind:this={containerEl}></div>
</div>

<style>
	.pane {
		height: 100%;
		width: 100%;
		min-width: var(--pane-min-width);
		min-height: var(--pane-min-height);
		/* components.md → Split Pane Container → Pane body (v3.3): no padding
		   and square corners, so a full-screen TUI's own background reaches
		   the border instead of sitting inside a frame of pane colour. */
		padding: 0;
		border: var(--pane-divider-width) solid transparent;
		border-radius: 0;
	}

	.pane.focused {
		border-color: var(--color-primary);
	}

	.xterm-container {
		height: 100%;
		width: 100%;
	}

	/* FR-15: xterm sets a background on its own elements, so emptying the
	   theme is not enough — these must be forced transparent for the pane
	   colour above to be what shows. Verified by pixel measurement: without
	   this the terminal renders a uniform opaque colour (stdev 0.00) over a
	   striped backdrop; with it, stdev 127.49, matching the bare backdrop. */
	.xterm-container :global(.xterm),
	.xterm-container :global(.xterm-viewport),
	.xterm-container :global(.xterm-screen) {
		background-color: transparent !important;
	}
</style>
