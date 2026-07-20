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
		active = true,
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
		/** Whether `tabId` is the tab currently shown in the terminal area —
		 *  threaded straight through to `PaneNodeView` (see its own prop doc).
		 *  Defaults `true` so standalone usage (tests) behaves as if always
		 *  active, matching pre-v1.5 behavior. */
		active?: boolean;
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
		{active}
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
