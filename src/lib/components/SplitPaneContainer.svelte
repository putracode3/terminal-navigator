<script lang="ts">
	import PaneNodeView from "./PaneNodeView.svelte";
	import { paneCount, type PaneNode, type SplitDirection, type DropZone, type DragSource } from "$lib/stores/terminal.svelte";

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
		onDragStartPane,
		onDragEndPane,
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
		/** Drag to move (v3.1) — see PaneNodeView's own prop docs. */
		onDragStartPane: (sessionId: string) => void;
		onDragEndPane: () => void;
	} = $props();

	// components.md v3.1: a pane alone in its tab has no other same-tab pane
	// to drop onto, so it isn't a drag source at all — computed once here, at
	// the tab root, not per-subtree (see PaneNodeView's own doc on why).
	const canDragPanes = $derived(paneCount(root) > 1);
</script>

<div class="grid">
	<PaneNodeView
		node={root}
		{tabId}
		{focusedPaneId}
		{active}
		{dragSource}
		{canDragPanes}
		{onFocusPane}
		{onSplitPane}
		{onClosePane}
		{onResizeSplit}
		{onDrop}
		{onDragStartPane}
		{onDragEndPane}
	/>
</div>

<style>
	.grid {
		height: 100%;
		width: 100%;
		display: flex;
	}
</style>
