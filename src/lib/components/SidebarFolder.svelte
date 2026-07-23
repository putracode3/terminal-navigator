<script lang="ts">
	import type { Snippet } from "svelte";
	import type { FolderDto, ProjectDto, MoveDestinationDto } from "$lib/api";
	import type { SidebarDragKind } from "$lib/stores/app.svelte";
	import { computeSidebarDropBand, type SidebarDropBand } from "$lib/sidebar-drop-zones";

	// components.md — "Sidebar Folder" (FR-11, v1.8): a flat, drag-and-drop
	// managed category of projects. Distinct from — and composes with —
	// `Sidebar Project List Item`'s unrelated automatic "grouped (2+
	// sessions)" display mode: a member project inside this folder still
	// renders its own session sub-items exactly as it would at top level,
	// just indented one level deeper (see the `memberRow` snippet below).
	let {
		folder,
		sidebarDragId = null,
		sidebarDragKind = null,
		onSidebarDrop,
		onDragStart,
		onDragEnd,
		onRename,
		memberRow,
	}: {
		folder: FolderDto;
		/** FR-11: id of whatever's currently being dragged for sidebar
		 *  folder/reorder purposes, or null — kept prop-driven like `Sidebar
		 *  Project List Item`'s own equivalent props. */
		sidebarDragId?: string | null;
		sidebarDragKind?: SidebarDragKind | null;
		/** Fires on a valid drop onto this folder's own header — "before"/
		 *  "after" reorder this folder's top-level position; "merge" joins a
		 *  dragged *project* into this folder, appended to the end (a
		 *  dragged folder can never validly hit "merge" — folders can't nest). */
		onSidebarDrop: (band: SidebarDropBand) => void;
		/** Folder headers are reorder-only drag sources — never a
		 *  drag-to-split source, never draggable onto another row's merge
		 *  band (components.md Do/Don't). */
		onDragStart: () => void;
		onDragEnd: () => void;
		/** Commits a non-empty, changed name. A blank/whitespace-only value
		 *  never reaches here (see `commitRename`) — the PRD's "revert to
		 *  previous name" edge case is therefore satisfied before this prop
		 *  is even called, not by whatever it does with the value. */
		onRename: (name: string) => void;
		/** Renders exactly one member row. Kept as a snippet rather than a
		 *  fixed set of forwarded props so this component never needs to
		 *  know or duplicate `Sidebar Project List Item`'s own (already
		 *  large) prop surface — the caller builds that surface once and
		 *  reuses the same snippet for top-level rows and folder members
		 *  alike. The third argument is always `{type: "folder", folderId:
		 *  folder.id}` here — this component supplies it at the call site
		 *  below so the shared snippet knows which list a member's own
		 *  reorder/move drop should target. */
		memberRow: Snippet<[ProjectDto, number, MoveDestinationDto]>;
	} = $props();

	/** Not persisted across restarts — components.md's spec calls for this
	 *  to live in the same unencrypted preferences store FR-13 already uses
	 *  (settings_store), which would need a new backend field; out of scope
	 *  for this frontend-only pass (src-tauri/ isn't touched here). Flagged
	 *  as a known gap, not a silent behavior change — see this pass's
	 *  summary. */
	let expanded = $state(true);
	let renaming = $state(false);
	let renameValue = $state("");
	let renameInputEl: HTMLInputElement | undefined = $state();
	let dragging = $state(false);
	let dropBand = $state<SidebarDropBand | null>(null);

	const validDropBand = $derived<SidebarDropBand | null>(
		sidebarDragId && sidebarDragId !== folder.id && !(dropBand === "merge" && sidebarDragKind === "folder")
			? dropBand
			: null,
	);

	$effect(() => {
		if (renaming && renameInputEl) {
			renameInputEl.focus();
			renameInputEl.select();
		}
	});

	function startRename() {
		renameValue = folder.name;
		renaming = true;
	}

	/** components.md v2.4: rename is a right-click (context-menu) gesture, not
	 *  a left-click one. Left-click on the name now falls through to the
	 *  header's expand/collapse, matching every other click on the row — the
	 *  previous "left-click the name = edit it" made the folder's most common
	 *  action (expand/collapse) unreachable on the widest part of the row and
	 *  surprised the user into rename mode. `preventDefault` suppresses the
	 *  webview's native context menu, same as `Sidebar Project List Item`'s
	 *  own right-click handler. */
	function handleHeaderContextMenu(e: MouseEvent) {
		// Already renaming: leave the webview's native context menu alone so
		// the text field keeps its cut/copy/paste menu.
		if (renaming) return;
		e.preventDefault();
		e.stopPropagation();
		startRename();
	}

	/** Keyboard equivalent for rename, preserving components.md's Accessibility
	 *  requirement that a keyboard user can reach rename without going through
	 *  the collapse toggle. F2 is the OS-conventional rename key (file
	 *  managers, IDE trees) and, unlike the old Enter-on-the-name binding,
	 *  doesn't collide with activating the name button's own expand/collapse. */
	function handleNameKeydown(e: KeyboardEvent) {
		if (e.key === "F2") {
			e.preventDefault();
			e.stopPropagation();
			startRename();
		}
	}

	/** Blank/whitespace-only input silently reverts to the previous name
	 *  (PRD edge case) — resolved entirely here, before `onRename` is ever
	 *  called, so the caller only ever sees a real, non-empty, changed name. */
	function commitRename() {
		renaming = false;
		const trimmed = renameValue.trim();
		if (trimmed && trimmed !== folder.name) onRename(trimmed);
	}

	function cancelRename() {
		renaming = false;
	}

	function toggleExpanded() {
		expanded = !expanded;
	}

	function handleHeaderDragStart(e: DragEvent) {
		e.dataTransfer?.setData("text/plain", folder.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
		dragging = true;
		onDragStart();
	}

	function handleHeaderDragEnd() {
		dragging = false;
		onDragEnd();
	}

	function handleHeaderDragOver(e: DragEvent) {
		if (!sidebarDragId) return;
		e.preventDefault();
		dropBand = computeSidebarDropBand((e.currentTarget as HTMLElement).getBoundingClientRect(), e.clientY);
	}

	function handleHeaderDragLeave() {
		dropBand = null;
	}

	function handleHeaderDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		const band = validDropBand;
		dropBand = null;
		if (band) onSidebarDrop(band);
	}
</script>

<div class="folder">
	<!-- svelte-ignore a11y_click_events_have_key_events -- the click here (expand/collapse) is a mouse-only convenience redundant with the chevron button below, which is independently focusable and keyboard-activatable (Enter/Space) via native <button> semantics — components.md's accessibility note requires the toggle to have its own focusable control, not that every element performing it also be one. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -- same reasoning, plus this element is also a drag source/drop target (FR-11): drag has no keyboard equivalent anywhere in this app (documented gap, components.md Sidebar Folder Accessibility). -->
	<div
		class="header"
		class:dragging
		class:drop-before={validDropBand === "before"}
		class:drop-merge={validDropBand === "merge"}
		class:drop-after={validDropBand === "after"}
		draggable={!renaming}
		onclick={toggleExpanded}
		oncontextmenu={handleHeaderContextMenu}
		ondragstart={handleHeaderDragStart}
		ondragend={handleHeaderDragEnd}
		ondragover={handleHeaderDragOver}
		ondragleave={handleHeaderDragLeave}
		ondrop={handleHeaderDrop}
	>
		<button
			class="chevron"
			aria-label={expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
			aria-expanded={expanded}
		>
			{expanded ? "▾" : "▸"}
		</button>
		{#if renaming}
			<input
				class="rename-input"
				bind:this={renameInputEl}
				value={renameValue}
				aria-label={`Rename ${folder.name}`}
				onclick={(e) => e.stopPropagation()}
				oninput={(e) => (renameValue = e.currentTarget.value)}
				onkeydown={(e) => {
					if (e.key === "Enter") commitRename();
					if (e.key === "Escape") cancelRename();
				}}
				onblur={commitRename}
			/>
		{:else}
			<button class="name" title="Right-click to rename" onkeydown={handleNameKeydown}>
				{folder.name}
			</button>
		{/if}
		<span
			class="count"
			aria-label={`${folder.members.length} ${folder.members.length === 1 ? "project" : "projects"}`}
		>
			({folder.members.length})
		</span>
	</div>
	{#if expanded}
		<div class="members">
			{#each folder.members as member, i (member.id)}
				{@render memberRow(member, i, { type: "folder", folderId: folder.id })}
			{/each}
		</div>
	{/if}
</div>

<style>
	.folder {
		display: flex;
		flex-direction: column;
	}

	.header {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.header:hover,
	.header:focus-within {
		background: var(--color-surface-elevated);
	}

	.header.dragging {
		opacity: 0.4;
	}

	/* FR-11 (components.md "Sidebar Folder"): identical drop-band treatment
	 * to Sidebar Project List Item — same tokens, same geometry-not-color
	 * distinction, one visual vocabulary for the whole sidebar. */
	.header.drop-merge {
		background: var(--color-primary-bg-subtle);
		box-shadow: inset 0 0 0 var(--border-width-md) var(--color-primary);
	}

	.header.drop-before::before,
	.header.drop-after::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		height: var(--border-width-md);
		background: var(--color-primary);
	}

	.header.drop-before::before {
		top: 0;
	}

	.header.drop-after::after {
		bottom: 0;
	}

	.chevron {
		flex-shrink: 0;
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: var(--space-1);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		line-height: 1;
	}

	.chevron:hover {
		background: var(--color-surface);
		color: var(--color-text);
	}

	.chevron:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}

	.name {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		text-align: left;
		padding: 0;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	.name:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}

	.rename-input {
		flex: 1;
		min-width: 0;
		background: var(--color-surface);
		border: var(--border-width-sm) solid var(--color-primary);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
		font-family: var(--font-family-sans);
	}

	.count {
		flex-shrink: 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.members {
		display: flex;
		flex-direction: column;
		padding-left: var(--space-4);
	}
</style>
