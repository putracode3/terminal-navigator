<script lang="ts">
	import PaneNodeView from "./PaneNodeView.svelte";
	import type { PaneNode, SplitDirection, DropZone, DragSource } from "$lib/stores/terminal.svelte";

	// Renders the "single" variant when `root` is a leaf (no dividers, pane
	// header always shown — components.md v1.4) and the "split" variant
	// recursively otherwise.
	let {
		tabId,
		root,
		focusedPaneId,
		dragSource,
		onFocusPane,
		onSplitPane,
		onClosePane,
		onResizeSplit,
		onDrop,
	}: {
		tabId: string;
		root: PaneNode;
		focusedPaneId: string;
		dragSource: DragSource | null;
		onFocusPane: (sessionId: string) => void;
		onSplitPane: (sessionId: string, direction: SplitDirection) => void;
		onClosePane: (sessionId: string) => void;
		onResizeSplit: (splitId: string, sizes: number[]) => void;
		onDrop: (targetSessionId: string, zone: DropZone) => void;
	} = $props();
</script>

<div class="grid">
	<PaneNodeView
		node={root}
		{tabId}
		{focusedPaneId}
		{dragSource}
		{onFocusPane}
		{onSplitPane}
		{onClosePane}
		{onResizeSplit}
		{onDrop}
	/>
</div>

<style>
	.grid {
		height: 100%;
		width: 100%;
		display: flex;
	}
</style>
