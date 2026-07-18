<script lang="ts">
	import PaneNodeView from "./PaneNodeView.svelte";
	import { paneCount, type PaneNode, type SplitDirection } from "$lib/stores/terminal.svelte";

	// Renders the "single" variant when `root` is a leaf (no dividers, no pane
	// header — components.md) and the "split" variant recursively otherwise.
	let {
		root,
		focusedPaneId,
		onFocusPane,
		onSplitPane,
		onClosePane,
		onResizeSplit,
	}: {
		root: PaneNode;
		focusedPaneId: string;
		onFocusPane: (sessionId: string) => void;
		onSplitPane: (sessionId: string, direction: SplitDirection) => void;
		onClosePane: (sessionId: string) => void;
		onResizeSplit: (splitId: string, sizes: number[]) => void;
	} = $props();

	const multiPane = $derived(paneCount(root) > 1);
</script>

<div class="grid">
	<PaneNodeView node={root} {focusedPaneId} {multiPane} {onFocusPane} {onSplitPane} {onClosePane} {onResizeSplit} />
</div>

<style>
	.grid {
		height: 100%;
		width: 100%;
		display: flex;
	}
</style>
