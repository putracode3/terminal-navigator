<script lang="ts">
	import TerminalPane from "./TerminalPane.svelte";
	import type { PaneState } from "$lib/stores/terminal.svelte";

	// MVP renders the "single" variant only (components.md — no dividers, no
	// pane header when there's exactly one pane). The prop shape already
	// supports N panes; split/resize interaction is deferred to a later pass.
	let {
		panes,
		focusedPaneId,
		onFocusPane,
	}: {
		panes: PaneState[];
		focusedPaneId: string;
		onFocusPane: (sessionId: string) => void;
	} = $props();
</script>

<div class="grid">
	{#each panes as pane (pane.sessionId)}
		<TerminalPane
			sessionId={pane.sessionId}
			focused={pane.sessionId === focusedPaneId}
			onFocus={() => onFocusPane(pane.sessionId)}
		/>
	{/each}
</div>

<style>
	.grid {
		height: 100%;
		width: 100%;
		display: flex;
	}
</style>
