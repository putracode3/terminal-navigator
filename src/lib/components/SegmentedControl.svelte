<script lang="ts">
	// components.md — Segmented Control: a small, exclusive 2(-3) option
	// toggle with no preview need (this app's only use: Settings Panel's
	// sidebar-position Left/Right). For a choice needing a color/visual
	// preview, use ThemePresetCard instead.
	interface Option {
		value: string;
		label: string;
	}

	let {
		options,
		value,
		onChange,
		ariaLabel,
	}: {
		options: Option[];
		value: string;
		onChange: (value: string) => void;
		ariaLabel: string;
	} = $props();

	function selectByOffset(delta: number) {
		const currentIndex = options.findIndex((o) => o.value === value);
		const nextIndex = (currentIndex + delta + options.length) % options.length;
		onChange(options[nextIndex].value);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "ArrowRight") {
			e.preventDefault();
			selectByOffset(1);
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			selectByOffset(-1);
		}
	}
</script>

<div class="segmented" role="radiogroup" aria-label={ariaLabel}>
	{#each options as option (option.value)}
		<button
			type="button"
			role="radio"
			aria-checked={option.value === value}
			tabindex={option.value === value ? 0 : -1}
			class:selected={option.value === value}
			onclick={() => onChange(option.value)}
			onkeydown={handleKeydown}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segmented {
		display: inline-flex;
		height: var(--control-height-md);
		border: var(--border-width-sm) solid var(--color-border-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.segmented button {
		flex: 1;
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		padding: 0 var(--space-3);
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
	}

	.segmented button:hover {
		color: var(--color-text);
	}

	.segmented button.selected {
		background: var(--color-primary);
		color: var(--color-on-primary);
	}
</style>
