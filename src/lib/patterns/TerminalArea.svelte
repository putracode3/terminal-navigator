<script lang="ts">
	import Tab from "$lib/components/Tab.svelte";
	import SplitPaneContainer from "$lib/components/SplitPaneContainer.svelte";
	import { terminalStore, type PaneNode, type PaneStatus, type SplitDirection } from "$lib/stores/terminal.svelte";
	import { closeTerminal, splitPane as splitPaneApi, errorMessage } from "$lib/api";

	/** A tab's tab-bar status dot aggregates its panes: any error wins,
	 *  otherwise any still-running setup command wins, otherwise ready. */
	function aggregateStatus(node: PaneNode): PaneStatus {
		if (node.type === "leaf") return node.status;
		const statuses = node.children.map(aggregateStatus);
		if (statuses.includes("error")) return "error";
		if (statuses.includes("running")) return "running";
		return "ready";
	}

	async function handleCloseTab(tabId: string) {
		const closedSessionIds = terminalStore.closeTab(tabId);
		for (const sessionId of closedSessionIds) {
			try {
				await closeTerminal(sessionId);
			} catch {
				// Session may already be gone; closing the tab still proceeds either way.
			}
		}
	}

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
</script>

<div class="terminal-area">
	{#if terminalStore.tabs.length > 0}
		<div class="tab-bar" role="tablist">
			{#each terminalStore.tabs as tab (tab.id)}
				<Tab
					label={tab.projectName}
					active={tab.id === terminalStore.activeTabId}
					status={aggregateStatus(tab.root)}
					onSelect={() => terminalStore.setActiveTab(tab.id)}
					onClose={() => handleCloseTab(tab.id)}
				/>
			{/each}
		</div>
		<div class="pane-area">
			{#if terminalStore.activeTab}
				{@const tab = terminalStore.activeTab}
				<SplitPaneContainer
					root={tab.root}
					focusedPaneId={tab.focusedPaneId}
					onFocusPane={(sessionId) => terminalStore.focusPane(tab.id, sessionId)}
					onSplitPane={(sessionId, direction) => handleSplitPane(tab.id, sessionId, direction)}
					onClosePane={(sessionId) => handleClosePane(tab.id, sessionId)}
					onResizeSplit={(splitId, sizes) => handleResizeSplit(tab.id, splitId, sizes)}
				/>
			{/if}
		</div>
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
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.tab-bar {
		display: flex;
		overflow-x: auto;
		flex-shrink: 0;
		background: var(--color-background);
		border-bottom: var(--border-width-sm) solid var(--color-border);
	}

	.pane-area {
		flex: 1;
		min-height: 0;
	}

	.empty-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
