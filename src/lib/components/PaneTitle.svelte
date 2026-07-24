<script lang="ts">
	import { onMount } from "svelte";
	import { getCachedGitBranch } from "$lib/git-branch-cache";

	let { cwd }: { cwd: string } = $props();

	let branch = $state<string | null>(null);

	function truncateMiddle(path: string, max = 40): string {
		if (path.length <= max) return path;
		const half = Math.floor((max - 1) / 2);
		return `${path.slice(0, half)}…${path.slice(path.length - half)}`;
	}

	/** FR-17: detected once, when the pane opens — the same static-per-mount
	 *  fidelity `cwd` itself already has (neither tracks the shell's live
	 *  state, e.g. a `cd` or `git checkout` typed inside the pane afterward,
	 *  only what was true when the pane was created). `null` (no git repo
	 *  here) just renders nothing extra, not an error state.
	 *
	 *  Goes through `$lib/git-branch-cache` (memoized per cwd) rather than
	 *  calling the IPC command directly: a forced leaf remount — the same
	 *  class of pane-tree restructuring `$lib/terminal-registry` exists to
	 *  survive for `TerminalPane` — would otherwise re-fire this `onMount`
	 *  and repeat the round-trip for a cwd already resolved. */
	onMount(() => {
		getCachedGitBranch(cwd).then((result) => {
			branch = result;
		});
	});
</script>

<span class="cwd" title={cwd}>{truncateMiddle(cwd)}{#if branch}<span class="branch"> · {branch}</span>{/if}</span>

<style>
	.cwd {
		font-family: var(--font-family-mono);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.branch {
		color: var(--color-text-muted);
	}
</style>
