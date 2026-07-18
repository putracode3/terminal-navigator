<script lang="ts">
	import UnlockScreen from "$lib/patterns/UnlockScreen.svelte";
	import Sidebar from "$lib/patterns/Sidebar.svelte";
	import TerminalArea from "$lib/patterns/TerminalArea.svelte";
	import { appStore } from "$lib/stores/app.svelte";
	import { terminalStore } from "$lib/stores/terminal.svelte";
	import { openTerminal, errorMessage, type ProjectDto } from "$lib/api";

	async function handleOpenProject(project: ProjectDto) {
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
</script>

{#if appStore.locked}
	<UnlockScreen />
{:else}
	<div class="app-shell">
		<Sidebar onOpenProject={handleOpenProject} />
		<TerminalArea />
	</div>
{/if}
