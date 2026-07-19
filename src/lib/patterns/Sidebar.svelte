<script lang="ts">
	import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
	import Input from "$lib/components/Input.svelte";
	import Button from "$lib/components/Button.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import SidebarProjectListItem from "$lib/components/SidebarProjectListItem.svelte";
	import ProjectFormModal from "./ProjectFormModal.svelte";
	import { appStore } from "$lib/stores/app.svelte";
	import { terminalStore, type TabState } from "$lib/stores/terminal.svelte";
	import {
		deleteProject,
		exportConfig,
		importConfig,
		pathExists,
		closeTerminal,
		errorMessage,
		type ProjectDto,
	} from "$lib/api";

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
	let editingProject = $state<ProjectDto | undefined>(undefined);
	let pendingDelete = $state<ProjectDto | undefined>(undefined);
	let deleteError = $state("");
	let invalidProjectIds = $state<Set<string>>(new Set());

	// FR-01 edge case: a project's folder may have moved/been deleted since
	// it was added. Re-check whenever the project list changes.
	$effect(() => {
		const projects = appStore.projects;
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

	const filtered = $derived(
		search.trim()
			? appStore.projects.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
			: appStore.projects,
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
		syncError = "";
		syncing = true;
		try {
			await exportConfig(destination);
			flashStatus("Exported");
		} catch (e) {
			syncError = errorMessage(e);
		} finally {
			syncing = false;
		}
	}

	async function handleImportPick() {
		const source = await openDialog({ multiple: false, directory: false });
		if (typeof source === "string") {
			syncError = "";
			pendingImportSource = source;
		}
	}

	async function confirmImport() {
		if (!pendingImportSource) return;
		syncing = true;
		try {
			const projects = await importConfig(pendingImportSource, appStore.password);
			appStore.setProjects(projects);
			pendingImportSource = undefined;
			flashStatus("Imported — project list replaced");
		} catch (e) {
			syncError = errorMessage(e);
			pendingImportSource = undefined;
		} finally {
			syncing = false;
		}
	}
</script>

<aside class="sidebar">
	<div class="search-wrap">
		<Input id="project-search" label="Search" placeholder="Search projects…" bind:value={search} />
	</div>
	<div class="list">
		{#each filtered as project (project.id)}
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
				onDragStart={() =>
					sessions.length === 0
						? terminalStore.startDraggingSpawn(project.id, project.name, project.path)
						: terminalStore.startDraggingTab(sessions[0].id)}
				onSessionDragStart={(tabId) => terminalStore.startDraggingTab(tabId)}
				onDragEnd={() => terminalStore.stopDragging()}
			/>
		{/each}
		{#if filtered.length === 0}
			<p class="empty">No projects yet. Click <strong>+ Add project</strong> to get started.</p>
		{/if}
	</div>
	<div class="footer">
		<Button variant="ghost" onclick={openAddForm}>+ Add project</Button>
		<div class="sync-row">
			<Button variant="secondary" size="sm" onclick={handleExport} loading={syncing}>Export</Button>
			<Button variant="secondary" size="sm" onclick={handleImportPick} loading={syncing}>Import</Button>
		</div>
		{#if syncStatus}<p class="sync-status">{syncStatus}</p>{/if}
		{#if syncError}<p class="error">{syncError}</p>{/if}
	</div>
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
		background: var(--color-surface);
		border-right: var(--border-width-sm) solid var(--color-border);
	}

	.search-wrap {
		padding: var(--space-3);
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
</style>
