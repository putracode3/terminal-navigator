import { describe, it, expect, beforeEach } from "vitest";
import { terminalStore } from "./terminal.svelte";

// Singleton store — reset between tests (qa-tester principle 5: no
// inter-test dependence).
beforeEach(() => {
	terminalStore.tabs = [];
	terminalStore.activeTabId = null;
});

describe("terminalStore", () => {
	it("openTab() creates a tab with exactly one pane in 'running' status", () => {
		const tab = terminalStore.openTab("proj-1", "my-project", "/home/user/my-project");

		expect(tab.projectId).toBe("proj-1");
		expect(tab.projectName).toBe("my-project");
		expect(tab.panes).toHaveLength(1);
		expect(tab.panes[0].cwd).toBe("/home/user/my-project");
		expect(tab.panes[0].status).toBe("running");
	});

	it("openTab() focuses the new pane and activates the new tab", () => {
		const tab = terminalStore.openTab("proj-1", "my-project", "/path");

		expect(tab.focusedPaneId).toBe(tab.panes[0].sessionId);
		expect(terminalStore.activeTabId).toBe(tab.id);
		expect(terminalStore.activeTab?.id).toBe(tab.id);
	});

	it("openTab() always opens a new tab, never reuses an existing one (FR-08)", () => {
		const first = terminalStore.openTab("proj-1", "a", "/a");
		const second = terminalStore.openTab("proj-1", "a", "/a");

		expect(first.id).not.toBe(second.id);
		expect(terminalStore.tabs).toHaveLength(2);
	});

	it("setActiveTab() switches which tab is active without altering tab contents", () => {
		const first = terminalStore.openTab("proj-1", "a", "/a");
		const second = terminalStore.openTab("proj-2", "b", "/b");

		terminalStore.setActiveTab(first.id);

		expect(terminalStore.activeTabId).toBe(first.id);
		expect(terminalStore.tabs).toHaveLength(2);
		expect(terminalStore.activeTab?.id).toBe(first.id);
		void second;
	});

	it("setPaneStatus() updates only the matching pane's status across all tabs", () => {
		const tabA = terminalStore.openTab("proj-1", "a", "/a");
		const tabB = terminalStore.openTab("proj-2", "b", "/b");
		const paneAId = tabA.panes[0].sessionId;

		terminalStore.setPaneStatus(paneAId, "ready");

		const refreshedA = terminalStore.tabs.find((t) => t.id === tabA.id);
		const refreshedB = terminalStore.tabs.find((t) => t.id === tabB.id);
		expect(refreshedA?.panes[0].status).toBe("ready");
		expect(refreshedB?.panes[0].status).toBe("running"); // untouched
	});

	it("setPaneStatus() records an error message on failure", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const sessionId = tab.panes[0].sessionId;

		terminalStore.setPaneStatus(sessionId, "error", "path does not exist");

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id);
		expect(refreshed?.panes[0].status).toBe("error");
		expect(refreshed?.panes[0].errorMessage).toBe("path does not exist");
	});

	it("closeTab() removes exactly that tab and returns its panes", () => {
		const tabA = terminalStore.openTab("proj-1", "a", "/a");
		const tabB = terminalStore.openTab("proj-2", "b", "/b");

		const closedPanes = terminalStore.closeTab(tabA.id);

		expect(terminalStore.tabs.map((t) => t.id)).toEqual([tabB.id]);
		expect(closedPanes).toEqual(tabA.panes);
	});

	it("closeTab() on the active tab falls back to the last remaining tab", () => {
		const tabA = terminalStore.openTab("proj-1", "a", "/a");
		const tabB = terminalStore.openTab("proj-2", "b", "/b");
		terminalStore.setActiveTab(tabA.id);

		terminalStore.closeTab(tabA.id);

		expect(terminalStore.activeTabId).toBe(tabB.id);
	});

	it("closeTab() of the last tab leaves activeTabId null", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		terminalStore.closeTab(tab.id);

		expect(terminalStore.tabs).toHaveLength(0);
		expect(terminalStore.activeTabId).toBeNull();
	});

	it("closeTab() on an inactive tab leaves the active tab untouched", () => {
		const tabA = terminalStore.openTab("proj-1", "a", "/a");
		const tabB = terminalStore.openTab("proj-2", "b", "/b");
		terminalStore.setActiveTab(tabB.id);

		terminalStore.closeTab(tabA.id);

		expect(terminalStore.activeTabId).toBe(tabB.id);
	});
});
