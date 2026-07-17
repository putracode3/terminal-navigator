<script lang="ts">
	import Input from "$lib/components/Input.svelte";
	import Button from "$lib/components/Button.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import SidebarProjectListItem from "$lib/components/SidebarProjectListItem.svelte";
	import ProjectFormModal from "./ProjectFormModal.svelte";
	import { appStore } from "$lib/stores/app.svelte";
	import { terminalStore } from "$lib/stores/terminal.svelte";
	import { deleteProject, errorMessage, type ProjectDto } from "$lib/api";

	let { onOpenProject }: { onOpenProject: (project: ProjectDto) => void } = $props();

	let search = $state("");
	let formOpen = $state(false);
	let editingProject = $state<ProjectDto | undefined>(undefined);
	let pendingDelete = $state<ProjectDto | undefined>(undefined);
	let deleteError = $state("");

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

	async function confirmDelete() {
		if (!pendingDelete) return;
		try {
			await deleteProject(pendingDelete.id);
			appStore.removeProject(pendingDelete.id);
			pendingDelete = undefined;
		} catch (e) {
			deleteError = errorMessage(e);
		}
	}

	function isActive(project: ProjectDto): boolean {
		return terminalStore.tabs.some((t) => t.id === terminalStore.activeTabId && t.projectId === project.id);
	}
</script>

<aside class="sidebar">
	<div class="search-wrap">
		<Input id="project-search" label="Search" placeholder="Search projects…" bind:value={search} />
	</div>
	<div class="list">
		{#each filtered as project (project.id)}
			<SidebarProjectListItem
				{project}
				active={isActive(project)}
				onOpen={() => onOpenProject(project)}
				onEdit={() => openEditForm(project)}
				onDelete={() => {
					pendingDelete = project;
					deleteError = "";
				}}
			/>
		{/each}
		{#if filtered.length === 0}
			<p class="empty">No projects yet. Click <strong>+ Add project</strong> to get started.</p>
		{/if}
	</div>
	<div class="footer">
		<Button variant="ghost" onclick={openAddForm}>+ Add project</Button>
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
	}

	.error {
		color: var(--color-danger);
		font-size: var(--text-xs);
	}
</style>
