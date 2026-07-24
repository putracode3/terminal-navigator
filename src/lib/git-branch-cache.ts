import { getGitBranch } from "$lib/api";

/** Per-cwd memoization for FR-17's branch lookup, shared across every
 *  `PaneTitle` instance/mount — a pane-tree restructuring (a perpendicular
 *  split, a drag-to-split graft) forces the same class of leaf remount
 *  `$lib/terminal-registry` exists to survive for `TerminalPane`. Unlike
 *  that PTY-subscription case there's nothing here that leaks on a repeat
 *  mount, but there's also no reason to repeat an IPC round-trip for a cwd
 *  whose branch is already resolved (or already in flight). */
let cache = new Map<string, Promise<string | null>>();

function fetchAndCache(cwd: string): Promise<string | null> {
	const promise = getGitBranch(cwd).catch((err) => {
		console.error(`getGitBranch(${cwd}) failed:`, err);
		return null;
	});
	cache.set(cwd, promise);
	return promise;
}

export function getCachedGitBranch(cwd: string): Promise<string | null> {
	return cache.get(cwd) ?? fetchAndCache(cwd);
}

/** Bypasses whatever's cached and overwrites it with a fresh lookup — used
 *  when a pane regains focus, or the user clicks the pane title's refresh
 *  button (FR-17 follow-up): the cached value can go stale the moment a
 *  `git checkout` runs inside the pane, and neither of those two triggers
 *  is the "cwd changed" case `getCachedGitBranch` is optimizing for. */
export function refreshGitBranch(cwd: string): Promise<string | null> {
	return fetchAndCache(cwd);
}

export function __resetGitBranchCacheForTests(): void {
	cache = new Map();
}
