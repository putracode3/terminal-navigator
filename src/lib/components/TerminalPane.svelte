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
		fitAddon.fit();
		void resizeTerminal(sessionId, term.rows, term.cols);

		term.onData((data) => {
			void writeTerminal(sessionId, data);
		});

		listen<string>(`pty://output/${sessionId}`, (event) => {
			term?.write(event.payload);
		}).then((fn) => {
			unlisten = fn;
		});

		resizeObserver = new ResizeObserver(() => {
			if (!fitAddon || !term) return;
			fitAddon.fit();
			void resizeTerminal(sessionId, term.rows, term.cols);
		});
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
