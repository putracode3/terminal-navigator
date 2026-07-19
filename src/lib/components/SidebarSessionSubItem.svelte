<script lang="ts">
	// components.md — "Sidebar Session Sub-item": one row per open session,
	// rendered only beneath a `Sidebar Project List Item` that has 2+
	// sessions open. Never rendered alone.
	import { aggregateStatus, type TabState } from "$lib/stores/terminal.svelte";

	let {
		session,
		active = false,
		onSelect,
		onClose,
		onDragStart,
		onDragEnd,
	}: {
		session: TabState;
		/** This is the currently active tab. */
		active?: boolean;
		onSelect: () => void;
		onClose: () => void;
		onDragStart: () => void;
		onDragEnd: () => void;
	} = $props();

	let dragging = $state(false);
	const status = $derived(aggregateStatus(session.root));
	const label = $derived(`Session ${session.sessionOrdinal}`);

	function handleDragStart(e: DragEvent) {
		// Firefox refuses to start a drag unless setData() is called at least
		// once; the actual payload is terminalStore.dragSource (set by
		// onDragStart below), not this — `drop` always fires before
		// `dragend`, so the store field is still valid at drop time.
		e.dataTransfer?.setData("text/plain", session.id);
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
	class="sub-item"
	class:active
	class:dragging
	role="button"
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
	.sub-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: var(--control-height-sm);
		padding: 0 var(--space-3);
		margin-left: var(--space-4);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.sub-item:hover {
		background: var(--color-surface-elevated);
	}

	.sub-item:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}

	.sub-item.active {
		color: var(--color-text);
		box-shadow: inset var(--border-width-md) 0 0 var(--color-primary);
	}

	.sub-item.dragging {
		opacity: 0.4;
	}

	.label {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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

	.sub-item:hover .close,
	.sub-item:focus-within .close {
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
