// Tab + pane state (FR-08) — a tree per tab, since a pane can be split into
// two along either axis, and each of those can be split again. A "single"
// tab (components.md's default case) is simply a tree whose root is a leaf.
export type PaneStatus = "running" | "ready" | "error";
export type SplitDirection = "row" | "column";

export interface LeafPane {
	type: "leaf";
	sessionId: string;
	cwd: string;
	status: PaneStatus;
	errorMessage?: string;
}

export interface SplitPane {
	type: "split";
	id: string;
	direction: SplitDirection;
	children: PaneNode[];
	/** Fractions parallel to `children`, always summing to 1. */
	sizes: number[];
}

export type PaneNode = LeafPane | SplitPane;

export interface TabState {
	id: string;
	projectId: string | null;
	projectName: string;
	root: PaneNode;
	focusedPaneId: string;
}

const MIN_PANE_FRACTION = 0.1;

function mapLeaf(node: PaneNode, sessionId: string, fn: (leaf: LeafPane) => LeafPane): PaneNode {
	if (node.type === "leaf") {
		return node.sessionId === sessionId ? fn(node) : node;
	}
	return { ...node, children: node.children.map((c) => mapLeaf(c, sessionId, fn)) };
}

function splitLeaf(node: PaneNode, targetId: string, direction: SplitDirection, newLeaf: LeafPane): PaneNode {
	if (node.type === "leaf") {
		// Root-level leaf (the tab's very first split) — nothing to flatten into yet.
		if (node.sessionId !== targetId) return node;
		return {
			type: "split",
			id: crypto.randomUUID(),
			direction,
			children: [node, newLeaf],
			sizes: [0.5, 0.5],
		};
	}

	const targetIndex = node.children.findIndex((c) => c.type === "leaf" && c.sessionId === targetId);
	if (targetIndex !== -1) {
		if (node.direction === direction) {
			// Same-direction split: join as an equal-share sibling in this row/
			// column, rebalancing every existing pane in it — this is the "auto
			// adjust to optimal size" behavior; splitting must never just halve
			// the one target pane's share while its siblings stay fixed.
			const children = [
				...node.children.slice(0, targetIndex + 1),
				newLeaf,
				...node.children.slice(targetIndex + 1),
			];
			const evenShare = 1 / children.length;
			return { ...node, children, sizes: children.map(() => evenShare) };
		}
		// Cross-direction split: only the target pane's own share is divided —
		// a genuine nested grid (e.g. splitting a row-pane vertically).
		const nested: PaneNode = {
			type: "split",
			id: crypto.randomUUID(),
			direction,
			children: [node.children[targetIndex] as LeafPane, newLeaf],
			sizes: [0.5, 0.5],
		};
		const children = [...node.children];
		children[targetIndex] = nested;
		return { ...node, children };
	}

	// Target pane is deeper in the tree — recurse.
	return { ...node, children: node.children.map((c) => splitLeaf(c, targetId, direction, newLeaf)) };
}

/** Removes the leaf with `targetId`; collapses a split down to its one
 *  remaining child. Returns null if the whole (sub)tree was removed. */
function removeLeaf(node: PaneNode, targetId: string): PaneNode | null {
	if (node.type === "leaf") {
		return node.sessionId === targetId ? null : node;
	}
	const newChildren: PaneNode[] = [];
	const newSizes: number[] = [];
	node.children.forEach((child, i) => {
		const result = removeLeaf(child, targetId);
		if (result !== null) {
			newChildren.push(result);
			newSizes.push(node.sizes[i]);
		}
	});
	if (newChildren.length === 0) return null;
	if (newChildren.length === 1) return newChildren[0];
	const total = newSizes.reduce((a, b) => a + b, 0);
	return { ...node, children: newChildren, sizes: newSizes.map((s) => s / total) };
}

function updateSplitSizes(node: PaneNode, splitId: string, sizes: number[]): PaneNode {
	if (node.type === "leaf") return node;
	if (node.id === splitId) return { ...node, sizes };
	return { ...node, children: node.children.map((c) => updateSplitSizes(c, splitId, sizes)) };
}

function firstLeafId(node: PaneNode): string {
	return node.type === "leaf" ? node.sessionId : firstLeafId(node.children[0]);
}

function collectLeafIds(node: PaneNode): string[] {
	return node.type === "leaf" ? [node.sessionId] : node.children.flatMap(collectLeafIds);
}

function findLeaf(node: PaneNode, sessionId: string): LeafPane | undefined {
	if (node.type === "leaf") return node.sessionId === sessionId ? node : undefined;
	for (const child of node.children) {
		const found = findLeaf(child, sessionId);
		if (found) return found;
	}
	return undefined;
}

export function paneCount(node: PaneNode): number {
	return node.type === "leaf" ? 1 : node.children.reduce((sum, c) => sum + paneCount(c), 0);
}

class TerminalStore {
	tabs = $state<TabState[]>([]);
	activeTabId = $state<string | null>(null);

	get activeTab(): TabState | undefined {
		return this.tabs.find((t) => t.id === this.activeTabId);
	}

	openTab(projectId: string | null, projectName: string, cwd: string): TabState {
		const sessionId = crypto.randomUUID();
		const leaf: LeafPane = { type: "leaf", sessionId, cwd, status: "running" };
		const tab: TabState = {
			id: crypto.randomUUID(),
			projectId,
			projectName,
			root: leaf,
			focusedPaneId: sessionId,
		};
		this.tabs = [...this.tabs, tab];
		this.activeTabId = tab.id;
		return tab;
	}

	setActiveTab(id: string) {
		this.activeTabId = id;
	}

	focusPane(tabId: string, sessionId: string) {
		this.tabs = this.tabs.map((t) => (t.id === tabId ? { ...t, focusedPaneId: sessionId } : t));
	}

	setPaneStatus(sessionId: string, status: PaneStatus, errorMessage?: string) {
		this.tabs = this.tabs.map((tab) => ({
			...tab,
			root: mapLeaf(tab.root, sessionId, (leaf) => ({ ...leaf, status, errorMessage })),
		}));
	}

	getPaneCwd(tabId: string, sessionId: string): string | undefined {
		const tab = this.tabs.find((t) => t.id === tabId);
		return tab && findLeaf(tab.root, sessionId)?.cwd;
	}

	/** Splits `targetSessionId`'s pane along `direction`; returns the new
	 *  pane's session id — the caller is responsible for spawning its PTY
	 *  (components.md: each resulting pane owns an independent PTY session). */
	splitPane(tabId: string, targetSessionId: string, direction: SplitDirection, cwd: string): string {
		const newSessionId = crypto.randomUUID();
		const newLeaf: LeafPane = { type: "leaf", sessionId: newSessionId, cwd, status: "running" };
		this.tabs = this.tabs.map((tab) => {
			if (tab.id !== tabId) return tab;
			return { ...tab, root: splitLeaf(tab.root, targetSessionId, direction, newLeaf), focusedPaneId: newSessionId };
		});
		return newSessionId;
	}

	resizeSplit(tabId: string, splitId: string, rawSizes: number[]) {
		const sizes = rawSizes.map((s) => Math.max(s, MIN_PANE_FRACTION));
		this.tabs = this.tabs.map((tab) =>
			tab.id === tabId ? { ...tab, root: updateSplitSizes(tab.root, splitId, sizes) } : tab,
		);
	}

	/** Removes one pane. If it was the tab's only pane, the whole tab closes.
	 *  Returns every session id that needs its backend PTY torn down, and
	 *  whether the tab itself closed. */
	closePane(tabId: string, sessionId: string): { closedSessionIds: string[]; tabClosed: boolean } {
		const tab = this.tabs.find((t) => t.id === tabId);
		if (!tab) return { closedSessionIds: [], tabClosed: false };

		if (tab.root.type === "leaf" && tab.root.sessionId === sessionId) {
			return { closedSessionIds: this.closeTab(tabId), tabClosed: true };
		}

		const newRoot = removeLeaf(tab.root, sessionId);
		if (!newRoot) {
			return { closedSessionIds: this.closeTab(tabId), tabClosed: true };
		}
		const newFocused = tab.focusedPaneId === sessionId ? firstLeafId(newRoot) : tab.focusedPaneId;
		this.tabs = this.tabs.map((t) => (t.id === tabId ? { ...t, root: newRoot, focusedPaneId: newFocused } : t));
		return { closedSessionIds: [sessionId], tabClosed: false };
	}

	/** Closes the whole tab; returns every leaf session id it contained, so
	 *  the caller can tear down each one's backend PTY. */
	closeTab(id: string): string[] {
		const tab = this.tabs.find((t) => t.id === id);
		const sessionIds = tab ? collectLeafIds(tab.root) : [];
		this.tabs = this.tabs.filter((t) => t.id !== id);
		if (this.activeTabId === id) {
			this.activeTabId = this.tabs.at(-1)?.id ?? null;
		}
		return sessionIds;
	}
}

export const terminalStore = new TerminalStore();
