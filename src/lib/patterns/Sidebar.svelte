<script lang="ts">
	import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
	import Input from "$lib/components/Input.svelte";
	import Button from "$lib/components/Button.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import SidebarProjectListItem from "$lib/components/SidebarProjectListItem.svelte";
	import SidebarFolder from "$lib/components/SidebarFolder.svelte";
	import ProjectFormModal from "./ProjectFormModal.svelte";
	import SettingsModal from "./SettingsModal.svelte";
	import { appStore } from "$lib/stores/app.svelte";
	import { settingsStore } from "$lib/stores/settings.svelte";
	import { terminalStore, type TabState } from "$lib/stores/terminal.svelte";
	import type { SidebarDropBand } from "$lib/sidebar-drop-zones";
	import {
		deleteProject,
		exportConfig,
		importConfig,
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

	let search = $state("");
	let formOpen = $state(false);
	let settingsOpen = $state(false);
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

	let pendingImportSource = $state<string | undefined>(undefined);
	let syncStatus = $state("");
	let syncError = $state("");
	let syncing = $state(false);

	function flashStatus(message: string) {
		syncStatus = message;
		setTimeout(() => {
			if (syncStatus === message) syncStatus = "";
		}, 3000);
	}

	/** The sidebar footer is always-visible chrome, so anything shown there
	 *  needs an owned lifetime or it becomes permanent. Every write to
	 *  `syncError` goes through here (and every clear through `dismissError`)
	 *  so exactly one place owns the banner's lifetime — the bug this
	 *  replaces was six raw `syncError = …` assignments with nothing clearing
	 *  them, so one transient failure left a red line under Export/Import for
	 *  the rest of the session.
	 *
	 *  Longer window than `flashStatus`: an error carries a backend reason
	 *  the user has to actually read, where "Exported" does not. Tracked by
	 *  timer handle rather than `flashStatus`'s compare-the-message trick,
	 *  because the same error message recurring (retrying a failing export)
	 *  must restart the window, not let the first timeout close the second
	 *  banner early. */
	const ERROR_DISMISS_MS = 8000;
	let errorTimer: ReturnType<typeof setTimeout> | undefined;

	function flashError(message: string) {
		syncError = message;
		clearTimeout(errorTimer);
		errorTimer = setTimeout(() => (syncError = ""), ERROR_DISMISS_MS);
	}

	function dismissError() {
		clearTimeout(errorTimer);
		syncError = "";
	}

	// FR-11: while searching, folders/grouping are set aside in favor of a
	// flat, name-filtered project list — the design spec doesn't define how
	// search should interact with folder nesting (out of FR-11's stated
	// scope), so this is a deliberate simplification, not an oversight: a
	// flat "search mode" is simple to reason about and doesn't require
	// inventing nested-match-highlighting UI this pass wasn't asked for.
	const searching = $derived(search.trim().length > 0);
	const filteredProjects = $derived(
		searching
			? appStore.allProjects.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
			: [],
	);

	function openAddForm() {
		editingProject = undefined;
		formOpen = true;
	}

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

	// FR-07: export/import the single encrypted data file (ADR-0004/ADR-0008).
	// Reuses the already-unlocked session's password from appStore — the user
	// never re-types it, since import validates against that same password.
	async function handleExport() {
		const destination = await saveDialog({ defaultPath: "terminal-navigator-export.enc" });
		if (!destination) return;
		dismissError();
		syncing = true;
		try {
			await exportConfig(destination);
			flashStatus("Exported");
		} catch (e) {
			flashError(errorMessage(e));
		} finally {
			syncing = false;
		}
	}

	async function handleImportPick() {
		const source = await openDialog({ multiple: false, directory: false });
		if (typeof source === "string") {
			dismissError();
			pendingImportSource = source;
		}
	}

	async function confirmImport() {
		if (!pendingImportSource) return;
		syncing = true;
		try {
			const entries = await importConfig(pendingImportSource, appStore.password);
			appStore.setEntries(entries);
			pendingImportSource = undefined;
			flashStatus("Imported — project list replaced");
		} catch (e) {
			flashError(errorMessage(e));
			pendingImportSource = undefined;
		} finally {
			syncing = false;
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
	<div class="search-wrap">
		<Input id="project-search" label="Search" placeholder="Search projects…" bind:value={search} />
		<Button variant="ghost" size="icon" ariaLabel="Hide sidebar" onclick={() => appStore.toggleSidebar()}>
			☰
		</Button>
	</div>
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
	<div class="footer">
		<div class="add-row">
			<Button variant="ghost" onclick={openAddForm}>+ Add project</Button>
			<Button variant="ghost" size="icon" ariaLabel="Settings" onclick={() => (settingsOpen = true)}>⚙</Button>
		</div>
		<div class="sync-row">
			<Button variant="secondary" size="sm" onclick={handleExport} loading={syncing}>Export</Button>
			<Button variant="secondary" size="sm" onclick={handleImportPick} loading={syncing}>Import</Button>
		</div>
		{#if syncStatus}<p class="sync-status">{syncStatus}</p>{/if}
		{#if syncError}
			<div class="error-banner" role="alert">
				<p class="error">{syncError}</p>
				<button class="error-dismiss" aria-label="Dismiss error" onclick={dismissError}>✕</button>
			</div>
		{/if}
	</div>
</aside>

<ProjectFormModal open={formOpen} project={editingProject} onClose={() => (formOpen = false)} />

<SettingsModal open={settingsOpen} onClose={() => (settingsOpen = false)} />

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

<Modal
	open={!!pendingImportSource}
	title="Import project data"
	variant="confirm"
	onClose={() => (pendingImportSource = undefined)}
>
	{#snippet children()}
		<p>
			This replaces <strong>all</strong> projects currently in Terminal Navigator with the contents
			of the selected file (ADR-0008 — import is replace, not merge). This cannot be undone.
		</p>
		<p>
			Imported projects' setup commands will run automatically the next time their terminal opens
			— only import files from sources you trust.
		</p>
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (pendingImportSource = undefined)}>Cancel</Button>
		<Button variant="danger" onclick={confirmImport} loading={syncing}>Replace and import</Button>
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

	.search-wrap {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		padding: var(--space-3);
	}

	.search-wrap > :global(.field) {
		flex: 1;
		min-width: 0;
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

	.footer {
		padding: var(--space-3);
		border-top: var(--border-width-sm) solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.add-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.add-row > :global(.btn-md) {
		flex: 1;
	}

	.sync-row {
		display: flex;
		gap: var(--space-2);
	}

	.sync-row > :global(.btn) {
		flex: 1;
	}

	.sync-status {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-security);
	}

	.error {
		margin: 0;
		color: var(--color-danger);
		font-size: var(--text-xs);
	}

	.error-banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
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
