import { describe, it, expect, beforeEach } from "vitest";
import { terminalStore, paneCount, type PaneNode } from "./terminal.svelte";

// Singleton store — reset between tests (qa-tester principle 5: no
// inter-test dependence).
beforeEach(() => {
	terminalStore.tabs = [];
	terminalStore.activeTabId = null;
});

function leafIds(node: PaneNode): string[] {
	return node.type === "leaf" ? [node.sessionId] : node.children.flatMap(leafIds);
}

describe("terminalStore — tabs", () => {
	it("openTab() creates a tab whose root is a single leaf pane in 'running' status", () => {
		const tab = terminalStore.openTab("proj-1", "my-project", "/home/user/my-project");

		expect(tab.projectId).toBe("proj-1");
		expect(tab.root.type).toBe("leaf");
		expect(tab.root).toMatchObject({ cwd: "/home/user/my-project", status: "running" });
	});

	it("openTab() focuses the new pane and activates the new tab", () => {
		const tab = terminalStore.openTab("proj-1", "my-project", "/path");

		expect(tab.root.type).toBe("leaf");
		expect(tab.focusedPaneId).toBe((tab.root as { sessionId: string }).sessionId);
		expect(terminalStore.activeTabId).toBe(tab.id);
	});

	it("openTab() always opens a new tab, never reuses an existing one (FR-08)", () => {
		const first = terminalStore.openTab("proj-1", "a", "/a");
		const second = terminalStore.openTab("proj-1", "a", "/a");

		expect(first.id).not.toBe(second.id);
		expect(terminalStore.tabs).toHaveLength(2);
	});

	it("setActiveTab() switches which tab is active without altering tab contents", () => {
		const first = terminalStore.openTab("proj-1", "a", "/a");
		terminalStore.openTab("proj-2", "b", "/b");

		terminalStore.setActiveTab(first.id);

		expect(terminalStore.activeTabId).toBe(first.id);
		expect(terminalStore.tabs).toHaveLength(2);
	});

	it("closeTab() removes exactly that tab and returns all its leaf session ids", () => {
		const tabA = terminalStore.openTab("proj-1", "a", "/a");
		const tabB = terminalStore.openTab("proj-2", "b", "/b");
		const sessionA = (tabA.root as { sessionId: string }).sessionId;

		const closedIds = terminalStore.closeTab(tabA.id);

		expect(terminalStore.tabs.map((t) => t.id)).toEqual([tabB.id]);
		expect(closedIds).toEqual([sessionA]);
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
});

describe("terminalStore — setPaneStatus", () => {
	it("updates only the matching pane's status across all tabs", () => {
		const tabA = terminalStore.openTab("proj-1", "a", "/a");
		const tabB = terminalStore.openTab("proj-2", "b", "/b");
		const sessionA = (tabA.root as { sessionId: string }).sessionId;

		terminalStore.setPaneStatus(sessionA, "ready");

		const refreshedA = terminalStore.tabs.find((t) => t.id === tabA.id);
		const refreshedB = terminalStore.tabs.find((t) => t.id === tabB.id);
		expect(refreshedA?.root).toMatchObject({ status: "ready" });
		expect(refreshedB?.root).toMatchObject({ status: "running" }); // untouched
	});

	it("records an error message on failure", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const sessionId = (tab.root as { sessionId: string }).sessionId;

		terminalStore.setPaneStatus(sessionId, "error", "path does not exist");

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id);
		expect(refreshed?.root).toMatchObject({ status: "error", errorMessage: "path does not exist" });
	});
});

describe("terminalStore — splitPane (FR-08)", () => {
	it("splits a leaf into a 2-child split with equal 0.5/0.5 sizes", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;

		const newId = terminalStore.splitPane(tab.id, originalId, "row", "/a");

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(refreshed.root.type).toBe("split");
		if (refreshed.root.type === "split") {
			expect(refreshed.root.direction).toBe("row");
			expect(refreshed.root.sizes).toEqual([0.5, 0.5]);
			expect(leafIds(refreshed.root)).toEqual(expect.arrayContaining([originalId, newId]));
		}
	});

	it("focuses the newly created pane", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;

		const newId = terminalStore.splitPane(tab.id, originalId, "column", "/a");

		expect(terminalStore.tabs.find((t) => t.id === tab.id)?.focusedPaneId).toBe(newId);
	});

	it("splitting one pane a second time produces three total panes", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;
		const secondId = terminalStore.splitPane(tab.id, originalId, "row", "/a");
		terminalStore.splitPane(tab.id, secondId, "column", "/a");

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(paneCount(refreshed.root)).toBe(3);
	});

	it("splitting a second pane in the SAME direction flattens into one row/column of equal-share siblings, not a nested sub-split", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;
		const secondId = terminalStore.splitPane(tab.id, originalId, "row", "/a");
		const thirdId = terminalStore.splitPane(tab.id, secondId, "row", "/a");

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(refreshed.root.type).toBe("split");
		if (refreshed.root.type === "split") {
			// Flat 3-way split, not a 2-child split with a nested 2-child split inside.
			expect(refreshed.root.children).toHaveLength(3);
			expect(refreshed.root.children.every((c) => c.type === "leaf")).toBe(true);
			expect(leafIds(refreshed.root)).toEqual([originalId, secondId, thirdId]);
			// Existing panes auto-adjust: all three now share equally, not 0.5/0.25/0.25.
			refreshed.root.sizes.forEach((s) => expect(s).toBeCloseTo(1 / 3));
		}
	});

	it("splitting a pane in a DIFFERENT direction than its parent still nests (a genuine grid, not a flatten)", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;
		const secondId = terminalStore.splitPane(tab.id, originalId, "row", "/a");
		terminalStore.splitPane(tab.id, secondId, "column", "/a");

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(refreshed.root.type).toBe("split");
		if (refreshed.root.type === "split") {
			expect(refreshed.root.direction).toBe("row");
			expect(refreshed.root.children).toHaveLength(2); // original + the nested column-split
			const nested = refreshed.root.children.find((c) => c.type === "split");
			expect(nested).toMatchObject({ type: "split", direction: "column" });
		}
	});

	it("each pane created by splitting is independently trackable by setPaneStatus", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;
		const newId = terminalStore.splitPane(tab.id, originalId, "row", "/a");

		terminalStore.setPaneStatus(newId, "ready");

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		if (refreshed.root.type === "split") {
			const original = refreshed.root.children.find((c) => c.type === "leaf" && c.sessionId === originalId);
			const created = refreshed.root.children.find((c) => c.type === "leaf" && c.sessionId === newId);
			expect(original).toMatchObject({ status: "running" });
			expect(created).toMatchObject({ status: "ready" });
		}
	});
});

describe("terminalStore — closePane", () => {
	it("closing one of two panes collapses the split back to a single leaf", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;
		const newId = terminalStore.splitPane(tab.id, originalId, "row", "/a");

		const result = terminalStore.closePane(tab.id, newId);

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(result).toEqual({ closedSessionIds: [newId], tabClosed: false });
		expect(refreshed.root).toMatchObject({ type: "leaf", sessionId: originalId });
	});

	it("closing the last pane in a tab closes the whole tab", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;

		const result = terminalStore.closePane(tab.id, originalId);

		expect(result.tabClosed).toBe(true);
		expect(result.closedSessionIds).toEqual([originalId]);
		expect(terminalStore.tabs).toHaveLength(0);
	});

	it("closing the focused pane moves focus to a remaining pane", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;
		const newId = terminalStore.splitPane(tab.id, originalId, "row", "/a");
		// newId is now focused (splitPane focuses the new pane)

		terminalStore.closePane(tab.id, newId);

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(refreshed.focusedPaneId).toBe(originalId);
	});

	it("closing one of three panes leaves the other two intact and reachable", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;
		const secondId = terminalStore.splitPane(tab.id, originalId, "row", "/a");
		const thirdId = terminalStore.splitPane(tab.id, secondId, "column", "/a");

		terminalStore.closePane(tab.id, thirdId);

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(paneCount(refreshed.root)).toBe(2);
		expect(leafIds(refreshed.root)).toEqual(expect.arrayContaining([originalId, secondId]));
	});
});

describe("terminalStore — resizeSplit", () => {
	it("updates a split's sizes", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;
		terminalStore.splitPane(tab.id, originalId, "row", "/a");
		const split = terminalStore.tabs.find((t) => t.id === tab.id)!.root as { id: string };

		terminalStore.resizeSplit(tab.id, split.id, [0.3, 0.7]);

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!.root;
		if (refreshed.type === "split") {
			expect(refreshed.sizes).toEqual([0.3, 0.7]);
		}
	});

	it("clamps sizes to the minimum fraction rather than allowing a pane to vanish", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const originalId = (tab.root as { sessionId: string }).sessionId;
		terminalStore.splitPane(tab.id, originalId, "row", "/a");
		const split = terminalStore.tabs.find((t) => t.id === tab.id)!.root as { id: string };

		terminalStore.resizeSplit(tab.id, split.id, [0.0, 1.0]);

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!.root;
		if (refreshed.type === "split") {
			expect(refreshed.sizes[0]).toBeGreaterThanOrEqual(0.1);
		}
	});
});
