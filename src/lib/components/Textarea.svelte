<script lang="ts">
	import SecurityBadge from "./SecurityBadge.svelte";

	let {
		id,
		label,
		value = $bindable(""),
		disabled = false,
		onSave,
	}: {
		id: string;
		label: string;
		value?: string;
		disabled?: boolean;
		/** Called after a debounce/blur — autosave, no explicit Save button (components.md). */
		onSave?: (value: string) => void | Promise<void>;
	} = $props();

	let status = $state<"idle" | "saving" | "saved">("idle");
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	function scheduleSave() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(save, 1000);
	}

	async function save() {
		if (!onSave) return;
		status = "saving";
		await onSave(value);
		status = "saved";
		setTimeout(() => {
			if (status === "saved") status = "idle";
		}, 2000);
	}

	function handleBlur() {
		clearTimeout(debounceTimer);
		save();
	}
</script>

<div class="field">
	<div class="field-header">
		<label for={id}>{label}</label>
		<SecurityBadge variant="inline" />
	</div>
	<textarea
		{id}
		{disabled}
		bind:value
		oninput={scheduleSave}
		onblur={handleBlur}
		rows="6"
	></textarea>
	<p class="status" aria-live="polite">
		{#if status === "saving"}Saving…{:else if status === "saved"}Saved{/if}
	</p>
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	label {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
	}

	textarea {
		resize: vertical;
		min-height: calc(var(--space-16) * 2.5);
		padding: var(--space-3);
		background: var(--color-surface);
		border: var(--border-width-sm) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-family: var(--font-family-sans);
		font-size: var(--text-sm);
		color: var(--color-text);
	}

	textarea:focus-visible {
		border-color: var(--color-primary);
	}

	textarea:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.status {
		margin: 0;
		min-height: var(--leading-xs);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
</style>
