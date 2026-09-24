import { appStore } from "$lib/stores/app.svelte";
import { terminalStore } from "$lib/stores/terminal.svelte";
import { homeDir, openHomeTerminal, openPlainTerminal, errorMessage } from "$lib/api";

async function spawnInto(sessionId: string, spawn: () => Promise<void>) {
	try {
		await spawn();
		terminalStore.setPaneStatus(sessionId, "ready");
	} catch (e) {
		terminalStore.setPaneStatus(sessionId, "error", errorMessage(e));
	}
}

/** FR-01 launch auto-open (direct product decision 2026-08-13, see
 *  docs/prd-terminal-navigator.md): opens a terminal at app launch so the app
 *  never starts on an empty terminal area. Runs once, right after the one-time
 *  initial load — `terminalStore` holds no cross-restart tab state, so "zero
 *  tabs open" is always true here; the guard is defensive, not load-bearing.
 *
 *  **Never runs setup commands** (security audit 2026-09-24, L7): the entry
 *  is found by *name*, so an imported or hand-edited data file can put
 *  arbitrary `setupCommands` on a project called "Home"; auto-running those
 *  at every launch, with no click, would turn a config import into code
 *  execution at startup. The Home entry therefore gets a plain shell at its
 *  path (`openPlainTerminal`), never `openTerminal`. Its setup commands still
 *  run when the user opens it deliberately ("Open in new tab" from the
 *  sidebar). The tab is still tied to the entry's id, so a plain sidebar
 *  click switches to this tab rather than spawning a duplicate.
 *
 *  Fallback (debugger session 2026-08-13): installs with no "Home" entry get
 *  a terminal at the platform home directory directly, bypassing the project
 *  store — nothing is added to the sidebar. No-ops if the home directory
 *  itself can't be resolved. */
export async function autoOpenHomeOnLaunch(): Promise<void> {
	if (terminalStore.tabs.length > 0) return;
	const home = appStore.homeProject;
	if (home) {
		const { tab, isNew } = terminalStore.openOrSwitchToTab(home.id, home.name, home.path);
		if (!isNew || tab.root.type !== "leaf") return;
		const sessionId = tab.root.sessionId;
		await spawnInto(sessionId, () => openPlainTerminal(sessionId, home.path));
		return;
	}
	const path = await homeDir();
	if (!path) return;
	const tab = terminalStore.openTab(null, "Home", path);
	if (tab.root.type !== "leaf") return;
	const sessionId = tab.root.sessionId;
	await spawnInto(sessionId, () => openHomeTerminal(sessionId));
}
