<script lang="ts">
	import Button from "./Button.svelte";

	let {
		id,
		label,
		value = $bindable(""),
		variant = "default",
		placeholder,
		error,
		disabled = false,
		autofocus = false,
		onBrowse,
		onEnter,
	}: {
		id: string;
		label: string;
		value?: string;
		variant?: "default" | "path" | "password";
		placeholder?: string;
		error?: string;
		disabled?: boolean;
		/** Focuses this field as soon as it's mounted — use only for the one
		 *  field a screen should land on (e.g. the migration prompt's legacy
		 *  password field), never more than one per view. */
		autofocus?: boolean;
		onBrowse?: () => void;
		onEnter?: () => void;
	} = $props();

	let revealed = $state(false);
	const isPassword = $derived(variant === "password" && !revealed);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Enter") onEnter?.();
	}
</script>

<div class="field">
	<label for={id}>{label}</label>
	<div class="input-row" class:has-error={!!error}>
		{#if variant === "password"}
			<span class="affix-icon" aria-hidden="true">🔒</span>
		{/if}
		<!-- svelte-ignore a11y_autofocus -- opt-in only, via the `autofocus` prop, and used exactly once per view (e.g. the migration prompt's sole field) — the accepted exception to "avoid autofocus", not indiscriminate use -->
		<input
			{id}
			{placeholder}
			{disabled}
			{autofocus}
			type={isPassword ? "password" : "text"}
			bind:value
			onkeydown={handleKeydown}
			aria-invalid={!!error}
			aria-describedby={error ? `${id}-error` : undefined}
		/>
		{#if variant === "path"}
			<Button variant="secondary" size="sm" onclick={() => onBrowse?.()}>Browse…</Button>
		{:else if variant === "password"}
			<Button
				variant="ghost"
				size="icon"
				ariaLabel={revealed ? "Hide password" : "Show password"}
				onclick={() => (revealed = !revealed)}
			>
				{revealed ? "🙈" : "👁"}
			</Button>
		{/if}
	</div>
	{#if error}
		<p class="help-text error" id={`${id}-error`}>{error}</p>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	label {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: var(--control-height-md);
		padding: 0 var(--space-3);
		background: var(--color-surface);
		border: var(--border-width-sm) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
	}

	.input-row:focus-within {
		border-color: var(--color-primary);
	}

	.input-row.has-error {
		border-color: var(--color-danger);
	}

	input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		font-size: var(--text-sm);
		color: var(--color-text);
	}

	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.affix-icon {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}

	.help-text {
		margin: 0;
		font-size: var(--text-xs);
	}

	.help-text.error {
		color: var(--color-danger);
	}
</style>
