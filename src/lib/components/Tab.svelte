<script lang="ts">
	let {
		tabId,
		label,
		active = false,
		status = "ready",
		onSelect,
		onClose,
		onDragStart,
		onDragEnd,
	}: {
		tabId: string;
		label: string;
		active?: boolean;
		status?: "ready" | "running" | "error";
		onSelect: () => void;
		onClose: () => void;
		onDragStart: () => void;
		onDragEnd: () => void;
	} = $props();

	let dragging = $state(false);

	function handleDragStart(e: DragEvent) {
		// Firefox refuses to start a drag unless setData() is called at least
		// once; the actual payload is terminalStore.draggingTabId (set by
		// onDragStart below), not this — `drop` always fires before `dragend`,
		// so the store field is still valid at drop time.
		e.dataTransfer?.setData("text/plain", tabId);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
		dragging = true;
		onDragStart();
	}

	function handleDragEnd() {
		dragging = false;
		onDragEnd();
	}
</script>

<div
	class="tab"
	class:active
	class:dragging
	role="tab"
	aria-selected={active}
	tabindex="0"
	draggable="true"
	onclick={onSelect}
	onkeydown={(e) => e.key === "Enter" && onSelect()}
	ondragstart={handleDragStart}
	ondragend={handleDragEnd}
>
	<span class="status-dot status-{status}" aria-hidden="true"></span>
	<span class="label">{label}</span>
	<button
		class="close"
		aria-label={`Close ${label}`}
		onclick={(e) => {
			e.stopPropagation();
			onClose();
		}}
	>
		✕
	</button>
</div>

<style>
	.tab {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: var(--tab-height);
		padding: 0 var(--space-3);
		border-bottom: var(--border-width-md) solid transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: background-color var(--duration-fast) var(--ease-out);
	}

	.tab:hover {
		background: var(--color-surface-elevated);
	}

	.tab:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}

	.tab.active {
		background: var(--color-surface-elevated);
		color: var(--color-text);
		border-bottom: var(--border-width-md) solid;
		border-image: var(--color-accent-gradient) 1;
	}

	.tab.dragging {
		opacity: 0.4;
	}

	.label {
		font-size: var(--text-sm);
		white-space: nowrap;
	}

	.status-dot {
		width: var(--space-1);
		height: var(--space-1);
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.status-ready {
		background: var(--color-text-muted);
	}

	.status-running {
		background: var(--color-primary);
		animation: pulse var(--duration-slow) var(--ease-in-out) infinite alternate;
	}

	.status-error {
		background: var(--color-danger);
	}

	.close {
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		opacity: 0;
		padding: var(--space-1);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}

	.tab:hover .close,
	.tab:focus-within .close {
		opacity: 1;
	}

	.close:hover {
		background: var(--color-surface);
	}

	@keyframes pulse {
		from {
			opacity: 1;
		}
		to {
			opacity: 0.35;
		}
	}
</style>
