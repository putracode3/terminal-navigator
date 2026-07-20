<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { listen } from "@tauri-apps/api/event";
	import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
	import { Terminal } from "@xterm/xterm";
	import { FitAddon } from "@xterm/addon-fit";
	import { WebglAddon } from "@xterm/addon-webgl";
	import "@xterm/xterm/css/xterm.css";
	import { writeTerminal, resizeTerminal } from "$lib/api";
	import { getThemePreset } from "$lib/theme-presets";
	import { matchesCombo } from "$lib/keybindings";
	import { settingsStore } from "$lib/stores/settings.svelte";

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
	/** FR-13 follow-up (terminal.zoomIn/zoomOut, architecture.md §5.6):
	 *  per-pane, not persisted. Falls out naturally from where the keyboard
	 *  handler already lives — `attachCustomKeyEventHandler` only fires for
	 *  whichever pane actually has focus, so zoom is inherently per-pane with
	 *  no extra coordination needed; Ctrl+Scroll is separately hover-scoped
	 *  (a wheel listener on this pane's own container), independent of
	 *  keyboard focus, same as how wheel scrolling works anywhere else.
	 *  Ephemeral by design (resets on next launch) — consistent with
	 *  appStore.sidebarHidden also not persisting, unlike the theme preset,
	 *  which does (settingsStore/settings_store). */
	const FONT_SIZE_MIN = 8;
	const FONT_SIZE_MAX = 32;
	const FONT_SIZE_STEP = 1;
	let fontSize = 13;
	let unlisten: (() => void) | undefined;
	let unlistenExit: (() => void) | undefined;
	let resizeObserver: ResizeObserver | undefined;
	/** Serializes this pane's writes to the backend: `invoke()` calls are
	 *  independent, concurrent IPC round-trips with no ordering guarantee
	 *  between them (Tauri dispatches sync commands onto a thread pool), so
	 *  firing one per keystroke without sequencing lets fast typing arrive at
	 *  the PTY out of order — the root cause of the "garbled input" bug.
	 *  Chaining every write onto this promise ensures at most one
	 *  `writeTerminal` call for this pane is ever in flight, so the next
	 *  keystroke's write only starts once the previous one has actually
	 *  completed, preserving keystroke order.
	 *
	 *  It starts unresolved, not `Promise.resolve()`: the PTY is opened at a
	 *  hardcoded default size (80x24, pty_manager::spawn) and only resized to
	 *  this pane's real dimensions by an async `resizeTerminal` call after the
	 *  first fit(). In a fast (release) build the terminal can already be
	 *  focused and accepting keystrokes before that resize round-trip lands,
	 *  so the shell edits its input line believing a column width that
	 *  doesn't match what xterm.js is actually rendering — every subsequent
	 *  cursor-position escape sequence the shell sends (e.g.
	 *  zsh-autosuggestions' redraw-on-keystroke) then lands in the wrong
	 *  place. This queue holds every keystroke until the first resize is
	 *  confirmed applied, closing that window without delaying how soon the
	 *  pane visually looks focused/ready. */
	let writeQueue: Promise<void>;
	let markInitialResizeDone: () => void;
	writeQueue = new Promise((resolve) => {
		markInitialResizeDone = resolve;
	});

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
		if (!term || !fitAddon) return;
		const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, fontSize + delta));
		if (next === fontSize) return;
		fontSize = next;
		term.options.fontSize = fontSize;
		fitAddon.fit();
		resizeTerminal(sessionId, term.rows, term.cols).catch((err) =>
			console.error(`resizeTerminal(${sessionId}) failed:`, err),
		);
	}


	onMount(() => {
		term = new Terminal({
			fontFamily: cssVar("--font-family-mono"),
			fontSize,
			// FR-13/design.md §4.5: a named preset's full Theme (background,
			// foreground, cursor, cursorAccent, all 16 ANSI colors) — replaces
			// the old partial CSS-var-derived object that left the ANSI palette
			// as xterm's unspecified defaults.
			theme: getThemePreset(settingsStore.themePreset).theme,
		});
		fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		try {
			term.loadAddon(new WebglAddon());
		} catch {
			// ADR-0006 / architecture.md §9 risk 2: fall back to the default
			// renderer if WebGL context creation fails on this system.
		}

		/** Serializes a write onto `writeQueue` — shared by typed input
		 *  (onData below) and a Ctrl+Shift+V paste, so a paste can never race
		 *  ahead of/behind keystrokes typed just before or after it. */
		function queueWrite(data: string) {
			writeQueue = writeQueue
				.then(() => writeTerminal(sessionId, data))
				.catch((err) => console.error(`writeTerminal(${sessionId}) failed:`, err));
		}

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

		if (containerEl) term.open(containerEl);

		// Do NOT call fitAddon.fit() synchronously here: term.open() just
		// inserted the terminal's DOM into a freshly-mounted container whose
		// flex-computed size may not have been laid out by the browser yet
		// (this is a well-documented xterm.js FitAddon race, independent of
		// any font-loading concern). Measuring too early yields an
		// under-sized cols/rows that then never gets corrected — the visible
		// symptom is a terminal that renders smaller than its pane, with
		// empty space around it. A double requestAnimationFrame guarantees at
		// least one full layout+paint pass has completed first: the browser
		// always recalculates layout before running rAF callbacks, and a
		// callback scheduled from inside one rAF is guaranteed to run in the
		// *next* frame, after that frame's own layout is done.
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
			if (!fitAddon || !term || !active) return;
			fitAddon.fit();
			resizeTerminal(sessionId, term.rows, term.cols)
				.catch((err) => console.error(`resizeTerminal(${sessionId}) failed:`, err))
				.finally(markInitialResizeDone);
		}

		requestAnimationFrame(() => {
			requestAnimationFrame(reportResize);
		});

		term.onData((data) => queueWrite(data));

		listen<string>(`pty://output/${sessionId}`, (event) => {
			term?.write(event.payload);
		}).then((fn) => {
			unlisten = fn;
		});

		// No payload: the shell's end of the pty just closed on its own (the
		// user typed `exit`, the shell crashed, etc.) — there's no more
		// output coming and nothing to replay, so react exactly as if the
		// user had clicked this pane's own "Close pane" button.
		listen(`pty://exit/${sessionId}`, () => {
			onExit();
		}).then((fn) => {
			unlistenExit = fn;
		});

		resizeObserver = new ResizeObserver(reportResize);
		if (containerEl) resizeObserver.observe(containerEl);
	});

	onDestroy(() => {
		unlisten?.();
		unlistenExit?.();
		resizeObserver?.disconnect();
		term?.dispose();
	});

	$effect(() => {
		if (focused && active) term?.focus();
	});

	// FR-13: applies the newly-selected preset to this (already-open) pane
	// immediately, per the acceptance criteria — no separate "Apply" step.
	$effect(() => {
		const preset = getThemePreset(settingsStore.themePreset);
		if (term) term.options.theme = preset.theme;
	});
</script>

<div
	class="pane"
	class:focused
	role="presentation"
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
		padding: var(--space-1);
		border: var(--pane-divider-width) solid transparent;
		border-radius: var(--radius-sm);
	}

	.pane.focused {
		border-color: var(--color-primary);
	}

	.xterm-container {
		height: 100%;
		width: 100%;
	}
</style>
