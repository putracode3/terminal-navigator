<script lang="ts">
	// components.md — Theme Preset Card: one per preset, in a radiogroup
	// grid (the grid/radiogroup container itself is the Settings Panel
	// pattern's concern, not this component's — see SettingsModal.svelte).
	import type { ThemePresetDef } from "$lib/theme-presets";

	let {
		preset,
		selected,
		onSelect,
	}: {
		preset: ThemePresetDef;
		selected: boolean;
		onSelect: () => void;
	} = $props();

	// A small, honest sample of the actual preset — not a stylized
	// abstraction (components.md Do/Don't: "must be trustworthy evidence").
	const swatchColors = $derived(
		[preset.theme.red, preset.theme.green, preset.theme.yellow, preset.theme.blue, preset.theme.cyan].filter(
			(c): c is string => !!c,
		),
	);
</script>

<button
	type="button"
	role="radio"
	aria-checked={selected}
	class="card"
	class:selected
	onclick={onSelect}
>
	<span
		class="preview"
		style:background={preset.theme.background}
		style:color={preset.theme.foreground}
	>
		<span class="preview-line">user@host</span>
		<span class="preview-swatches">
			{#each swatchColors as color, i (i)}
				<span class="swatch" style:background={color}></span>
			{/each}
		</span>
	</span>
	<span class="name">{preset.name}</span>
	{#if selected}
		<span class="check" aria-hidden="true">✓</span>
	{/if}
</button>

<style>
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-surface);
		border: var(--border-width-sm) solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: border-color var(--duration-fast) var(--ease-out);
	}

	.card:hover {
		border-color: var(--color-border-strong);
	}

	.card.selected {
		border-width: var(--border-width-md);
		border-color: var(--color-primary);
	}

	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		font-family: var(--font-family-mono);
		font-size: var(--text-xs);
	}

	.preview-line {
		white-space: nowrap;
	}

	.preview-swatches {
		display: flex;
		gap: var(--space-1);
	}

	.swatch {
		width: var(--space-3);
		height: var(--space-3);
		border-radius: var(--radius-sm);
	}

	.name {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
	}

	.check {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		color: var(--color-primary);
		font-size: var(--text-sm);
	}
</style>
