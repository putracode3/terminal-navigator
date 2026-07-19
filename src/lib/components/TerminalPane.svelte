<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { listen } from "@tauri-apps/api/event";
	import { Terminal } from "@xterm/xterm";
	import { FitAddon } from "@xterm/addon-fit";
	import { WebglAddon } from "@xterm/addon-webgl";
	import "@xterm/xterm/css/xterm.css";
	import { writeTerminal, resizeTerminal } from "$lib/api";

	let {
		sessionId,
		focused = false,
		onFocus,
	}: {
		sessionId: string;
		focused?: boolean;
		onFocus: () => void;
	} = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let term: Terminal | undefined;
	let fitAddon: FitAddon | undefined;
	let unlisten: (() => void) | undefined;
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

	onMount(() => {
		term = new Terminal({
			fontFamily: cssVar("--font-family-mono"),
			fontSize: 13,
			theme: {
				background: cssVar("--color-background"),
				foreground: cssVar("--color-text"),
				cursor: cssVar("--color-primary"),
				cursorAccent: cssVar("--color-background"),
				// ANSI 16-color palette is outside the design token system
				// (tokens.css defines app chrome, not shell output colors) —
				// unspecified: using xterm's defaults — review needed.
			},
		});
		fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		try {
			term.loadAddon(new WebglAddon());
		} catch {
			// ADR-0006 / architecture.md §9 risk 2: fall back to the default
			// renderer if WebGL context creation fails on this system.
		}

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
		function reportResize() {
			if (!fitAddon || !term) return;
			fitAddon.fit();
			resizeTerminal(sessionId, term.rows, term.cols)
				.catch((err) => console.error(`resizeTerminal(${sessionId}) failed:`, err))
				.finally(markInitialResizeDone);
		}

		requestAnimationFrame(() => {
			requestAnimationFrame(reportResize);
		});

		term.onData((data) => {
			writeQueue = writeQueue
				.then(() => writeTerminal(sessionId, data))
				.catch((err) => console.error(`writeTerminal(${sessionId}) failed:`, err));
		});

		listen<string>(`pty://output/${sessionId}`, (event) => {
			term?.write(event.payload);
		}).then((fn) => {
			unlisten = fn;
		});

		resizeObserver = new ResizeObserver(reportResize);
		if (containerEl) resizeObserver.observe(containerEl);
	});

	onDestroy(() => {
		unlisten?.();
		resizeObserver?.disconnect();
		term?.dispose();
	});

	$effect(() => {
		if (focused) term?.focus();
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
