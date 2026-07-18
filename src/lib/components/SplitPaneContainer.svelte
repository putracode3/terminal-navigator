<script lang="ts">
	import PaneNodeView from "./PaneNodeView.svelte";
	import { paneCount, type PaneNode, type SplitDirection, type DropZone } from "$lib/stores/terminal.svelte";

	// Renders the "single" variant when `root` is a leaf (no dividers, no pane
	// header — components.md) and the "split" variant recursively otherwise.
	let {
		tabId,
		root,
		focusedPaneId,
		draggingSourceTabId,
		onFocusPane,
		onSplitPane,
		onClosePane,
		onResizeSplit,
		onDropTab,
	}: {
		tabId: string;
		root: PaneNode;
		focusedPaneId: string;
		draggingSourceTabId: string | null;
		onFocusPane: (sessionId: string) => void;
		onSplitPane: (sessionId: string, direction: SplitDirection) => void;
		onClosePane: (sessionId: string) => void;
		onResizeSplit: (splitId: string, sizes: number[]) => void;
		onDropTab: (targetSessionId: string, zone: DropZone) => void;
	} = $props();

	const multiPane = $derived(paneCount(root) > 1);
</script>

<div class="grid">
	<PaneNodeView
		node={root}
		{tabId}
		{focusedPaneId}
		{multiPane}
		{draggingSourceTabId}
		{onFocusPane}
		{onSplitPane}
		{onClosePane}
		{onResizeSplit}
		{onDropTab}
	/>
</div>

<style>
	.grid {
		height: 100%;
		width: 100%;
		display: flex;
	}
</style>
