<script lang="ts">
	import { onMount } from "svelte";
	import MigrationPrompt from "$lib/patterns/MigrationPrompt.svelte";
	import Sidebar from "$lib/patterns/Sidebar.svelte";
	import TerminalArea from "$lib/patterns/TerminalArea.svelte";
	import TitleBar from "$lib/patterns/TitleBar.svelte";
	import WindowResizeHandles from "$lib/components/WindowResizeHandles.svelte";
	import { appStore } from "$lib/stores/app.svelte";
	import { terminalStore } from "$lib/stores/terminal.svelte";
	import { settingsStore } from "$lib/stores/settings.svelte";
	import { initStore, openTerminal, errorMessage, isAppError, type ProjectDto } from "$lib/api";

	// FR-13: settings load independently of the project store — must be
	// ready even at the migration prompt (theme/sidebar-position apply
	// without waiting on project data at all).
	onMount(() => {
		settingsStore.load().catch((err) => console.error("failed to load settings:", err));
	});

	// ADR-0014: replaces the old unlock-on-submit flow. Resolves directly
	// (no password) unless the data file is still in the pre-ADR-0014
	// encrypted format, in which case `MigrationPrompt` takes over.
	onMount(() => {
		initStore()
			.then((entries) => {
				appStore.finishLoading(entries);
				autoOpenHomeOnLaunch();
			})
			.catch((err) => {
				if (isAppError(err) && err.kind === "needs_migration") {
					appStore.setNeedsMigration();
				} else {
					console.error("failed to load project data:", errorMessage(err));
				}
			});
	});

	/** Direct product decision (2026-08-13, routed via project-navigator,
	 *  no separate PRD pass — see docs/prd-terminal-navigator.md FR-01):
	 *  opens a terminal on the seeded "Home" entry at launch so the app
	 *  never starts on an empty terminal area. Runs once, right after the
	 *  one-time initial load — `terminalStore` holds no cross-restart tab
	 *  state, so "zero tabs open" is always true here; the guard is
	 *  defensive, not load-bearing. No-ops (not an error) if the user has
	 *  already deleted/renamed the Home entry (`appStore.homeProject` is
	 *  `null`) — same "not protected, not enforced afterward" rule FR-01's
	 *  seeding itself follows. */
	function autoOpenHomeOnLaunch() {
		if (terminalStore.tabs.length > 0) return;
		const home = appStore.homeProject;
		if (home) handleOpenProject(home);
	}

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

<div class="app-root">
	<TitleBar />
	<div class="app-below-titlebar">
		{#if appStore.needsMigration}
			<MigrationPrompt />
		{:else if appStore.ready}
			<div
				class="app-shell"
				class:app-shell-reverse={settingsStore.sidebarPosition === "right"}
				data-sidebar-position={settingsStore.sidebarPosition}
			>
				{#if !appStore.sidebarHidden}
					<Sidebar onOpenProject={handleOpenProject} onForceNewTab={forceOpenNewTab} />
				{/if}
				<TerminalArea />
			</div>
		{/if}
	</div>
</div>

<WindowResizeHandles />

<style>
	.app-shell-reverse {
		flex-direction: row-reverse;
	}
</style>
