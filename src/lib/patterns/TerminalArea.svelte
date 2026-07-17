<script lang="ts">
	import Tab from "$lib/components/Tab.svelte";
	import SplitPaneContainer from "$lib/components/SplitPaneContainer.svelte";
	import { terminalStore } from "$lib/stores/terminal.svelte";
	import { closeTerminal } from "$lib/api";

	async function handleCloseTab(tabId: string) {
		const closedPanes = terminalStore.closeTab(tabId);
		for (const pane of closedPanes) {
			try {
				await closeTerminal(pane.sessionId);
			} catch {
				// Session may already be gone; closing the tab still proceeds either way.
			}
		}
	}
</script>

<div class="terminal-area">
	{#if terminalStore.tabs.length > 0}
		<div class="tab-bar" role="tablist">
			{#each terminalStore.tabs as tab (tab.id)}
				<Tab
					label={tab.projectName}
					active={tab.id === terminalStore.activeTabId}
					status={tab.panes[0]?.status ?? "ready"}
					onSelect={() => terminalStore.setActiveTab(tab.id)}
					onClose={() => handleCloseTab(tab.id)}
				/>
			{/each}
		</div>
		<div class="pane-area">
			{#if terminalStore.activeTab}
				{@const tab = terminalStore.activeTab}
				<SplitPaneContainer
					panes={tab.panes}
					focusedPaneId={tab.focusedPaneId}
					onFocusPane={(sessionId) => {
						tab.focusedPaneId = sessionId;
					}}
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
