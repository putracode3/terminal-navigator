import { describe, it, expect, beforeEach } from "vitest";
import { terminalStore, paneCount, findPaneInDirection, type PaneNode } from "./terminal.svelte";

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

describe("terminalStore — graftTab (Sidebar drag-to-split)", () => {
	function leafId(tab: (typeof terminalStore.tabs)[number]): string {
		return (tab.root as { sessionId: string }).sessionId;
	}

	it("rejects grafting a tab onto its own pane — no-op, returns false", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		const ok = terminalStore.graftTab(tab.id, tab.id, leafId(tab), "right");

		expect(ok).toBe(false);
		expect(terminalStore.tabs).toHaveLength(1);
		expect(terminalStore.tabs[0].root).toEqual(tab.root);
	});

	it("rejects grafting an unknown source or target tab id", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		expect(terminalStore.graftTab("does-not-exist", tab.id, leafId(tab), "right")).toBe(false);
		expect(terminalStore.graftTab(tab.id, "does-not-exist", leafId(tab), "right")).toBe(false);
	});

	it("dropping RIGHT splits row, source becomes the second (right) child", () => {
		const source = terminalStore.openTab("proj-1", "src", "/src");
		const target = terminalStore.openTab("proj-2", "tgt", "/tgt");
		const sourceSessionId = leafId(source);
		const targetSessionId = leafId(target);

		const ok = terminalStore.graftTab(source.id, target.id, targetSessionId, "right");

		expect(ok).toBe(true);
		const refreshed = terminalStore.tabs.find((t) => t.id === target.id)!;
		expect(refreshed.root).toMatchObject({ type: "split", direction: "row" });
		if (refreshed.root.type === "split") {
			expect(refreshed.root.children.map((c) => (c as { sessionId: string }).sessionId)).toEqual([
				targetSessionId,
				sourceSessionId,
			]);
		}
	});

	it("dropping LEFT splits row, source becomes the first (left) child", () => {
		const source = terminalStore.openTab("proj-1", "src", "/src");
		const target = terminalStore.openTab("proj-2", "tgt", "/tgt");
		const sourceSessionId = leafId(source);
		const targetSessionId = leafId(target);

		terminalStore.graftTab(source.id, target.id, targetSessionId, "left");

		const refreshed = terminalStore.tabs.find((t) => t.id === target.id)!;
		expect(refreshed.root).toMatchObject({ type: "split", direction: "row" });
		if (refreshed.root.type === "split") {
			expect(refreshed.root.children.map((c) => (c as { sessionId: string }).sessionId)).toEqual([
				sourceSessionId,
				targetSessionId,
			]);
		}
	});

	it("dropping TOP splits column, source becomes the first (top) child", () => {
		const source = terminalStore.openTab("proj-1", "src", "/src");
		const target = terminalStore.openTab("proj-2", "tgt", "/tgt");
		const sourceSessionId = leafId(source);
		const targetSessionId = leafId(target);

		terminalStore.graftTab(source.id, target.id, targetSessionId, "top");

		const refreshed = terminalStore.tabs.find((t) => t.id === target.id)!;
		expect(refreshed.root).toMatchObject({ type: "split", direction: "column" });
		if (refreshed.root.type === "split") {
			expect(refreshed.root.children.map((c) => (c as { sessionId: string }).sessionId)).toEqual([
				sourceSessionId,
				targetSessionId,
			]);
		}
	});

	it("dropping BOTTOM splits column, source becomes the second (bottom) child", () => {
		const source = terminalStore.openTab("proj-1", "src", "/src");
		const target = terminalStore.openTab("proj-2", "tgt", "/tgt");
		const sourceSessionId = leafId(source);
		const targetSessionId = leafId(target);

		terminalStore.graftTab(source.id, target.id, targetSessionId, "bottom");

		const refreshed = terminalStore.tabs.find((t) => t.id === target.id)!;
		expect(refreshed.root).toMatchObject({ type: "split", direction: "column" });
		if (refreshed.root.type === "split") {
			expect(refreshed.root.children.map((c) => (c as { sessionId: string }).sessionId)).toEqual([
				targetSessionId,
				sourceSessionId,
			]);
		}
	});

	it("removes the source tab from the tab list and activates the target tab", () => {
		const source = terminalStore.openTab("proj-1", "src", "/src");
		const target = terminalStore.openTab("proj-2", "tgt", "/tgt");
		terminalStore.setActiveTab(source.id);

		terminalStore.graftTab(source.id, target.id, leafId(target), "right");

		expect(terminalStore.tabs.map((t) => t.id)).toEqual([target.id]);
		expect(terminalStore.activeTabId).toBe(target.id);
	});

	it("moves the source tab's ENTIRE subtree when it has multiple panes of its own", () => {
		const source = terminalStore.openTab("proj-1", "src", "/src");
		const sourceRootId = leafId(source);
		const sourceSecondId = terminalStore.splitPane(source.id, sourceRootId, "row", "/src");
		const target = terminalStore.openTab("proj-2", "tgt", "/tgt");
		const targetSessionId = leafId(target);

		terminalStore.graftTab(source.id, target.id, targetSessionId, "right");

		const refreshed = terminalStore.tabs.find((t) => t.id === target.id)!;
		expect(paneCount(refreshed.root)).toBe(3); // target's own pane + source's 2 panes
		if (refreshed.root.type === "split") {
			const graftedSubtree = refreshed.root.children.find((c) => c.type === "split");
			expect(graftedSubtree).toBeDefined();
			expect(paneCount(graftedSubtree!)).toBe(2);
		}
		// Session ids are reused verbatim — no new PTY sessions were spawned by the graft itself.
		const allIds = collectLeafIdsForTest(refreshed.root);
		expect(allIds).toEqual(expect.arrayContaining([targetSessionId, sourceRootId, sourceSecondId]));
		expect(allIds).toHaveLength(3);
	});

	it("focuses a pane from the grafted (source) subtree after the drop", () => {
		const source = terminalStore.openTab("proj-1", "src", "/src");
		const sourceRootId = leafId(source);
		const target = terminalStore.openTab("proj-2", "tgt", "/tgt");

		terminalStore.graftTab(source.id, target.id, leafId(target), "right");

		const refreshed = terminalStore.tabs.find((t) => t.id === target.id)!;
		expect(refreshed.focusedPaneId).toBe(sourceRootId);
	});

	it("startDraggingTab/stopDragging track ephemeral drag state as a 'graft' source", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		expect(terminalStore.dragSource).toBeNull();

		terminalStore.startDraggingTab(tab.id);
		expect(terminalStore.dragSource).toEqual({ kind: "graft", tabId: tab.id });

		terminalStore.stopDragging();
		expect(terminalStore.dragSource).toBeNull();
	});

	it("startDraggingSpawn tracks ephemeral drag state as a 'spawn' source (FR-08 v1.4: 0-session drag)", () => {
		terminalStore.startDraggingSpawn("proj-1", "a", "/a");
		expect(terminalStore.dragSource).toEqual({ kind: "spawn", projectId: "proj-1", projectName: "a", cwd: "/a" });

		terminalStore.stopDragging();
		expect(terminalStore.dragSource).toBeNull();
	});

	it("a successful graft also clears dragSource", () => {
		const source = terminalStore.openTab("proj-1", "src", "/src");
		const target = terminalStore.openTab("proj-2", "tgt", "/tgt");
		terminalStore.startDraggingTab(source.id);

		terminalStore.graftTab(source.id, target.id, leafId(target), "right");

		expect(terminalStore.dragSource).toBeNull();
	});
});

describe("terminalStore — spawnPaneInto (FR-08 v1.4: 0-session sidebar drag)", () => {
	it("inserts a fresh leaf into the target tab's tree without creating a new TabState", () => {
		const target = terminalStore.openTab("proj-1", "tgt", "/tgt");
		const targetSessionId = (target.root as { sessionId: string }).sessionId;

		const newSessionId = terminalStore.spawnPaneInto(target.id, targetSessionId, "right", "/dragged-project");

		expect(terminalStore.tabs).toHaveLength(1); // no new tab — merged into target's tree
		const refreshed = terminalStore.tabs.find((t) => t.id === target.id)!;
		expect(refreshed.root).toMatchObject({ type: "split", direction: "row" });
		expect(paneCount(refreshed.root)).toBe(2);
		if (refreshed.root.type === "split") {
			const spawned = refreshed.root.children.find((c) => c.type === "leaf" && c.sessionId === newSessionId);
			expect(spawned).toMatchObject({ cwd: "/dragged-project", status: "running" });
		}
		expect(refreshed.focusedPaneId).toBe(newSessionId);
	});

	it("respects the drop zone's placement (TOP → before, column split)", () => {
		const target = terminalStore.openTab("proj-1", "tgt", "/tgt");
		const targetSessionId = (target.root as { sessionId: string }).sessionId;

		const newSessionId = terminalStore.spawnPaneInto(target.id, targetSessionId, "top", "/dragged-project");

		const refreshed = terminalStore.tabs.find((t) => t.id === target.id)!;
		expect(refreshed.root).toMatchObject({ type: "split", direction: "column" });
		if (refreshed.root.type === "split") {
			expect(refreshed.root.children.map((c) => (c as { sessionId: string }).sessionId)).toEqual([
				newSessionId,
				targetSessionId,
			]);
		}
	});
});

describe("terminalStore — sessionOrdinal & sessionsForProject (FR-08 v1.4: 'Session {n}' numbering)", () => {
	it("assigns ordinal 1 to a project's first session", () => {
		const tab = terminalStore.openTab("proj-1", "a", "/a");
		expect(tab.sessionOrdinal).toBe(1);
	});

	it("assigns increasing ordinals to a project's concurrently open sessions", () => {
		const first = terminalStore.openTab("proj-1", "a", "/a");
		const second = terminalStore.openTab("proj-1", "a", "/a");
		const third = terminalStore.openTab("proj-1", "a", "/a");

		expect([first.sessionOrdinal, second.sessionOrdinal, third.sessionOrdinal]).toEqual([1, 2, 3]);
	});

	it("does not renumber a surviving session's ordinal when an earlier one closes", () => {
		const first = terminalStore.openTab("proj-1", "a", "/a");
		const second = terminalStore.openTab("proj-1", "a", "/a");

		terminalStore.closeTab(first.id);

		const refreshedSecond = terminalStore.tabs.find((t) => t.id === second.id)!;
		expect(refreshedSecond.sessionOrdinal).toBe(2);
	});

	it("resets to 1 once every session for a project has closed", () => {
		const first = terminalStore.openTab("proj-1", "a", "/a");
		terminalStore.closeTab(first.id);

		const reopened = terminalStore.openTab("proj-1", "a", "/a");

		expect(reopened.sessionOrdinal).toBe(1);
	});

	it("numbers ordinals independently per project", () => {
		terminalStore.openTab("proj-1", "a", "/a");
		const otherProjectFirst = terminalStore.openTab("proj-2", "b", "/b");

		expect(otherProjectFirst.sessionOrdinal).toBe(1);
	});

	it("sessionsForProject() returns only that project's open sessions, in creation order", () => {
		const first = terminalStore.openTab("proj-1", "a", "/a");
		terminalStore.openTab("proj-2", "b", "/b");
		const second = terminalStore.openTab("proj-1", "a", "/a");

		expect(terminalStore.sessionsForProject("proj-1").map((t) => t.id)).toEqual([first.id, second.id]);
	});
});

describe("terminalStore — openOrSwitchToTab (FR-08 v1.3: sidebar left-click)", () => {
	it("opens a new tab when the project has none open yet", () => {
		const { tab, isNew } = terminalStore.openOrSwitchToTab("proj-1", "a", "/a");

		expect(isNew).toBe(true);
		expect(terminalStore.tabs).toHaveLength(1);
		expect(terminalStore.activeTabId).toBe(tab.id);
	});

	it("switches to the existing tab instead of opening a duplicate", () => {
		const first = terminalStore.openTab("proj-1", "a", "/a");
		terminalStore.openTab("proj-2", "b", "/b"); // a second, unrelated tab — also becomes active
		terminalStore.setActiveTab(first.id);
		// simulate focus having moved elsewhere before the user clicks the sidebar again
		terminalStore.setActiveTab(terminalStore.tabs[1].id);

		const { tab, isNew } = terminalStore.openOrSwitchToTab("proj-1", "a", "/a");

		expect(isNew).toBe(false);
		expect(tab.id).toBe(first.id);
		expect(terminalStore.tabs).toHaveLength(2); // no duplicate created
		expect(terminalStore.activeTabId).toBe(first.id);
	});

	it("switches to the FIRST-in-order tab when a project has multiple open tabs", () => {
		const first = terminalStore.openTab("proj-1", "a", "/a");
		const second = terminalStore.openTab("proj-1", "a", "/a"); // e.g. opened via "Open in new tab"

		const { tab, isNew } = terminalStore.openOrSwitchToTab("proj-1", "a", "/a");

		expect(isNew).toBe(false);
		expect(tab.id).toBe(first.id);
		expect(tab.id).not.toBe(second.id);
	});

	it("does not affect tabs belonging to other projects", () => {
		terminalStore.openTab("proj-1", "a", "/a");
		const other = terminalStore.openTab("proj-2", "b", "/b");

		terminalStore.openOrSwitchToTab("proj-1", "a", "/a");

		expect(terminalStore.tabs.find((t) => t.id === other.id)).toBeDefined();
		expect(terminalStore.tabs).toHaveLength(2);
	});
});

function collectLeafIdsForTest(node: { type: string; sessionId?: string; children?: unknown[] }): string[] {
	if (node.type === "leaf") return [node.sessionId as string];
	return (node.children as Parameters<typeof collectLeafIdsForTest>[0][]).flatMap(collectLeafIdsForTest);
}

// FR-13 keyboard pane-focus movement (architecture.md §5.6). Builds:
//   row-split[ A, column-split[ B, C ] ]
// i.e. A is the row's left sibling; B/C are stacked inside the row's right
// sibling — an i3/tmux-style traversal, not real screen geometry.
describe("terminalStore — moveFocus / findPaneInDirection (FR-13)", () => {
	function buildTree() {
		const tab = terminalStore.openTab("proj-1", "a", "/a"); // leaf A
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "row", "/b"); // row-split[A, B]
		const idC = terminalStore.splitPane(tab.id, idB, "column", "/c"); // B's slot -> column-split[B, C]
		return { tabId: tab.id, idA, idB, idC };
	}

	it("moves right from a row-split's left sibling into the nested split's first leaf", () => {
		const { tabId, idA, idB } = buildTree();
		terminalStore.focusPane(tabId, idA);

		terminalStore.moveFocus(tabId, "right");

		expect(terminalStore.tabs.find((t) => t.id === tabId)?.focusedPaneId).toBe(idB);
	});

	it("moves left back from the nested split into the row-split's left sibling", () => {
		const { tabId, idA, idB } = buildTree();
		terminalStore.focusPane(tabId, idB);

		terminalStore.moveFocus(tabId, "left");

		expect(terminalStore.tabs.find((t) => t.id === tabId)?.focusedPaneId).toBe(idA);
	});

	it("moves down within the nested column-split", () => {
		const { tabId, idB, idC } = buildTree();
		terminalStore.focusPane(tabId, idB);

		terminalStore.moveFocus(tabId, "down");

		expect(terminalStore.tabs.find((t) => t.id === tabId)?.focusedPaneId).toBe(idC);
	});

	it("moves up within the nested column-split", () => {
		const { tabId, idB, idC } = buildTree();
		terminalStore.focusPane(tabId, idC);

		terminalStore.moveFocus(tabId, "up");

		expect(terminalStore.tabs.find((t) => t.id === tabId)?.focusedPaneId).toBe(idB);
	});

	it("is a no-op at the edge of the grid (no matching ancestor split, or no neighbor in bounds)", () => {
		const { tabId, idA } = buildTree();
		terminalStore.focusPane(tabId, idA);

		terminalStore.moveFocus(tabId, "left"); // A is already the leftmost in its row
		expect(terminalStore.tabs.find((t) => t.id === tabId)?.focusedPaneId).toBe(idA);

		terminalStore.moveFocus(tabId, "up"); // A has no column-direction ancestor at all
		expect(terminalStore.tabs.find((t) => t.id === tabId)?.focusedPaneId).toBe(idA);
	});

	it("findPaneInDirection returns null for an unknown focused pane id", () => {
		const { tabId } = buildTree();
		const tab = terminalStore.tabs.find((t) => t.id === tabId)!;

		expect(findPaneInDirection(tab.root, "not-a-real-session-id", "right")).toBeNull();
	});

	it("moveFocus is a no-op for an unknown tab id (no throw)", () => {
		expect(() => terminalStore.moveFocus("not-a-real-tab-id", "right")).not.toThrow();
	});
});

describe("terminalStore — cycleActiveTab (FR-13 follow-up, terminal.nextTab/previousTab)", () => {
	it("cycles to the next tab, wrapping around at the end", () => {
		const tabA = terminalStore.openTab("proj-a", "a", "/a");
		const tabB = terminalStore.openTab("proj-b", "b", "/b");
		const tabC = terminalStore.openTab("proj-c", "c", "/c");
		terminalStore.setActiveTab(tabA.id);

		terminalStore.cycleActiveTab("next");
		expect(terminalStore.activeTabId).toBe(tabB.id);

		terminalStore.cycleActiveTab("next");
		expect(terminalStore.activeTabId).toBe(tabC.id);

		terminalStore.cycleActiveTab("next"); // wraps
		expect(terminalStore.activeTabId).toBe(tabA.id);
	});

	it("cycles to the previous tab, wrapping around at the start", () => {
		const tabA = terminalStore.openTab("proj-a", "a", "/a");
		const tabB = terminalStore.openTab("proj-b", "b", "/b");
		terminalStore.setActiveTab(tabA.id);

		terminalStore.cycleActiveTab("previous"); // wraps backward from the first tab
		expect(terminalStore.activeTabId).toBe(tabB.id);
	});

	it("is a no-op with only one tab open", () => {
		const tab = terminalStore.openTab("proj-a", "a", "/a");

		terminalStore.cycleActiveTab("next");

		expect(terminalStore.activeTabId).toBe(tab.id);
	});

	it("is a no-op with no tabs open (no throw)", () => {
		expect(() => terminalStore.cycleActiveTab("next")).not.toThrow();
		expect(terminalStore.activeTabId).toBeNull();
	});
});

// Regression (2026-07-23, user report: "buka pane 4, kadang tidak sesuai pas
// pindah terminal melalui alt+nav arrow"). `findPaneInDirection` located the
// right *neighbor subtree* but always entered it at `firstLeafId` — the
// focused pane's position along the perpendicular axis was never considered.
// In a 2x2 grid that lands on the wrong pane half the time, and moving
// left/up entered the neighbor from the far side instead of the near one.
//
//   row-split[ column-split[ A, C ], column-split[ B, D ] ]
//        A B
//        C D
describe("terminalStore — moveFocus across a 2x2 grid (perpendicular-axis alignment)", () => {
	function buildGrid() {
		const tab = terminalStore.openTab("proj-1", "a", "/a"); // leaf A
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "row", "/b"); // row[A, B]
		const idC = terminalStore.splitPane(tab.id, idA, "column", "/c"); // A -> column[A, C]
		const idD = terminalStore.splitPane(tab.id, idB, "column", "/d"); // B -> column[B, D]
		return { tabId: tab.id, idA, idB, idC, idD };
	}

	function focusedAfter(tabId: string, from: string, direction: "left" | "right" | "up" | "down") {
		terminalStore.focusPane(tabId, from);
		terminalStore.moveFocus(tabId, direction);
		return terminalStore.tabs.find((t) => t.id === tabId)?.focusedPaneId;
	}

	it("moves down from the top-right pane to the pane directly below it, not to the bottom-left", () => {
		const { tabId, idB, idD } = buildGrid();
		expect(focusedAfter(tabId, idB, "down")).toBe(idD);
	});

	it("moves down from the top-left pane to the bottom-left", () => {
		const { tabId, idA, idC } = buildGrid();
		expect(focusedAfter(tabId, idA, "down")).toBe(idC);
	});

	it("moves up from the bottom-right pane to the top-right, not to the top-left", () => {
		const { tabId, idB, idD } = buildGrid();
		expect(focusedAfter(tabId, idD, "up")).toBe(idB);
	});

	it("moves up from the bottom-left pane to the top-left", () => {
		const { tabId, idA, idC } = buildGrid();
		expect(focusedAfter(tabId, idC, "up")).toBe(idA);
	});

	it("moves right from the bottom-left pane to the bottom-right, not to the top-right", () => {
		const { tabId, idC, idD } = buildGrid();
		expect(focusedAfter(tabId, idC, "right")).toBe(idD);
	});

	it("moves left from the bottom-right pane to the bottom-left, not to the top-left", () => {
		const { tabId, idC, idD } = buildGrid();
		expect(focusedAfter(tabId, idD, "left")).toBe(idC);
	});

	it("round-trips: every pane returns to itself after moving away and back", () => {
		const { tabId, idA, idB, idC, idD } = buildGrid();
		expect(focusedAfter(tabId, focusedAfter(tabId, idA, "right")!, "left")).toBe(idA);
		expect(focusedAfter(tabId, focusedAfter(tabId, idB, "down")!, "up")).toBe(idB);
		expect(focusedAfter(tabId, focusedAfter(tabId, idC, "up")!, "down")).toBe(idC);
		expect(focusedAfter(tabId, focusedAfter(tabId, idD, "left")!, "right")).toBe(idD);
	});

	it("follows a dragged divider: after shrinking the top-left pane, moving down from the top-right still lands directly below", () => {
		const { tabId, idB, idD } = buildGrid();
		const tab = terminalStore.tabs.find((t) => t.id === tabId)!;
		const rootSplit = tab.root as { children: { id: string }[] };
		terminalStore.resizeSplit(tabId, rootSplit.children[1].id, [0.2, 0.8]);

		expect(focusedAfter(tabId, idB, "down")).toBe(idD);
	});
});
