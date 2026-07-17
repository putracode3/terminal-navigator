<script lang="ts">
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import Modal from "$lib/components/Modal.svelte";
	import Input from "$lib/components/Input.svelte";
	import Textarea from "$lib/components/Textarea.svelte";
	import Button from "$lib/components/Button.svelte";
	import { addProject, updateProject, errorMessage, type ProjectDto } from "$lib/api";
	import { appStore } from "$lib/stores/app.svelte";

	let {
		open,
		project,
		onClose,
	}: {
		open: boolean;
		project?: ProjectDto;
		onClose: () => void;
	} = $props();

	let name = $state("");
	let path = $state("");
	let commandsText = $state("");
	let notes = $state("");
	let pathError = $state("");
	let saving = $state(false);

	let initial = { name: "", path: "", commandsText: "", notes: "" };
	const dirty = $derived(
		name !== initial.name ||
			path !== initial.path ||
			commandsText !== initial.commandsText ||
			notes !== initial.notes,
	);

	$effect(() => {
		if (open) {
			initial = {
				name: project?.name ?? "",
				path: project?.path ?? "",
				commandsText: (project?.setupCommands ?? []).join("\n"),
				notes: project?.notes ?? "",
			};
			name = initial.name;
			path = initial.path;
			commandsText = initial.commandsText;
			notes = initial.notes;
			pathError = "";
		}
	});

	async function handleBrowse() {
		const selected = await openDialog({ directory: true, multiple: false });
		if (typeof selected === "string") {
			path = selected;
		}
	}

	async function handleSave() {
		pathError = "";
		saving = true;
		try {
			const input = {
				name,
				path,
				setupCommands: commandsText
					.split("\n")
					.map((c) => c.trim())
					.filter((c) => c.length > 0),
				notes,
			};
			const saved = project
				? await updateProject(project.id, input)
				: await addProject(input);
			appStore.upsertProject(saved);
			onClose();
		} catch (e) {
			pathError = errorMessage(e);
		} finally {
			saving = false;
		}
	}
</script>

<Modal
	{open}
	title={project ? "Edit project" : "Add project"}
	variant="form"
	closeOnBackdropClick={!dirty}
	onClose={onClose}
>
	{#snippet children()}
		<Input id="project-name" label="Name" bind:value={name} onEnter={handleSave} />
		<Input
			id="project-path"
			label="Path"
			variant="path"
			bind:value={path}
			onBrowse={handleBrowse}
			error={pathError || undefined}
		/>
		<Textarea id="project-commands" label="Setup commands (one per line)" bind:value={commandsText} />
		<Textarea id="project-notes" label="Notes" bind:value={notes} />
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={onClose}>Cancel</Button>
		<Button variant="primary" onclick={handleSave} loading={saving}>Save project</Button>
	{/snippet}
</Modal>
