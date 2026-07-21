<script lang="ts">
	import type { ProjectDto } from "$lib/api";
	import type { TabState } from "$lib/stores/terminal.svelte";
	import type { SidebarDragKind } from "$lib/stores/app.svelte";
	import { computeSidebarDropBand, type SidebarDropBand } from "$lib/sidebar-drop-zones";
	import Menu, { type MenuItemDef } from "./Menu.svelte";
	import SidebarSessionSubItem from "./SidebarSessionSubItem.svelte";

	// components.md — "Sidebar Project List Item": the sole entry point for
	// opening/switching/closing/dragging a project's terminal session(s)
	// (FR-08 v1.4, no tab bar). Behavior depends entirely on session count —
	// see the "three modes" Behavior section there.
	let {
		project,
		sessions,
		activeTabId,
		invalid = false,
		onOpen,
		onForceNewTab,
		onSwitchSession,
		onCloseTerminal,
		onCloseSession,
		onEdit,
		onDelete,
		onDragStart,
		onSessionDragStart,
		onDragEnd,
		sidebarDragId = null,
		sidebarDragKind = null,
		onSidebarDrop,
	}: {
		project: ProjectDto;
		/** This project's open sessions, in creation order. */
		sessions: TabState[];
		activeTabId: string | null;
		/** FR-01 edge case: the path no longer exists on disk. */
		invalid?: boolean;
		/** 0/1-session left-click: open new (0) or switch (1). */
		onOpen: () => void;
		onForceNewTab: () => void;
		/** Grouped-mode sub-item click: switch to that exact session. */
		onSwitchSession: (tabId: string) => void;
		/** Menu's "Close terminal" — single-session mode only. */
		onCloseTerminal: () => void;
		/** Grouped-mode sub-item close button. */
		onCloseSession: (tabId: string) => void;
		onEdit: () => void;
		onDelete: () => void;
		/** 0/1-session row drag start (spawn vs graft is the caller's call,
		 *  since it already knows the session count). */
		onDragStart: () => void;
		/** Sub-item drag start (always a graft of that exact session). */
		onSessionDragStart: (tabId: string) => void;
		onDragEnd: () => void;
		/** FR-11: id of whatever's currently being dragged for sidebar
		 *  folder/reorder purposes (a project or a folder header), or null —
		 *  kept prop-driven (not read from `appStore` directly) like every
		 *  other piece of this component's state. */
		sidebarDragId?: string | null;
		sidebarDragKind?: SidebarDragKind | null;
		/** Fires on a valid drop — "before"/"after" reorder this row's
		 *  position in whichever list it lives in; "merge" creates/joins a
		 *  folder with this row. Absent entirely (this component reused
		 *  standalone/in tests) means this row simply isn't a drop target. */
		onSidebarDrop?: (band: SidebarDropBand) => void;
	} = $props();

	let menuOpen = $state(false);
	let menuAnchor = $state<{ x: number; y: number } | null>(null);
	let showInvalidMessage = $state(false);
	let dragging = $state(false);
	/** FR-11: which of the three drop bands (before/merge/after) the cursor
	 *  is currently over, while a valid sidebar drag hovers this row — null
	 *  otherwise. A dragged folder can never validly land on "merge" (folders
	 *  can't nest), so that combination is treated as no drop band at all,
	 *  same as `Split Pane Container`'s own "show unavailable, don't just
	 *  fail silently on drop" rule. */
	let dropBand = $state<SidebarDropBand | null>(null);
	/** JS-tracked rather than pure CSS `:hover`: some webviews (WebKitGTK on
	 *  Linux) leave `:hover` stuck on the right-clicked row after its native
	 *  contextmenu handling, even once the popup closes and the pointer has
	 *  moved on. Tracking it ourselves lets `handleMenuClose` force it off. */
	let hovering = $state(false);

	const mode = $derived<"empty" | "single" | "grouped">(
		sessions.length === 0 ? "empty" : sessions.length === 1 ? "single" : "grouped",
	);
	const singleSession = $derived(mode === "single" ? sessions[0] : undefined);
	const isActive = $derived(!!singleSession && singleSession.id === activeTabId);
	const hasOpenTab = $derived(mode === "single");
	const draggable = $derived(mode !== "grouped" && !invalid);
	/** FR-11: this row is a valid *target* for sidebar drag-drop regardless
	 *  of session count/invalid-path — those restrictions gate whether this
	 *  row can be a drag *source* (see `draggable` above), not whether other
	 *  rows can be dropped onto it. Only two things make it invalid: dropping
	 *  onto itself (no-op), and a dragged folder landing on the merge band
	 *  (folders can't merge into a project row — nesting is impossible). */
	const validDropBand = $derived<SidebarDropBand | null>(
		sidebarDragId && sidebarDragId !== project.id && !(dropBand === "merge" && sidebarDragKind === "folder")
			? dropBand
			: null,
	);

	const menuItems: MenuItemDef[] = $derived([
		{ label: "Open in new tab", onSelect: onForceNewTab },
		...(mode === "single" ? [{ label: "Close terminal", onSelect: onCloseTerminal }] : []),
		{ label: "Edit", onSelect: onEdit },
		{ label: "Delete", onSelect: onDelete, danger: true },
	]);

	function handleClick() {
		// Grouped rows are inert for activation — switching/closing/dragging
		// all move down to the Sidebar Session Sub-items (components.md).
		if (mode === "grouped") return;
		if (invalid) {
			showInvalidMessage = true;
			setTimeout(() => (showInvalidMessage = false), 4000);
			return;
		}
		onOpen();
	}

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		menuAnchor = { x: e.clientX, y: e.clientY };
		menuOpen = true;
	}

	function openAnchoredMenu(e: MouseEvent) {
		e.stopPropagation();
		menuAnchor = null;
		menuOpen = !menuOpen;
	}

	function handleMenuClose() {
		// menuAnchor is only set for the right-click (context) variant —
		// openAnchoredMenu always nulls it first. Force hover off just for
		// that variant, since that's the one that leaves it stuck (see the
		// `hovering` declaration above).
		if (menuAnchor) hovering = false;
		menuOpen = false;
	}

	function handleDragStart(e: DragEvent) {
		if (!draggable) {
			e.preventDefault();
			return;
		}
		e.dataTransfer?.setData("text/plain", project.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
		dragging = true;
		onDragStart();
	}

	function handleDragEnd() {
		dragging = false;
		onDragEnd();
	}

	/** FR-11: computes which band the cursor is over on every dragover tick —
	 *  a `dragover` listener must call `preventDefault()` for `drop` to ever
	 *  fire at all (same requirement `Split Pane Container`'s pane drop
	 *  targets already follow). Only actually shows an overlay via
	 *  `validDropBand`'s own gating above. */
	function handleRowDragOver(e: DragEvent) {
		if (!sidebarDragId) return;
		e.preventDefault();
		dropBand = computeSidebarDropBand((e.currentTarget as HTMLElement).getBoundingClientRect(), e.clientY);
	}

	function handleRowDragLeave() {
		dropBand = null;
	}

	function handleRowDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		const band = validDropBand;
		dropBand = null;
		if (band) onSidebarDrop?.(band);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -- role/tabindex are a matched pair, both conditional on the same `mode`: in `grouped` mode neither is present (components.md: the row is inert for activation, only its Menu control stays focusable), otherwise both are, so the element is never tabindex-without-a-role — the linter just can't see that statically since `role` is a dynamic expression -->
<div
	class="item"
	class:active={isActive}
	class:open={hasOpenTab && !isActive}
	class:grouped={mode === "grouped"}
	class:invalid
	class:dragging
	class:hovering
	class:drop-before={validDropBand === "before"}
	class:drop-merge={validDropBand === "merge"}
	class:drop-after={validDropBand === "after"}
	role={mode === "grouped" ? undefined : "button"}
	tabindex={mode === "grouped" ? undefined : 0}
	draggable={draggable}
	aria-label={`${project.name}, ${project.path}`}
	onclick={handleClick}
	onkeydown={(e) => e.key === "Enter" && handleClick()}
	oncontextmenu={handleContextMenu}
	onmouseenter={() => (hovering = true)}
	onmouseleave={() => (hovering = false)}
	ondragstart={handleDragStart}
	ondragend={handleDragEnd}
	ondragover={handleRowDragOver}
	ondragleave={handleRowDragLeave}
	ondrop={handleRowDrop}
>
	<div class="text">
		<div class="name">{project.name}</div>
		{#if showInvalidMessage}<div class="invalid-message">This path no longer exists on disk.</div>{/if}
	</div>
	<div class="menu-wrap">
		<button class="menu-btn" aria-label={`More actions for ${project.name}`} onclick={openAnchoredMenu}>
			⋮
		</button>
		<Menu open={menuOpen} items={menuItems} anchorPosition={menuAnchor} onClose={handleMenuClose} />
	</div>
	<div class="path-tooltip" class:path-invalid={invalid} aria-hidden="true">{project.path}</div>
</div>

{#if mode === "grouped"}
	<div class="sub-items">
		{#each sessions as session (session.id)}
			<SidebarSessionSubItem
				{session}
				active={session.id === activeTabId}
				onSelect={() => onSwitchSession(session.id)}
				onClose={() => onCloseSession(session.id)}
				onDragStart={() => onSessionDragStart(session.id)}
				{onDragEnd}
			/>
		{/each}
	</div>
{/if}

<style>
	.item {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.item.hovering {
		background: var(--color-surface-elevated);
	}

	.item:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}

	.item.open {
		box-shadow: inset var(--border-width-sm) 0 0 var(--color-border-strong);
	}

	.item.active {
		background: var(--color-surface-elevated);
		box-shadow: inset var(--border-width-md) 0 0 var(--color-primary);
	}

	.item.grouped {
		cursor: default;
	}

	.item.dragging {
		opacity: 0.4;
	}

	/* FR-11 (components.md "Sidebar Folder" — reuses Split Pane Container's
	 * exact drop-zone token pairing): merge is a full-row fill + border;
	 * before/after are a thin insertion line at the row's top/bottom edge.
	 * Distinguished by geometry, not color, so the color-alone accessibility
	 * rule is satisfied for free (design.md §7). */
	.item.drop-merge {
		background: var(--color-primary-bg-subtle);
		box-shadow: inset 0 0 0 var(--border-width-md) var(--color-primary);
	}

	.item.drop-before::before,
	.item.drop-after::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		height: var(--border-width-md);
		background: var(--color-primary);
	}

	.item.drop-before::before {
		top: 0;
	}

	.item.drop-after::after {
		bottom: 0;
	}

	.text {
		flex: 1;
		min-width: 0;
	}

	.name {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.path-tooltip {
		display: none;
		position: absolute;
		top: 100%;
		left: var(--space-3);
		margin-top: var(--space-1);
		/* Bounded to the row's own width (not a fixed px value): `.list`
		 * (this row's scroll-container ancestor) sets `overflow-y: auto`,
		 * which per the CSS overflow spec forces its computed overflow-x to
		 * `auto` too — so anything wider than `.item` gets clipped instead
		 * of floating over the terminal area, defeating the reveal-on-hover
		 * point for exactly the long paths it exists for. */
		max-width: calc(100% - var(--space-3));
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--color-surface-elevated);
		border: var(--border-width-sm) solid var(--color-border);
		box-shadow: var(--shadow-md);
		font-family: var(--font-family-mono);
		font-size: var(--text-xs);
		color: var(--color-text);
		white-space: normal;
		overflow-wrap: anywhere;
		z-index: var(--z-tooltip);
	}

	/* :focus-visible, not :focus-within: the latter also matches when a
	 * descendant is focused (the overflow menu's autofocused first item, or
	 * the row itself after a plain mouse click) and pops the tooltip up next
	 * to a menu that's clearly already telling the user what they clicked.
	 * :focus-visible reflects the browser's own keyboard-vs-pointer heuristic
	 * — same reasoning as `.item:focus-visible`'s outline above. */
	.item:focus-visible .path-tooltip {
		display: block;
	}

	.path-tooltip.path-invalid {
		color: var(--color-text-muted);
	}

	.invalid-message {
		margin-top: var(--space-1);
		font-size: var(--text-xs);
		color: var(--color-danger);
	}

	.menu-wrap {
		position: relative;
	}

	.menu-btn {
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: var(--space-1);
		border-radius: var(--radius-sm);
		visibility: hidden;
	}

	.item.hovering .menu-btn,
	.item:focus-within .menu-btn {
		visibility: visible;
	}

	.menu-btn:hover {
		background: var(--color-surface);
		color: var(--color-text);
	}

	.sub-items {
		display: flex;
		flex-direction: column;
	}
</style>
