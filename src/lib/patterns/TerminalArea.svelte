<script lang="ts">
	import SplitPaneContainer from "$lib/components/SplitPaneContainer.svelte";
	import { terminalStore, type SplitDirection, type DropZone } from "$lib/stores/terminal.svelte";
	import { closeTerminal, splitPane as splitPaneApi, openTerminal, errorMessage } from "$lib/api";

	async function handleClosePane(tabId: string, sessionId: string) {
		const { closedSessionIds } = terminalStore.closePane(tabId, sessionId);
		for (const id of closedSessionIds) {
			try {
				await closeTerminal(id);
			} catch {
				// Session may already be gone.
			}
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

	/** components.md pattern "Sidebar drag-to-split". Only the active tab's
	 *  pane tree is ever mounted (see the {#if terminalStore.activeTab}
	 *  below), so a drop can only ever target the active tab — that's the
	 *  tab id used here, not something passed in from the drop event itself. */
	async function handleDrop(targetSessionId: string, zone: DropZone) {
		const source = terminalStore.dragSource;
		const targetTabId = terminalStore.activeTabId;
		if (!source || !targetTabId) return;

		if (source.kind === "graft") {
			terminalStore.graftTab(source.tabId, targetTabId, targetSessionId, zone);
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
</script>

<div class="terminal-area">
	{#if terminalStore.activeTab}
		{@const tab = terminalStore.activeTab}
		<SplitPaneContainer
			tabId={tab.id}
			root={tab.root}
			focusedPaneId={tab.focusedPaneId}
			dragSource={terminalStore.dragSource}
			onFocusPane={(sessionId) => terminalStore.focusPane(tab.id, sessionId)}
			onSplitPane={(sessionId, direction) => handleSplitPane(tab.id, sessionId, direction)}
			onClosePane={(sessionId) => handleClosePane(tab.id, sessionId)}
			onResizeSplit={(splitId, sizes) => handleResizeSplit(tab.id, splitId, sizes)}
			onDrop={handleDrop}
		/>
	{:else}
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

	.empty-state {
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
