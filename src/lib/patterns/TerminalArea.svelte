<script lang="ts">
	import { onMount } from "svelte";
	import SplitPaneContainer from "$lib/components/SplitPaneContainer.svelte";
	import { terminalStore, type SplitDirection, type DropZone } from "$lib/stores/terminal.svelte";
	import { closeTerminal, splitPane as splitPaneApi, openTerminal, errorMessage } from "$lib/api";
	import { settingsStore } from "$lib/stores/settings.svelte";
	import { appStore } from "$lib/stores/app.svelte";
	import { matchesCombo } from "$lib/keybindings";
	import { disposeTerminalHandle } from "$lib/terminal-registry";

	async function handleClosePane(tabId: string, sessionId: string) {
		const { closedSessionIds } = terminalStore.closePane(tabId, sessionId);
		for (const id of closedSessionIds) {
			try {
				await closeTerminal(id);
			} catch {
				// Session may already be gone.
			}
			// The session is genuinely gone now (or never existed) — this is the
			// one place its xterm.js Terminal/scrollback/PTY subscriptions
			// actually get torn down, not <TerminalPane>'s own onDestroy (which
			// fires on harmless remounts too — see $lib/terminal-registry).
			disposeTerminalHandle(id);
		}
	}

	async function handleSplitPane(tabId: string, sessionId: string, direction: SplitDirection) {
		const cwd = terminalStore.getPaneCwd(tabId, sessionId);
		if (!cwd) return;
		const newSessionId = terminalStore.splitPane(tabId, sessionId, direction, cwd);
		try {
			await splitPaneApi(newSessionId, cwd);
			terminalStore.setPaneStatus(newSessionId, "ready");
		} catch (e) {
			terminalStore.setPaneStatus(newSessionId, "error", errorMessage(e));
		}
	}

	function handleResizeSplit(tabId: string, splitId: string, sizes: number[]) {
		terminalStore.resizeSplit(tabId, splitId, sizes);
	}

	/** Drag to move (components.md v3.1, PRD FR-08 v1.16) — starting a drag
	 *  from a pane's own header, distinct from the sidebar's drag sources. */
	function handleDragStartPane(tabId: string, sessionId: string) {
		terminalStore.startDraggingPane(tabId, sessionId);
	}

	function handleDragEndPane() {
		terminalStore.stopDragging();
	}

	/** components.md pattern "Sidebar drag-to-split". Every open tab's pane
	 *  tree stays mounted (see the {#each terminalStore.tabs} below — only
	 *  the active one is visible, the rest are `display:none` so their
	 *  xterm.js buffers stay alive across switches, see TerminalPane.svelte),
	 *  but only the active tab's tree is actually visible/interactive, so a
	 *  drop can only ever target it in practice — that's the tab id used
	 *  here, not something passed in from the drop event itself. */
	async function handleDrop(targetSessionId: string, zone: DropZone) {
		const source = terminalStore.dragSource;
		const targetTabId = terminalStore.activeTabId;
		if (!source || !targetTabId) return;

		if (source.kind === "graft") {
			terminalStore.graftTab(source.tabId, targetTabId, targetSessionId, zone);
			return;
		}

		// `move-pane` (v3.1): dragging an already-open pane by its own header
		// to relocate it — same-tab only (source.tabId is always targetTabId
		// in practice, since only the active tab's panes are ever visible to
		// drag onto), reuses the exact session, no IPC call needed.
		if (source.kind === "move-pane") {
			terminalStore.movePaneWithinTab(source.tabId, source.sessionId, targetSessionId, zone);
			return;
		}

		// `spawn`: the dragged sidebar row had no existing session to reuse —
		// a fresh one spawns directly into the target's pane tree, running the
		// dragged project's setup commands (FR-08 v1.4).
		const newSessionId = terminalStore.spawnPaneInto(targetTabId, targetSessionId, zone, source.cwd);
		try {
			await openTerminal(source.projectId, newSessionId);
			terminalStore.setPaneStatus(newSessionId, "ready");
		} catch (e) {
			terminalStore.setPaneStatus(newSessionId, "error", errorMessage(e));
		}
		terminalStore.stopDragging();
	}

	/** FR-13 keyboard pane split/move-focus (architecture.md §5.6). Capture
	 * phase on window — before the event ever reaches the focused
	 * TerminalPane's xterm.js textarea, the same reasoning as the Ctrl+Shift+V
	 * fix (a bubble-phase listener here would run too late: xterm would
	 * already have sent the keystroke to the shell as normal input by the
	 * time it bubbled back up to window). Skipped while any Modal is open
	 * (`role="dialog"`) — pane shortcuts shouldn't fire while, say, the
	 * Settings modal's own fields have focus (unspecified in components.md —
	 * review needed; this is the escalation-rule treatment). */
	function handleGlobalKeydown(e: KeyboardEvent) {
		// `e.target` is `window`/`document` (no `.closest`) whenever nothing
		// in the page currently has focus — not just a test artifact, a real
		// state the very first keydown after launch can land in.
		if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return;

		const kb = settingsStore.keybindings;

		// Unlike every other action below, sidebar.toggle doesn't operate on
		// the active tab/pane — it must still fire with no tab open at all
		// (e.g. hiding the sidebar to reclaim width on the empty-state view),
		// so it's checked before the tab/pane guard those actions need.
		if (matchesCombo(e, kb["sidebar.toggle"])) {
			e.preventDefault();
			e.stopPropagation();
			appStore.toggleSidebar();
			return;
		}

		const tabId = terminalStore.activeTabId;
		const tab = terminalStore.activeTab;
		if (!tabId || !tab) return;

		// preventDefault() alone only suppresses the browser's own default
		// action — it does NOT stop this capture-phase event from continuing
		// to the focused TerminalPane's xterm.js textarea, which would then
		// process the same keystroke as ordinary terminal input (e.g. Alt+Left
		// leaking into the shell as a "backward-word" readline binding at the
		// same time it moves pane focus). stopPropagation() is required to
		// actually own the keystroke — code review finding B1.
		if (matchesCombo(e, kb["pane.splitBottom"])) {
			e.preventDefault();
			e.stopPropagation();
			handleSplitPane(tabId, tab.focusedPaneId, "column");
		} else if (matchesCombo(e, kb["pane.splitRight"])) {
			e.preventDefault();
			e.stopPropagation();
			handleSplitPane(tabId, tab.focusedPaneId, "row");
		} else if (matchesCombo(e, kb["pane.moveFocusLeft"])) {
			e.preventDefault();
			e.stopPropagation();
			terminalStore.moveFocus(tabId, "left");
		} else if (matchesCombo(e, kb["pane.moveFocusRight"])) {
			e.preventDefault();
			e.stopPropagation();
			terminalStore.moveFocus(tabId, "right");
		} else if (matchesCombo(e, kb["pane.moveFocusUp"])) {
			e.preventDefault();
			e.stopPropagation();
			terminalStore.moveFocus(tabId, "up");
		} else if (matchesCombo(e, kb["pane.moveFocusDown"])) {
			e.preventDefault();
			e.stopPropagation();
			terminalStore.moveFocus(tabId, "down");
		} else if (matchesCombo(e, kb["pane.moveLeft"])) {
			e.preventDefault();
			e.stopPropagation();
			terminalStore.movePaneInDirection(tabId, "left");
		} else if (matchesCombo(e, kb["pane.moveRight"])) {
			e.preventDefault();
			e.stopPropagation();
			terminalStore.movePaneInDirection(tabId, "right");
		} else if (matchesCombo(e, kb["pane.moveUp"])) {
			e.preventDefault();
			e.stopPropagation();
			terminalStore.movePaneInDirection(tabId, "up");
		} else if (matchesCombo(e, kb["pane.moveDown"])) {
			e.preventDefault();
			e.stopPropagation();
			terminalStore.movePaneInDirection(tabId, "down");
		} else if (matchesCombo(e, kb["terminal.closeSession"])) {
			e.preventDefault();
			e.stopPropagation();
			handleClosePane(tabId, tab.focusedPaneId);
		} else if (matchesCombo(e, kb["terminal.nextTab"])) {
			e.preventDefault();
			e.stopPropagation();
			terminalStore.cycleActiveTab("next");
		} else if (matchesCombo(e, kb["terminal.previousTab"])) {
			e.preventDefault();
			e.stopPropagation();
			terminalStore.cycleActiveTab("previous");
		}
	}

	onMount(() => {
		window.addEventListener("keydown", handleGlobalKeydown, true);
		return () => window.removeEventListener("keydown", handleGlobalKeydown, true);
	});
</script>

<div class="terminal-area">
	<!-- Every open tab renders here permanently, not just the active one:
	     each tab's TerminalPane owns a live xterm.js Terminal + PTY output
	     subscription, created once on mount (see TerminalPane.svelte). Only
	     conditionally mounting the active tab's tree (the pre-v1.5 approach)
	     meant switching tabs away and back destroyed and recreated that
	     xterm.js instance from scratch — losing all its buffered output and
	     scrollback even though the backend PTY session was still running the
	     whole time (regression: switching sidebar sessions away and back left
	     the pane blank and unscrollable). Keeping every tab's tree mounted
	     and only toggling visibility fixes that at the root. -->
	{#each terminalStore.tabs as tab (tab.id)}
		<div class="tab-tree" class:tab-tree-active={tab.id === terminalStore.activeTabId}>
			<SplitPaneContainer
				tabId={tab.id}
				root={tab.root}
				focusedPaneId={tab.focusedPaneId}
				active={tab.id === terminalStore.activeTabId}
				dragSource={terminalStore.dragSource}
				onFocusPane={(sessionId) => terminalStore.focusPane(tab.id, sessionId)}
				onSplitPane={(sessionId, direction) => handleSplitPane(tab.id, sessionId, direction)}
				onClosePane={(sessionId) => handleClosePane(tab.id, sessionId)}
				onResizeSplit={(splitId, sizes) => handleResizeSplit(tab.id, splitId, sizes)}
				onDrop={handleDrop}
				onDragStartPane={(sessionId) => handleDragStartPane(tab.id, sessionId)}
				onDragEndPane={handleDragEndPane}
			/>
		</div>
	{/each}
	{#if !terminalStore.activeTab}
		<div class="empty-state">
			<p>Select a project from the sidebar to open a terminal here.</p>
		</div>
	{/if}
</div>

<style>
	.terminal-area {
		flex: 1;
		height: 100%;
		min-width: 0;
	}

	.tab-tree {
		display: none;
		height: 100%;
		width: 100%;
	}

	.tab-tree-active {
		display: flex;
	}

	.empty-state {
		/* FR-15/design.md §4.7 (v2.3): this is the scrim owner for the
		   terminal area whenever no pane is open — nothing renders beneath
		   it (body deliberately paints none). When a pane IS open this
		   element isn't in the DOM at all (mutually exclusive with the
		   pane tree via the surrounding {#if}), so TerminalPane's own scrim
		   takes over instead; the two never paint at once. */
		background: var(--color-background-scrim);
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
