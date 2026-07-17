<script lang="ts">
	import type { ProjectDto } from "$lib/api";

	let {
		project,
		active = false,
		onOpen,
		onEdit,
		onDelete,
	}: {
		project: ProjectDto;
		active?: boolean;
		onOpen: () => void;
		onEdit: () => void;
		onDelete: () => void;
	} = $props();

	let menuOpen = $state(false);

	function truncateMiddle(path: string, max = 34): string {
		if (path.length <= max) return path;
		const half = Math.floor((max - 1) / 2);
		return `${path.slice(0, half)}…${path.slice(path.length - half)}`;
	}
</script>

<div class="item" class:active role="button" tabindex="0" onclick={onOpen} onkeydown={(e) => e.key === "Enter" && onOpen()}>
	<span class="dot" aria-hidden="true"></span>
	<div class="text">
		<div class="name">{project.name}</div>
		<div class="path">{truncateMiddle(project.path)}</div>
	</div>
	<div class="menu-wrap">
		<button
			class="menu-btn"
			aria-label={`More actions for ${project.name}`}
			onclick={(e) => {
				e.stopPropagation();
				menuOpen = !menuOpen;
			}}
		>
			⋮
		</button>
		{#if menuOpen}
			<div class="menu" role="menu">
				<button
					role="menuitem"
					onclick={(e) => {
						e.stopPropagation();
						menuOpen = false;
						onEdit();
					}}>Edit</button
				>
				<button
					role="menuitem"
					class="danger"
					onclick={(e) => {
						e.stopPropagation();
						menuOpen = false;
						onDelete();
					}}>Delete</button
				>
			</div>
		{/if}
	</div>
</div>

<style>
	.item {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.item:hover {
		background: var(--color-surface-elevated);
	}

	.item:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}

	.item.active {
		background: var(--color-surface-elevated);
		box-shadow: inset var(--border-width-md) 0 0 var(--color-primary);
	}

	.dot {
		flex-shrink: 0;
		width: var(--space-2);
		height: var(--space-2);
		border-radius: var(--radius-full);
		background: var(--color-security);
	}

	.text {
		flex: 1;
		min-width: 0;
	}

	.name {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.path {
		font-family: var(--font-family-mono);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.menu-wrap {
		position: relative;
	}

	.menu-btn {
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: var(--space-1);
		border-radius: var(--radius-sm);
		visibility: hidden;
	}

	.item:hover .menu-btn,
	.item:focus-within .menu-btn {
		visibility: visible;
	}

	.menu-btn:hover {
		background: var(--color-surface);
		color: var(--color-text);
	}

	.menu {
		position: absolute;
		right: 0;
		top: 100%;
		z-index: var(--z-dropdown);
		background: var(--color-surface-elevated);
		border: var(--border-width-sm) solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		display: flex;
		flex-direction: column;
		min-width: var(--menu-min-width);
		padding: var(--space-1);
	}

	.menu button {
		background: transparent;
		border: none;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		color: var(--color-text);
		cursor: pointer;
	}

	.menu button:hover {
		background: var(--color-surface);
	}

	.menu button.danger {
		color: var(--color-danger);
	}
</style>
