<script lang="ts">
	import type { ProjectDto } from "$lib/api";
	import type { TabState } from "$lib/stores/terminal.svelte";
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
	} = $props();

	let menuOpen = $state(false);
	let menuAnchor = $state<{ x: number; y: number } | null>(null);
	let showInvalidMessage = $state(false);
	let dragging = $state(false);

	const mode = $derived<"empty" | "single" | "grouped">(
		sessions.length === 0 ? "empty" : sessions.length === 1 ? "single" : "grouped",
	);
	const singleSession = $derived(mode === "single" ? sessions[0] : undefined);
	const isActive = $derived(!!singleSession && singleSession.id === activeTabId);
	const hasOpenTab = $derived(mode === "single");
	const draggable = $derived(mode !== "grouped" && !invalid);

	const menuItems: MenuItemDef[] = $derived([
		{ label: "Open in new tab", onSelect: onForceNewTab },
		...(mode === "single" ? [{ label: "Close terminal", onSelect: onCloseTerminal }] : []),
		{ label: "Edit", onSelect: onEdit },
		{ label: "Delete", onSelect: onDelete, danger: true },
	]);

	function truncateMiddle(path: string, max = 34): string {
		if (path.length <= max) return path;
		const half = Math.floor((max - 1) / 2);
		return `${path.slice(0, half)}…${path.slice(path.length - half)}`;
	}

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
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -- role/tabindex are a matched pair, both conditional on the same `mode`: in `grouped` mode neither is present (components.md: the row is inert for activation, only its Menu control stays focusable), otherwise both are, so the element is never tabindex-without-a-role — the linter just can't see that statically since `role` is a dynamic expression -->
<div
	class="item"
	class:active={isActive}
	class:open={hasOpenTab && !isActive}
	class:grouped={mode === "grouped"}
	class:invalid
	class:dragging
	role={mode === "grouped" ? undefined : "button"}
	tabindex={mode === "grouped" ? undefined : 0}
	draggable={draggable}
	onclick={handleClick}
	onkeydown={(e) => e.key === "Enter" && handleClick()}
	oncontextmenu={handleContextMenu}
	ondragstart={handleDragStart}
	ondragend={handleDragEnd}
>
	<span class="dot" class:dot-invalid={invalid} aria-hidden="true"></span>
	<div class="text">
		<div class="name">{project.name}</div>
		<div class="path" class:path-invalid={invalid}>{truncateMiddle(project.path)}</div>
		{#if showInvalidMessage}<div class="invalid-message">This path no longer exists on disk.</div>{/if}
	</div>
	<div class="menu-wrap">
		<button class="menu-btn" aria-label={`More actions for ${project.name}`} onclick={openAnchoredMenu}>
			⋮
		</button>
		<Menu open={menuOpen} items={menuItems} anchorPosition={menuAnchor} onClose={() => (menuOpen = false)} />
	</div>
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

	.item:hover {
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

	.dot {
		flex-shrink: 0;
		width: var(--space-2);
		height: var(--space-2);
		border-radius: var(--radius-full);
		background: var(--color-security);
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

	.path {
		font-family: var(--font-family-mono);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dot-invalid {
		background: var(--color-danger);
	}

	.path-invalid {
		color: var(--color-danger);
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

	.item:hover .menu-btn,
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
