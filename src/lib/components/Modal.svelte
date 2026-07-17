<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		open,
		title,
		variant = "form",
		closeOnBackdropClick = true,
		onClose,
		children,
		footer,
	}: {
		open: boolean;
		title: string;
		variant?: "form" | "confirm";
		closeOnBackdropClick?: boolean;
		onClose: () => void;
		children: Snippet;
		footer: Snippet;
	} = $props();

	let dialogEl: HTMLDivElement | undefined = $state();
	let previouslyFocused: HTMLElement | null = null;

	$effect(() => {
		if (open) {
			previouslyFocused = document.activeElement as HTMLElement;
			queueMicrotask(() => {
				dialogEl?.querySelector<HTMLElement>("button, input, textarea, [tabindex]")?.focus();
			});
		} else {
			previouslyFocused?.focus();
		}
	});

	function focusableEls(): HTMLElement[] {
		if (!dialogEl) return [];
		return Array.from(
			dialogEl.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]:not([tabindex="-1"])'),
		);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.stopPropagation();
			onClose();
			return;
		}
		if (e.key === "Tab") {
			const els = focusableEls();
			if (els.length === 0) return;
			const first = els[0];
			const last = els[els.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}
</script>

{#if open}
	<div
		class="backdrop"
		onclick={() => closeOnBackdropClick && onClose()}
		role="presentation"
	>
		<div
			class="dialog dialog-{variant}"
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-title"
			tabindex="-1"
			bind:this={dialogEl}
			onclick={(e) => e.stopPropagation()}
			onkeydown={handleKeydown}
		>
			<header class="dialog-header">
				<h2 id="modal-title">{title}</h2>
				<button class="close-btn" aria-label="Close dialog" onclick={() => onClose()}>✕</button>
			</header>
			<div class="dialog-body">
				{@render children()}
			</div>
			<footer class="dialog-footer">
				{@render footer()}
			</footer>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: var(--color-backdrop);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal-backdrop);
		animation: backdrop-in var(--duration-base) var(--ease-out);
	}

	.dialog {
		background: var(--color-surface-elevated);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		z-index: var(--z-modal);
		display: flex;
		flex-direction: column;
		max-height: 80vh;
		animation: dialog-in var(--duration-base) var(--ease-out);
	}

	.dialog-form {
		width: var(--modal-width-form);
	}

	.dialog-confirm {
		width: var(--modal-width-confirm);
	}

	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) var(--space-6);
		border-bottom: var(--border-width-sm) solid var(--color-border);
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: var(--text-sm);
		padding: var(--space-1);
		border-radius: var(--radius-sm);
	}
	.close-btn:hover {
		background: var(--color-surface);
		color: var(--color-text);
	}

	.dialog-body {
		padding: var(--space-6);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.dialog-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-6);
		border-top: var(--border-width-sm) solid var(--color-border);
	}

	@keyframes backdrop-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes dialog-in {
		from {
			opacity: 0;
			transform: scale(0.98);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
