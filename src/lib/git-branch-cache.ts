import { getGitBranch } from "$lib/api";

/** Per-cwd memoization for FR-17's branch lookup, shared across every
 *  `PaneTitle` instance/mount — a pane-tree restructuring (a perpendicular
 *  split, a drag-to-split graft) forces the same class of leaf remount
 *  `$lib/terminal-registry` exists to survive for `TerminalPane`. Unlike
 *  that PTY-subscription case there's nothing here that leaks on a repeat
 *  mount, but there's also no reason to repeat an IPC round-trip for a cwd
 *  whose branch is already resolved (or already in flight). */
let cache = new Map<string, Promise<string | null>>();

export function getCachedGitBranch(cwd: string): Promise<string | null> {
	let cached = cache.get(cwd);
	if (!cached) {
		cached = getGitBranch(cwd).catch((err) => {
			console.error(`getGitBranch(${cwd}) failed:`, err);
			return null;
		});
		cache.set(cwd, cached);
	}
	return cached;
}

export function __resetGitBranchCacheForTests(): void {
	cache = new Map();
}
