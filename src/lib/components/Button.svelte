<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		variant = "primary",
		size = "md",
		type = "button",
		disabled = false,
		loading = false,
		ariaLabel,
		onclick,
		children,
	}: {
		variant?: "primary" | "secondary" | "ghost" | "danger";
		size?: "md" | "sm" | "icon";
		type?: "button" | "submit";
		disabled?: boolean;
		loading?: boolean;
		ariaLabel?: string;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	} = $props();
</script>

<button
	{type}
	class="btn btn-{variant} btn-{size}"
	disabled={disabled || loading}
	aria-label={ariaLabel}
	aria-busy={loading}
	onclick={(e) => !loading && onclick?.(e)}
>
	{#if loading}
		<span class="btn-spinner" aria-hidden="true"></span>
	{:else}
		{@render children()}
	{/if}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		border-radius: var(--radius-md);
		border: var(--border-width-sm) solid transparent;
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn:active:not(:disabled) {
		transform: translateY(1px);
	}

	/* Sizes */
	.btn-md {
		height: var(--control-height-md);
		padding: 0 var(--space-3);
		font-size: var(--text-sm);
	}
	.btn-sm {
		height: var(--control-height-sm);
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
	}
	.btn-icon {
		height: var(--control-height-md);
		width: var(--control-height-md);
		padding: 0;
	}

	/* Variants */
	.btn-primary {
		background: var(--color-primary);
		color: var(--color-on-primary);
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
	.btn-primary:active:not(:disabled) {
		background: var(--color-primary-active);
	}

	.btn-secondary {
		background: transparent;
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}
	.btn-secondary:hover:not(:disabled) {
		background: var(--color-surface-elevated);
	}

	.btn-ghost {
		background: transparent;
		color: var(--color-text-muted);
	}
	.btn-ghost:hover:not(:disabled) {
		background: var(--color-surface-elevated);
		color: var(--color-text);
	}

	.btn-danger {
		background: transparent;
		border-color: var(--color-danger);
		color: var(--color-danger);
	}
	.btn-danger:hover:not(:disabled) {
		background: var(--color-danger-bg-subtle);
	}

	.btn-spinner {
		width: 1em; /* token-exempt: intentionally relative to the button's own font-size, not a fixed size */
		height: 1em; /* token-exempt: intentionally relative to the button's own font-size, not a fixed size */
		border-radius: var(--radius-full);
		border: 2px solid currentColor;
		border-top-color: transparent;
		animation: btn-spin var(--duration-slow) linear infinite;
	}

	@keyframes btn-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
