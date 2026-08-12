<script lang="ts">
	import Button from "$lib/components/Button.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import SidebarProjectListItem from "$lib/components/SidebarProjectListItem.svelte";
	import SidebarFolder from "$lib/components/SidebarFolder.svelte";
	import ProjectFormModal from "./ProjectFormModal.svelte";
	import { appStore } from "$lib/stores/app.svelte";
	import { settingsStore } from "$lib/stores/settings.svelte";
	import { terminalStore, type TabState } from "$lib/stores/terminal.svelte";
	import type { SidebarDropBand } from "$lib/sidebar-drop-zones";
	import {
		deleteProject,
		pathExists,
		closeTerminal,
		errorMessage,
		mergeProjects,
		moveProject,
		reorderFolder,
		renameFolder,
		listSidebarEntries,
		type ProjectDto,
		type MoveDestinationDto,
	} from "$lib/api";
	import { disposeTerminalHandle } from "$lib/terminal-registry";

	let {
		onOpenProject,
		onForceNewTab,
	}: {
		onOpenProject: (project: ProjectDto) => void;
		/** FR-08 v1.3: Menu's "Open in new tab" — always opens an additional
		 *  tab, bypassing onOpenProject's switch-to-existing-tab behavior. */
		onForceNewTab: (project: ProjectDto) => void;
	} = $props();

	let formOpen = $state(false);
	let editingProject = $state<ProjectDto | undefined>(undefined);
	let pendingDelete = $state<ProjectDto | undefined>(undefined);
	let deleteError = $state("");
	let invalidProjectIds = $state<Set<string>>(new Set());

	// FR-01 edge case: a project's folder may have moved/been deleted since
	// it was added. Re-check whenever the sidebar tree changes. Uses
	// `allProjects` (every project regardless of folder membership, FR-11) —
	// path validity doesn't care where in the tree a project sits.
	$effect(() => {
		const projects = appStore.allProjects;
		Promise.all(projects.map((p) => pathExists(p.path).then((exists) => [p.id, exists] as const))).then(
			(results) => {
				invalidProjectIds = new Set(results.filter(([, exists]) => !exists).map(([id]) => id));
			},
		);
	});

	/** v2.8: Export/Import (and their success flash) moved to SettingsModal's
	 *  Data group — this banner is now exclusively for drag/rename/move
	 *  failures (still Sidebar's own concern). The sidebar has no persistent
	 *  footer chrome anymore (components.md, Sidebar layout), so this only
	 *  ever renders conditionally, at the bottom of the list, while an error
	 *  is actually live — but it still needs an owned lifetime (design.md
	 *  v2.4 rule): every write goes through `flashError` (and every clear
	 *  through `dismissError`) so exactly one place owns the timer, the same
	 *  discipline the pre-v2.8 footer banner established. */
	let dragError = $state("");
	const ERROR_DISMISS_MS = 8000;
	let errorTimer: ReturnType<typeof setTimeout> | undefined;

	function flashError(message: string) {
		dragError = message;
		clearTimeout(errorTimer);
		errorTimer = setTimeout(() => (dragError = ""), ERROR_DISMISS_MS);
	}

	function dismissError() {
		clearTimeout(errorTimer);
		dragError = "";
	}

	// FR-11: while searching, folders/grouping are set aside in favor of a
	// flat, name-filtered project list — the design spec doesn't define how
	// search should interact with folder nesting (out of FR-11's stated
	// scope), so this is a deliberate simplification, not an oversight: a
	// flat "search mode" is simple to reason about and doesn't require
	// inventing nested-match-highlighting UI this pass wasn't asked for.
	const searching = $derived(appStore.search.trim().length > 0);
	const filteredProjects = $derived(
		searching
			? appStore.allProjects.filter((p) => p.name.toLowerCase().includes(appStore.search.trim().toLowerCase()))
			: [],
	);

	function openEditForm(project: ProjectDto) {
		editingProject = project;
		formOpen = true;
	}

	/** Closes exactly one session: tears down its PTY(s) via the backend,
	 *  then removes it from the store. Shared by Menu's "Close terminal"
	 *  (single-session mode) and a Sidebar Session Sub-item's close button —
	 *  both just need the tab id. */
	async function closeSession(tabId: string) {
		const closedSessionIds = terminalStore.closeTab(tabId);
		for (const sessionId of closedSessionIds) {
			try {
				await closeTerminal(sessionId);
			} catch {
				// Session may already be gone; closing still proceeds either way.
			}
			disposeTerminalHandle(sessionId);
		}
	}

	function sessionsFor(project: ProjectDto): TabState[] {
		return terminalStore.sessionsForProject(project.id);
	}

	/** PRD FR-08 v1.4 edge case: a project with open sessions must have all
	 *  of them closed before it can be deleted. */
	async function confirmDelete() {
		if (!pendingDelete) return;
		try {
			for (const session of sessionsFor(pendingDelete)) {
				await closeSession(session.id);
			}
			await deleteProject(pendingDelete.id);
			appStore.removeProject(pendingDelete.id);
			pendingDelete = undefined;
		} catch (e) {
			deleteError = errorMessage(e);
		}
	}

	/** FR-11: resolves a drop on any sidebar row (a project or a folder
	 *  header) into the right backend call, then refreshes the whole tree
	 *  from the backend rather than replaying the same tree surgery
	 *  client-side — simpler and impossible to drift from the source of
	 *  truth (`project_store`'s own move/merge/reorder logic), at this app's
	 *  personal-scale data size a full refetch per drag is effectively free.
	 *  `targetId` is only used for the merge case — the backend's own
	 *  `merge_or_join` resolves whether it's a project or a folder id. */
	async function handleSidebarDrop(
		band: SidebarDropBand,
		targetId: string,
		destination: MoveDestinationDto,
		indexInList: number,
	) {
		const dragged = appStore.sidebarDrag;
		appStore.stopDraggingSidebarEntry();
		if (!dragged || dragged.id === targetId) return;

		try {
			if (band === "merge") {
				if (dragged.kind === "folder") return; // folders never merge — the UI already prevents offering this
				await mergeProjects(dragged.id, targetId);
			} else {
				const index = band === "before" ? indexInList : indexInList + 1;
				if (dragged.kind === "folder") {
					await reorderFolder(dragged.id, index);
				} else {
					await moveProject(dragged.id, destination, index);
				}
			}
			appStore.setEntries(await listSidebarEntries());
		} catch (e) {
			flashError(errorMessage(e));
		}
	}

	async function handleRenameFolder(folderId: string, name: string) {
		try {
			await renameFolder(folderId, name);
			appStore.setEntries(await listSidebarEntries());
		} catch (e) {
			flashError(errorMessage(e));
		}
	}

	/** FR-11: persists a folder's expand/collapse toggle. `settingsStore`
	 *  already rolls its own state back on a failed save (which flows back
	 *  into `SidebarFolder`'s display via its `expanded` prop) — this only
	 *  needs to surface the error, same as every other mutating action here. */
	async function handleToggleFolderExpanded(folderId: string, expanded: boolean) {
		try {
			await settingsStore.setFolderExpanded(folderId, expanded);
		} catch (e) {
			flashError(errorMessage(e));
		}
	}

	/** FR-11: dropping on genuinely empty list space (below the last row) —
	 *  the "ungrouped" drop target — moves a dragged project back to the very
	 *  end of the top level. Row-level drops call `stopPropagation()` so this
	 *  only ever fires for a drop that no row itself claimed. */
	function handleListDragOver(e: DragEvent) {
		if (!appStore.sidebarDrag) return;
		e.preventDefault();
	}

	async function handleListDrop(e: DragEvent) {
		e.preventDefault();
		const dragged = appStore.sidebarDrag;
		appStore.stopDraggingSidebarEntry();
		if (!dragged || dragged.kind !== "project") return;
		try {
			await moveProject(dragged.id, { type: "topLevel" }, appStore.entries.length);
			appStore.setEntries(await listSidebarEntries());
		} catch (e) {
			flashError(errorMessage(e));
		}
	}
</script>

{#snippet memberRow(project: ProjectDto, index: number, destination: MoveDestinationDto)}
	{@const sessions = sessionsFor(project)}
	<SidebarProjectListItem
		{project}
		{sessions}
		activeTabId={terminalStore.activeTabId}
		invalid={invalidProjectIds.has(project.id)}
		onOpen={() => onOpenProject(project)}
		onForceNewTab={() => onForceNewTab(project)}
		onSwitchSession={(tabId) => terminalStore.setActiveTab(tabId)}
		onCloseTerminal={() => sessions[0] && closeSession(sessions[0].id)}
		onCloseSession={(tabId) => closeSession(tabId)}
		onEdit={() => openEditForm(project)}
		onDelete={() => {
			pendingDelete = project;
			deleteError = "";
		}}
		onDragStart={() => {
			if (sessions.length === 0) terminalStore.startDraggingSpawn(project.id, project.name, project.path);
			else terminalStore.startDraggingTab(sessions[0].id);
			appStore.startDraggingSidebarEntry("project", project.id);
		}}
		onSessionDragStart={(tabId) => terminalStore.startDraggingTab(tabId)}
		onDragEnd={() => {
			terminalStore.stopDragging();
			appStore.stopDraggingSidebarEntry();
		}}
		sidebarDragId={appStore.sidebarDrag?.id ?? null}
		sidebarDragKind={appStore.sidebarDrag?.kind ?? null}
		onSidebarDrop={(band) => handleSidebarDrop(band, project.id, destination, index)}
	/>
{/snippet}

<aside class="sidebar">
	<!-- svelte-ignore a11y_no_static_element_interactions -- FR-11 "ungrouped" drop target: a project dragged onto genuinely empty list space (below the last row) moves back to top level. Drag has no keyboard equivalent anywhere in this app (documented gap, components.md Sidebar Folder Accessibility) — this container is a drop *target* only, never itself clicked/focused. -->
	<div class="list" ondragover={handleListDragOver} ondrop={handleListDrop}>
		{#if searching}
			{#each filteredProjects as project, i (project.id)}
				{@render memberRow(project, i, { type: "topLevel" })}
			{/each}
			{#if filteredProjects.length === 0}
				<p class="empty">No matching projects.</p>
			{/if}
		{:else}
			{#each appStore.entries as entry, topIndex (entry.id)}
				{#if entry.type === "project"}
					{@render memberRow(entry, topIndex, { type: "topLevel" })}
				{:else}
					<SidebarFolder
						folder={entry}
						expanded={settingsStore.isFolderExpanded(entry.id)}
						onToggleExpanded={(expanded) => handleToggleFolderExpanded(entry.id, expanded)}
						sidebarDragId={appStore.sidebarDrag?.id ?? null}
						sidebarDragKind={appStore.sidebarDrag?.kind ?? null}
						onSidebarDrop={(band) => handleSidebarDrop(band, entry.id, { type: "topLevel" }, topIndex)}
						onDragStart={() => appStore.startDraggingSidebarEntry("folder", entry.id)}
						onDragEnd={() => appStore.stopDraggingSidebarEntry()}
						onRename={(name) => handleRenameFolder(entry.id, name)}
						{memberRow}
					/>
				{/if}
			{/each}
			{#if appStore.entries.length === 0}
				<p class="empty">No projects yet. Click <strong>+ Add project</strong> to get started.</p>
			{/if}
		{/if}
	</div>
	{#if dragError}
		<div class="error-banner" role="alert">
			<p class="error">{dragError}</p>
			<button class="error-dismiss" aria-label="Dismiss error" onclick={dismissError}>✕</button>
		</div>
	{/if}
</aside>

<ProjectFormModal open={formOpen} project={editingProject} onClose={() => (formOpen = false)} />

<Modal
	open={!!pendingDelete}
	title="Delete project"
	variant="confirm"
	onClose={() => (pendingDelete = undefined)}
>
	{#snippet children()}
		<p>
			Delete <strong>{pendingDelete?.name}</strong>? This removes it from Terminal Navigator only —
			the project folder on disk is not affected.
		</p>
		{#if deleteError}<p class="error">{deleteError}</p>{/if}
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (pendingDelete = undefined)}>Cancel</Button>
		<Button variant="danger" onclick={confirmDelete}>Delete project</Button>
	{/snippet}
</Modal>

<style>
	.sidebar {
		width: var(--sidebar-width);
		height: 100%;
		display: flex;
		flex-direction: column;
		/* FR-15: paints at the scrim alpha so the sidebar is see-through too
		   (whole-app scope). Stacks over body's scrim, so it is always MORE
		   opaque than the root — never give it a lower alpha (design.md §4.7). */
		background: var(--color-surface-scrim);
		border-right: var(--border-width-sm) solid var(--color-border);
	}

	:global([data-sidebar-position="right"]) .sidebar {
		border-right: none;
		border-left: var(--border-width-sm) solid var(--color-border);
	}

	.list {
		flex: 1;
		overflow-y: auto;
		padding: 0 var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.empty {
		padding: var(--space-4) var(--space-3);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.error {
		margin: 0;
		color: var(--color-danger);
		font-size: var(--text-xs);
	}

	/* v2.8: no longer inside a persistent footer (Sidebar has none anymore) —
	   this only mounts while `dragError` is actually set, so it needs its own
	   spacing rather than inheriting a footer's padding/border-top. */
	.error-banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3);
		border-top: var(--border-width-sm) solid var(--color-border);
	}

	.error-banner > .error {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.error-dismiss {
		flex-shrink: 0;
		background: transparent;
		border: none;
		color: var(--color-danger);
		cursor: pointer;
		padding: 0 var(--space-1);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
	}

	.error-dismiss:hover {
		background: var(--color-surface-elevated);
	}

	.error-dismiss:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}
</style>
