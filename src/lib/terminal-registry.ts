// Per-session xterm.js resources, deliberately kept OUTSIDE Svelte's own
// component lifecycle (a plain module-level Map, not a Svelte store — nothing
// here is reactive UI state).
//
// Why this exists (debugger session, "perpendicular split on an already-split
// tab still loses the split pane's scrollback"): `terminal.svelte.ts`'s
// `insertNode` sometimes has to wrap an existing leaf in a brand-new split
// node (cross-direction splits, drag-to-split grafts). That wrapping moves
// the leaf one level deeper in the tree — from Svelte's perspective, the
// leaf's key vanishes from its old `{#each}` block and a never-seen-before
// key (the new split node's id) appears in its place. Keyed `{#each}`
// reconciliation only ever preserves identity *within* one block; it cannot
// migrate a component instance across a restructuring like that, no matter
// how the keys are chosen — so `<TerminalPane>` gets destroyed and recreated
// even though the underlying shell session never closed, losing its xterm.js
// scrollback. (The *other* remount bug fixed earlier this session — a lone
// leaf's first split — was fixable with a keying trick precisely because
// that leaf's key never left its `{#each}` block's key space; this one
// can't be, by construction.)
//
// The fix: stop trying to make Svelte preserve the component instance across
// a restructuring it fundamentally can't diff across, and instead make a
// component remount harmless — the expensive, stateful resource (the xterm.js
// `Terminal`, its scrollback, its PTY event subscriptions) lives here, keyed
// by session id, independent of which `<TerminalPane>` instance currently
// wants to display it. A remounted `<TerminalPane>` re-parents the existing
// terminal's DOM into its own container instead of creating a fresh one.
//
// Disposal is centralized too, for the same reason: only
// `disposeTerminalHandle` actually tears a session down, called exactly once
// by whichever code path just confirmed the session's shell process is
// genuinely gone (TerminalArea.svelte's `handleClosePane`, Sidebar.svelte's
// `closeSession`) — never from `<TerminalPane>`'s own `onDestroy`, since that
// fires on every remount, not just real closes.
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

export interface TerminalHandle {
	term: Terminal;
	fitAddon: FitAddon;
	/** xterm.js's own internal DOM subtree, created once via `term.open()`.
	 *  Every mount (fresh or reused) re-parents this into its own container
	 *  element via a plain `appendChild` — moving an existing DOM node
	 *  preserves it (and everything xterm rendered into it) even after being
	 *  detached from the document by a Svelte unmount in between. */
	wrapperEl: HTMLDivElement;
	unlistenOutput: () => void;
	unlistenExit: () => void;
	resizeObserver: ResizeObserver;
	/** Serializes writes to the backend across the session's *entire*
	 *  lifetime, not just one component instance's — see TerminalPane.svelte's
	 *  own doc comment on why write ordering must be serialized at all. */
	writeQueue: Promise<void>;
	/** Resolves `writeQueue`'s initial gate (blocks the first keystrokes
	 *  until the PTY's real size is confirmed applied) — only ever relevant
	 *  once, right after creation; a reused handle has long since resolved
	 *  this, so later mounts skip the gating logic entirely. */
	markInitialResizeDone: () => void;
	initialResizeDone: boolean;
	/** Zoom level (Ctrl+=/Ctrl+-/Ctrl+Scroll) — persists across a remount
	 *  the same way scrollback does, rather than silently resetting to the
	 *  default the way component-local state would. */
	fontSize: number;
	/** Indirection so `resizeObserver`'s callback (created exactly once, at
	 *  this session's first-ever mount) always invokes the *current* mount's
	 *  resize logic, not a permanently-stale closure over whichever mount
	 *  happened to be first: every mount overwrites this field with a fresh
	 *  function closing over its own `active` prop/`containerEl`, but the
	 *  `ResizeObserver` instance calling it is shared and never recreated. */
	reportResize: () => void;
}

const registry = new Map<string, TerminalHandle>();

export function getTerminalHandle(sessionId: string): TerminalHandle | undefined {
	return registry.get(sessionId);
}

export function registerTerminalHandle(sessionId: string, handle: TerminalHandle): void {
	registry.set(sessionId, handle);
}

/** Actually tears a session's resources down. Call exactly once, when the
 *  session's shell process is genuinely gone — never from a `<TerminalPane>`
 *  unmount, which can happen for reasons that have nothing to do with the
 *  session actually closing (see this file's own top-of-file doc comment). */
export function disposeTerminalHandle(sessionId: string): void {
	const handle = registry.get(sessionId);
	if (!handle) return;
	registry.delete(sessionId);
	handle.unlistenOutput();
	handle.unlistenExit();
	handle.resizeObserver.disconnect();
	handle.term.dispose();
}

/** Test-only: the registry is a module-level singleton, so tests that mount
 *  `<TerminalPane>` under a fixed/reused sessionId across cases (several of
 *  this project's test files do exactly that) must reset it in `beforeEach`
 *  or a later test would silently "reuse" an earlier test's mock handle. */
export function __resetTerminalRegistryForTests(): void {
	registry.clear();
}
