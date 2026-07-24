<script lang="ts">
	import { getCachedGitBranch, refreshGitBranch } from "$lib/git-branch-cache";

	let { cwd, focused = false }: { cwd: string; focused?: boolean } = $props();

	let branch = $state<string | null>(null);
	let hasLoaded = false;

	function truncateMiddle(path: string, max = 40): string {
		if (path.length <= max) return path;
		const half = Math.floor((max - 1) / 2);
		return `${path.slice(0, half)}…${path.slice(path.length - half)}`;
	}

	function refresh() {
		refreshGitBranch(cwd).then((result) => {
			branch = result;
		});
	}

	/** FR-17 + focus-refresh follow-up: loaded once via the shared cache (so
	 *  a forced pane remount reuses an already-resolved value instead of
	 *  repeating the IPC round-trip — see `$lib/git-branch-cache`), then
	 *  refreshed — bypassing the cache — every time this pane regains focus
	 *  afterward, so a `git checkout` run inside the pane updates the title
	 *  the next time the user clicks back into it. Deliberately not a timer
	 *  or a filesystem watcher: a watcher needs a per-pane OS handle
	 *  lifecycle-managed exactly right (the class of bug `$lib/terminal-
	 *  registry` exists to prevent for PTY subscriptions), a timer wakes
	 *  every open pane on an interval regardless of whether anything
	 *  changed — both cost more than reusing a signal (`focused`) the pane
	 *  tree already computes for free. The refresh button below covers the
	 *  gap this leaves: wanting an update without switching focus away and
	 *  back. */
	$effect(() => {
		if (!hasLoaded) {
			hasLoaded = true;
			getCachedGitBranch(cwd).then((result) => {
				branch = result;
			});
		} else if (focused) {
			refresh();
		}
	});
</script>

<span class="title-group">
	<span class="path-branch" title={cwd}>
		<span class="cwd">{truncateMiddle(cwd)}</span>
		{#if branch}<span class="branch">· {branch}</span>{/if}
	</span>
	<button class="refresh" aria-label="Refresh git branch" title="Refresh git branch" onclick={refresh}>↻</button>
</span>

<style>
	.title-group {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex: 1;
		min-width: 0;
	}

	.path-branch {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		min-width: 0;
		overflow: hidden;
	}

	.cwd {
		font-family: var(--font-family-mono);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	/* Distinct from .cwd (--color-text-muted) on purpose: the branch is the
	   one piece of this label that can change while the pane is open, and
	   --color-primary is this app's existing "active/accent" signal
	   (focus border, primary buttons) rather than a new one-off color. */
	.branch {
		font-family: var(--font-family-mono);
		font-size: var(--text-xs);
		color: var(--color-primary);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.refresh {
		flex-shrink: 0;
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: var(--text-xs);
		line-height: 1;
		padding: var(--space-1);
		border-radius: var(--radius-sm);
	}
	.refresh:hover {
		background: var(--color-surface-elevated);
		color: var(--color-text);
	}
</style>
