<script lang="ts">
	import TerminalPane from "./TerminalPane.svelte";
	import PaneTitle from "./PaneTitle.svelte";
	// Self-import for recursion (the modern replacement for the deprecated
	// <svelte:self>) — Vite/the Svelte compiler resolve this fine since it's
	// the same module being imported from itself.
	import PaneNodeView from "./PaneNodeView.svelte";
	import type { PaneNode, SplitDirection, DropZone, DragSource } from "$lib/stores/terminal.svelte";

	let {
		node,
		tabId,
		focusedPaneId,
		active = true,
		dragSource,
		canDragPanes = false,
		onFocusPane,
		onSplitPane,
		onClosePane,
		onResizeSplit,
		onDrop,
		onDragStartPane,
		onDragEndPane,
	}: {
		node: PaneNode;
		/** The tab this pane tree belongs to — needed only to reject an
		 *  invalid drop target for a `graft`/`move-pane` source (components.md:
		 *  a tab's tree can't be grafted into itself; a pane-move drop is
		 *  same-tab only), not for anything else. */
		tabId: string;
		focusedPaneId: string;
		/** Whether `tabId` is the tab currently shown in the terminal area —
		 *  threaded straight through to each leaf's TerminalPane (see its own
		 *  prop doc). Defaults `true` so standalone usage (tests) behaves as
		 *  if always active, matching pre-v1.5 behavior. */
		active?: boolean;
		/** The sidebar drag currently in progress, or null — see
		 *  terminalStore.dragSource. Threaded as a prop (not read from the
		 *  store directly) to keep this component prop-driven/testable. */
		dragSource: DragSource | null;
		/** Whether this tab has 2+ panes, i.e. whether any of its own panes
		 *  has a valid same-tab drop target to relocate onto (components.md
		 *  v3.1: a pane alone in its tab is not a drag source at all).
		 *  Computed once, at the tab root, from `paneCount(root) > 1` — not
		 *  per-subtree, since every leaf's drag-source eligibility depends on
		 *  the whole tab's pane count, not just its own local subtree. */
		canDragPanes?: boolean;
		onFocusPane: (sessionId: string) => void;
		onSplitPane: (sessionId: string, direction: SplitDirection) => void;
		onClosePane: (sessionId: string) => void;
		onResizeSplit: (splitId: string, sizes: number[]) => void;
		onDrop: (targetSessionId: string, zone: DropZone) => void;
		/** Drag to move (v3.1) — fired when a pane's own header starts a
		 *  drag, so the caller can set `terminalStore.dragSource` to a
		 *  `move-pane` source. */
		onDragStartPane: (sessionId: string) => void;
		onDragEndPane: () => void;
	} = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	// Keyed by the hovered leaf's own sessionId (not just a bare DropZone) —
	// see the note above the template: a single PaneNodeView instance can now
	// render several sibling leaves inline, so the overlay must know *which*
	// one is being dragged over, not just which zone.
	let dropZone = $state<{ sessionId: string; zone: DropZone } | null>(null);

	/** Bug fix (debugger session, "split pane makes the other terminal
	 *  unscrollable"): a lone leaf and a real split used to be two entirely
	 *  different branches of a top-level `{#if node.type === 'leaf'}`. The
	 *  moment a tab's *only* pane got split, that leaf's branch was torn down
	 *  and the `{:else}` branch mounted a brand-new nested `<PaneNodeView>`
	 *  for it from scratch — which mounted a brand-new `<TerminalPane>`,
	 *  destroying the existing xterm.js `Terminal` (and its scrollback/scroll
	 *  state) even though that session's PTY never actually restarted.
	 *  Splitting an *already*-split tab further never had this problem —
	 *  that just grows an existing keyed `{#each}`'s array, which Svelte
	 *  correctly reconciles by key. The fix: always render through that same
	 *  keyed `{#each}` shape, normalizing a lone leaf to a single-item list,
	 *  so a leaf→split transition is just "the array grew from 1 to 2" to
	 *  Svelte, not "an if-branch flipped" — the existing leaf's key
	 *  (sessionId) never changes, so its component instance survives. */
	const isRealSplit = $derived(node.type === "split");
	const items = $derived(isRealSplit ? (node as Extract<PaneNode, { type: "split" }>).children : [node]);
	const direction = $derived(isRealSplit ? (node as Extract<PaneNode, { type: "split" }>).direction : "row");
	const sizes = $derived(isRealSplit ? (node as Extract<PaneNode, { type: "split" }>).sizes : [1]);

	/** Divides the pane by its two diagonals into 4 triangles (components.md's
	 *  Drop zones table — deliberately no center zone). */
	function computeDropZone(rect: DOMRect, clientX: number, clientY: number): DropZone {
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		const w = rect.width;
		const h = rect.height;
		const d1 = y * w - x * h; // side of the top-left → bottom-right diagonal
		const d2 = y * w - (w - x) * h; // side of the top-right → bottom-left diagonal
		if (d1 <= 0 && d2 <= 0) return "top";
		if (d1 >= 0 && d2 >= 0) return "bottom";
		if (d1 >= 0 && d2 <= 0) return "left";
		return "right";
	}

	/** `graft` sources are invalid over their own tab's panes (a tree can't
	 *  be grafted into itself); `spawn` sources have no "self" to collide
	 *  with, so every pane is a valid target for them (components.md's
	 *  Drop zones table). `move-pane` sources (v3.1) are same-tab only and
	 *  invalid over the exact pane being dragged (a pane can't be dropped
	 *  onto itself) — this is the one case that needs the hovered leaf's own
	 *  sessionId, not just the tab id. */
	function isValidDropTarget(sessionId: string): boolean {
		if (!dragSource) return false;
		if (dragSource.kind === "spawn") return true;
		if (dragSource.kind === "graft") return dragSource.tabId !== tabId;
		return dragSource.tabId === tabId && dragSource.sessionId !== sessionId;
	}

	function handleDragOver(e: DragEvent, sessionId: string) {
		// No preventDefault() → browser shows its native "not-allowed" cursor
		// and disallows the drop, satisfying the invalid-target spec with zero
		// extra styling (no drag in progress, hovering the dragged tab's own
		// pane, or — v3.1 — hovering the exact pane being dragged).
		if (!isValidDropTarget(sessionId)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		dropZone = { sessionId, zone: computeDropZone(rect, e.clientX, e.clientY) };
	}

	function handleDragLeave() {
		dropZone = null;
	}

	function handleDrop(e: DragEvent, sessionId: string) {
		e.preventDefault();
		if (dropZone && dropZone.sessionId === sessionId && isValidDropTarget(sessionId)) {
			onDrop(sessionId, dropZone.zone);
		}
		dropZone = null;
	}

	/** Drag to move (components.md v3.1) — the pane header itself is the drag
	 *  source, distinct from the sidebar-sourced drags above. Firefox refuses
	 *  to start a drag unless setData() is called at least once — same
	 *  requirement the sidebar's own drag sources already follow
	 *  (SidebarSessionSubItem.svelte); the actual payload is
	 *  terminalStore.dragSource (set by onDragStartPane), not this. */
	function handlePaneDragStart(e: DragEvent, sessionId: string) {
		e.dataTransfer?.setData("text/plain", sessionId);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
		onDragStartPane(sessionId);
	}

	function handlePaneDragEnd() {
		onDragEndPane();
	}

	function startDrag(splitNode: Extract<PaneNode, { type: "split" }>, index: number, e: PointerEvent) {
		e.preventDefault();
		const container = containerEl;
		if (!container) return;
		const isRow = splitNode.direction === "row";
		const startPos = isRow ? e.clientX : e.clientY;
		const rect = container.getBoundingClientRect();
		const totalSize = isRow ? rect.width : rect.height;
		const startSizes = [...splitNode.sizes];
		const minFraction = 0.1;

		function onMove(ev: PointerEvent) {
			const currentPos = isRow ? ev.clientX : ev.clientY;
			const delta = (currentPos - startPos) / totalSize;
			const sizes = [...startSizes];
			let a = sizes[index] + delta;
			let b = sizes[index + 1] - delta;
			if (a < minFraction) {
				b -= minFraction - a;
				a = minFraction;
			}
			if (b < minFraction) {
				a -= minFraction - b;
				b = minFraction;
			}
			sizes[index] = a;
			sizes[index + 1] = b;
			onResizeSplit(splitNode.id, sizes);
		}
		function onUp() {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		}
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	function handleDividerKeydown(splitNode: Extract<PaneNode, { type: "split" }>, index: number, e: KeyboardEvent) {
		const step = 0.05;
		const isRow = splitNode.direction === "row";
		let delta = 0;
		if (isRow && e.key === "ArrowLeft") delta = -step;
		else if (isRow && e.key === "ArrowRight") delta = step;
		else if (!isRow && e.key === "ArrowUp") delta = -step;
		else if (!isRow && e.key === "ArrowDown") delta = step;
		if (delta === 0) return;
		e.preventDefault();
		const sizes = [...splitNode.sizes];
		let a = sizes[index] + delta;
		let b = sizes[index + 1] - delta;
		if (a < 0.1 || b < 0.1) return;
		sizes[index] = a;
		sizes[index + 1] = b;
		onResizeSplit(splitNode.id, sizes);
	}
</script>

<div class="split split-{direction}" bind:this={containerEl}>
	{#each items as child, i (child.type === "leaf" ? child.sessionId : child.id)}
		<div class="split-child" style:flex="{sizes[i]} 1 0%">
			{#if child.type === "leaf"}
				<div
					class="leaf"
					class:dragging={dragSource?.kind === "move-pane" && dragSource.sessionId === child.sessionId}
				>
					<!-- svelte-ignore a11y_no_static_element_interactions -- drag-to-move (components.md v3.1) has no keyboard equivalent yet (flagged ⚠️ TBD there, tracked not silently dropped); `role="group"` here is accurate (this groups the pane's title, not a single click action) rather than `role="button"`, which would falsely imply Enter/Space activates something. -->
					<div
						class="pane-header"
						role="group"
						draggable={canDragPanes}
						ondragstart={(e) => handlePaneDragStart(e, child.sessionId)}
						ondragend={handlePaneDragEnd}
					>
						<PaneTitle cwd={child.cwd} focused={child.sessionId === focusedPaneId} />
						<button
							class="pane-close"
							draggable="false"
							aria-label="Close pane"
							onclick={() => onClosePane(child.sessionId)}
						>✕</button>
					</div>
					<div
						class="pane-body"
						role="group"
						ondragover={(e) => handleDragOver(e, child.sessionId)}
						ondragleave={handleDragLeave}
						ondrop={(e) => handleDrop(e, child.sessionId)}
					>
						<!-- Keyed by sessionId via the {#each} above: a leaf whose
						     sessionId changes *in place* (e.g. grafting a dragged
						     session onto it, TerminalArea.svelte's handleDrop) still
						     gets a fresh TerminalPane instance — its onMount-time PTY
						     output subscription and xterm.js Terminal are only ever
						     created once, so reusing the instance would keep
						     showing/writing to the OLD session forever. A leaf
						     surviving a leaf→split transition (this file's bug fix,
						     see above) is the opposite case: same sessionId, same
						     key, correctly reused instead of remounted. -->
						<TerminalPane
							sessionId={child.sessionId}
							focused={child.sessionId === focusedPaneId}
							{active}
							onFocus={() => onFocusPane(child.sessionId)}
							onExit={() => onClosePane(child.sessionId)}
						/>
						<div class="pane-toolbar">
							<button aria-label="Split right" onclick={() => onSplitPane(child.sessionId, "row")}>⬌</button>
							<button aria-label="Split down" onclick={() => onSplitPane(child.sessionId, "column")}>⬍</button>
						</div>
						{#if dropZone && dropZone.sessionId === child.sessionId}
							<div class="drop-zone-overlay drop-zone-{dropZone.zone}" aria-hidden="true"></div>
						{/if}
					</div>
				</div>
			{:else}
				<PaneNodeView
					node={child}
					{tabId}
					{focusedPaneId}
					{active}
					{dragSource}
					{canDragPanes}
					{onFocusPane}
					{onSplitPane}
					{onClosePane}
					{onDragStartPane}
					{onDragEndPane}
					{onResizeSplit}
					{onDrop}
				/>
			{/if}
		</div>
		{#if isRealSplit && i < items.length - 1}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -- WAI-ARIA "window splitter" pattern: a focusable, keyboard-resizable separator is the documented accessible pattern here -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- same: pointer/keyboard handlers are required for this pattern -->
			<div
				class="divider divider-{direction}"
				role="separator"
				aria-orientation={direction === "row" ? "vertical" : "horizontal"}
				tabindex="0"
				onpointerdown={(e) => startDrag(node as Extract<PaneNode, { type: "split" }>, i, e)}
				onkeydown={(e) => handleDividerKeydown(node as Extract<PaneNode, { type: "split" }>, i, e)}
			></div>
		{/if}
	{/each}
</div>

<style>
	.leaf {
		height: 100%;
		width: 100%;
		display: flex;
		flex-direction: column;
	}

	/* Drag to move (components.md v3.1): opacity 0.4 on the whole pane while
	   it's the one being dragged — same treatment Sidebar Session Sub-item's
	   own `dragging` state already uses, reused rather than invented fresh. */
	.leaf.dragging {
		opacity: 0.4;
	}

	.pane-header {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--control-height-sm);
		padding: 0 var(--space-2);
		background: var(--color-surface);
		border-bottom: var(--border-width-sm) solid var(--color-border);
	}

	/* Drag handle (v3.1) — only when the tab has 2+ panes (canDragPanes); a
	   pane alone in its tab has no valid same-tab drop target and stays
	   non-draggable, with the default (non-grab) cursor. */
	.pane-header[draggable="true"] {
		cursor: grab;
	}

	.leaf.dragging .pane-header[draggable="true"] {
		cursor: grabbing;
	}

	.pane-close {
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: var(--text-xs);
		padding: var(--space-1);
		border-radius: var(--radius-sm);
	}
	.pane-close:hover {
		background: var(--color-surface-elevated);
		color: var(--color-text);
	}

	.pane-body {
		position: relative;
		flex: 1;
		min-height: 0;
	}

	.pane-toolbar {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		z-index: var(--z-sticky);
		display: flex;
		gap: var(--space-1);
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-out);
	}

	.pane-body:hover .pane-toolbar,
	.pane-body:focus-within .pane-toolbar {
		opacity: 1;
	}

	.pane-toolbar button {
		background: var(--color-surface-elevated);
		border: var(--border-width-sm) solid var(--color-border-strong);
		color: var(--color-text-muted);
		cursor: pointer;
		width: var(--control-height-sm);
		height: var(--control-height-sm);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}
	.pane-toolbar button:hover {
		color: var(--color-text);
		background: var(--color-surface);
	}

	/* Drag-to-split drop-zone overlay (components.md — Split Pane Container,
	   Drop zones). pointer-events:none so dragover/dragleave/drop keep firing
	   on .pane-body, not this overlay, avoiding flicker as the cursor crosses
	   the overlay's own edges. */
	.drop-zone-overlay {
		position: absolute;
		inset: 0;
		background: var(--color-primary-bg-subtle);
		pointer-events: none;
		z-index: var(--z-sticky);
	}

	.drop-zone-top {
		bottom: 50%;
		border-bottom: var(--border-width-md) solid var(--color-primary);
	}

	.drop-zone-bottom {
		top: 50%;
		border-top: var(--border-width-md) solid var(--color-primary);
	}

	.drop-zone-left {
		right: 50%;
		border-right: var(--border-width-md) solid var(--color-primary);
	}

	.drop-zone-right {
		left: 50%;
		border-left: var(--border-width-md) solid var(--color-primary);
	}

	.split {
		height: 100%;
		width: 100%;
		display: flex;
	}

	.split-row {
		flex-direction: row;
	}

	.split-column {
		flex-direction: column;
	}

	.split-child {
		min-width: var(--pane-min-width);
		min-height: var(--pane-min-height);
		overflow: hidden;
	}

	.divider {
		flex-shrink: 0;
		background: var(--color-border);
		position: relative;
	}

	.divider:hover,
	.divider:focus-visible {
		background: var(--color-border-strong);
	}

	.divider:active {
		background: var(--color-primary);
	}

	.divider-row {
		width: var(--pane-divider-width);
		cursor: col-resize;
	}
	.divider-row::after {
		content: "";
		position: absolute;
		inset: 0 calc(var(--pane-divider-hit-area) * -1);
	}

	.divider-column {
		height: var(--pane-divider-width);
		cursor: row-resize;
	}
	.divider-column::after {
		content: "";
		position: absolute;
		inset: calc(var(--pane-divider-hit-area) * -1) 0;
	}
</style>
