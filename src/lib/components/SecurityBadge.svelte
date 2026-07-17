<script lang="ts">
	let {
		variant = "inline",
		label = "Encrypted",
	}: {
		variant?: "inline" | "labeled" | "error";
		label?: string;
	} = $props();

	const icon = $derived(variant === "error" ? "⚠" : "🔒");
	const title = $derived(
		variant === "error" ? "Could not decrypt — check the file or password" : "This field is encrypted at rest",
	);
</script>

<span class="security-badge badge-{variant}" {title}>
	<span aria-hidden="true">{icon}</span>
	{#if variant === "labeled" || variant === "error"}
		<span>{variant === "error" ? "Decryption failed" : label}</span>
	{:else}
		<span class="sr-only">{title}</span>
	{/if}
</span>

<style>
	.security-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border-radius: var(--radius-sm);
		font-weight: var(--weight-medium);
	}

	.badge-inline {
		font-size: var(--text-xs);
		color: var(--color-security);
	}

	.badge-labeled {
		padding: var(--space-1) var(--space-2);
		background: var(--color-security-bg-subtle);
		color: var(--color-security);
		font-size: var(--text-xs);
		border-radius: var(--radius-full);
	}

	.badge-error {
		padding: var(--space-1) var(--space-2);
		background: var(--color-danger-bg-subtle);
		color: var(--color-danger);
		font-size: var(--text-xs);
		border-radius: var(--radius-full);
	}

	.sr-only {
		/* standard visually-hidden-but-accessible clip technique below */
		position: absolute;
		width: 1px; /* token-exempt: sr-only clip technique, not a design value */
		height: 1px; /* token-exempt: sr-only clip technique, not a design value */
		padding: 0;
		margin: -1px; /* token-exempt: sr-only clip technique, not a design value */
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
