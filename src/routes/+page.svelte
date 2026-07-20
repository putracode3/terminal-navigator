<script lang="ts">
	import UnlockScreen from "$lib/patterns/UnlockScreen.svelte";
	import Sidebar from "$lib/patterns/Sidebar.svelte";
	import TerminalArea from "$lib/patterns/TerminalArea.svelte";
	import Button from "$lib/components/Button.svelte";
	import { appStore } from "$lib/stores/app.svelte";
	import { terminalStore } from "$lib/stores/terminal.svelte";
	import { openTerminal, errorMessage, type ProjectDto } from "$lib/api";

	/** Always opens a fresh tab for `project`, regardless of whether one is
	 *  already open — FR-08 v1.3's deliberate-duplicate path, reached via
	 *  the sidebar item's Menu ("Open in new tab"). */
	async function forceOpenNewTab(project: ProjectDto) {
		const tab = terminalStore.openTab(project.id, project.name, project.path);
		if (tab.root.type !== "leaf") return; // openTab always creates a single-leaf root
		const sessionId = tab.root.sessionId;
		try {
			await openTerminal(project.id, sessionId);
			terminalStore.setPaneStatus(sessionId, "ready");
		} catch (e) {
			terminalStore.setPaneStatus(sessionId, "error", errorMessage(e));
		}
	}

	/** FR-08 v1.3: left-clicking a sidebar project switches to its
	 *  first-in-order existing tab instead of opening a duplicate; only opens
	 *  a new tab (and spawns its PTY) when this project has none open yet. */
	async function handleOpenProject(project: ProjectDto) {
		const { tab, isNew } = terminalStore.openOrSwitchToTab(project.id, project.name, project.path);
		if (!isNew || tab.root.type !== "leaf") return;
		const sessionId = tab.root.sessionId;
		try {
			await openTerminal(project.id, sessionId);
			terminalStore.setPaneStatus(sessionId, "ready");
		} catch (e) {
			terminalStore.setPaneStatus(sessionId, "error", errorMessage(e));
		}
	}
</script>

{#if appStore.locked}
	<UnlockScreen />
{:else}
	<div class="app-shell">
		{#if !appStore.sidebarHidden}
			<Sidebar onOpenProject={handleOpenProject} onForceNewTab={forceOpenNewTab} />
		{:else}
			<div class="reveal-sidebar-wrap">
				<Button variant="ghost" size="icon" ariaLabel="Show sidebar" onclick={() => appStore.toggleSidebar()}>
					▶
				</Button>
			</div>
		{/if}
		<TerminalArea />
	</div>
{/if}

<style>
	.reveal-sidebar-wrap {
		position: fixed;
		top: var(--space-3);
		left: var(--space-3);
		z-index: var(--z-dropdown);
	}
</style>
