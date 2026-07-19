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
	/** FR-08 v1.4: stable "Session {n}" numbering for `Sidebar Session
	 *  Sub-item`, assigned once at creation from the highest ordinal
	 *  currently open for this project + 1 (not from array position, which
	 *  would shift on close — components.md: "closing Session 1 does not
	 *  renumber Session 2"). Resets to 1 once every session for a project
	 *  has closed, since nothing is open to take the max of. */
	sessionOrdinal: number;
}

/** Aggregates a tab's tree into one status for its `Sidebar Session
 *  Sub-item` status dot: any error wins, otherwise any still-running setup
 *  command wins, otherwise ready. */
export function aggregateStatus(node: PaneNode): PaneStatus {
	if (node.type === "leaf") return node.status;
	const statuses = node.children.map(aggregateStatus);
	if (statuses.includes("error")) return "error";
	if (statuses.includes("running")) return "running";
	return "ready";
}

const MIN_PANE_FRACTION = 0.1;

function mapLeaf(node: PaneNode, sessionId: string, fn: (leaf: LeafPane) => LeafPane): PaneNode {
	if (node.type === "leaf") {
		return node.sessionId === sessionId ? fn(node) : node;
	}
	return { ...node, children: node.children.map((c) => mapLeaf(c, sessionId, fn)) };
}

/** Inserts `newNode` (a fresh leaf for a normal split, or an arbitrary
 *  existing subtree for drag-to-split/graft) next to the leaf `targetId`,
 *  along `direction`, on the given `placement` side (drop-zone Top/Left →
 *  "before", Bottom/Right → "after" — components.md's Drop zones table).
 *  Same-direction parent → flattens into one N-child row/column with equal
 *  shares (the "auto adjust" behavior). Cross-direction → nests, dividing
 *  only the target's own share (a genuine grid). */
function insertNode(
	node: PaneNode,
	targetId: string,
	direction: SplitDirection,
	newNode: PaneNode,
	placement: "before" | "after" = "after",
): PaneNode {
	if (node.type === "leaf") {
		// Root-level leaf (the tab's very first split) — nothing to flatten into yet.
		if (node.sessionId !== targetId) return node;
		const children = placement === "before" ? [newNode, node] : [node, newNode];
		return {
			type: "split",
			id: crypto.randomUUID(),
			direction,
			children,
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
			const insertAt = placement === "before" ? targetIndex : targetIndex + 1;
			const children = [...node.children.slice(0, insertAt), newNode, ...node.children.slice(insertAt)];
			const evenShare = 1 / children.length;
			return { ...node, children, sizes: children.map(() => evenShare) };
		}
		// Cross-direction split: only the target pane's own share is divided —
		// a genuine nested grid (e.g. splitting a row-pane vertically).
		const targetLeaf = node.children[targetIndex] as LeafPane;
		const nestedChildren = placement === "before" ? [newNode, targetLeaf] : [targetLeaf, newNode];
		const nested: PaneNode = {
			type: "split",
			id: crypto.randomUUID(),
			direction,
			children: nestedChildren,
			sizes: [0.5, 0.5],
		};
		const children = [...node.children];
		children[targetIndex] = nested;
		return { ...node, children };
	}

	// Target pane is deeper in the tree — recurse.
	return {
		...node,
		children: node.children.map((c) => insertNode(c, targetId, direction, newNode, placement)),
	};
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

/** The four drop-zone triangles from components.md's Split Pane Container
 *  spec — deliberately no "center" zone (this app has no per-pane tab strip
 *  for a center-drop to mean anything). */
export type DropZone = "top" | "bottom" | "left" | "right";

export function dropZoneToSplit(zone: DropZone): { direction: SplitDirection; placement: "before" | "after" } {
	switch (zone) {
		case "top":
			return { direction: "column", placement: "before" };
		case "bottom":
			return { direction: "column", placement: "after" };
		case "left":
			return { direction: "row", placement: "before" };
		case "right":
			return { direction: "row", placement: "after" };
	}
}

/** A drag currently in progress, sourced from the sidebar (FR-08 v1.4 — the
 *  sidebar is the only drag source now, replacing the removed Tab
 *  component). Two kinds, per components.md's Split Pane Container Behavior:
 *  - `graft`: an existing session (a 1-session `Sidebar Project List Item`
 *    or any `Sidebar Session Sub-item`) is reused verbatim at the drop
 *    target — no new PTY.
 *  - `spawn`: a 0-session `Sidebar Project List Item` has no existing
 *    session to reuse, so a fresh one is spawned directly into the drop
 *    target's pane tree instead. */
export type DragSource =
	| { kind: "graft"; tabId: string }
	| { kind: "spawn"; projectId: string; projectName: string; cwd: string };

class TerminalStore {
	tabs = $state<TabState[]>([]);
	activeTabId = $state<string | null>(null);
	/** The sidebar drag currently in progress, or null. Ephemeral UI state
	 *  (not persisted) — read during dragover to reject dropping a `graft`
	 *  source onto its own pane (components.md: no overlay for an invalid
	 *  target; `spawn` sources have no "self" to collide with). */
	dragSource = $state<DragSource | null>(null);

	get activeTab(): TabState | undefined {
		return this.tabs.find((t) => t.id === this.activeTabId);
	}

	/** All open sessions ("tabs") for one project, in creation order —
	 *  drives `Sidebar Project List Item`'s 0/1/grouped mode and, when
	 *  grouped, the `Sidebar Session Sub-item` list beneath it. */
	sessionsForProject(projectId: string): TabState[] {
		return this.tabs.filter((t) => t.projectId === projectId);
	}

	openTab(projectId: string | null, projectName: string, cwd: string): TabState {
		const sessionId = crypto.randomUUID();
		const leaf: LeafPane = { type: "leaf", sessionId, cwd, status: "running" };
		const existingOrdinals = projectId
			? this.tabs.filter((t) => t.projectId === projectId).map((t) => t.sessionOrdinal)
			: [];
		const sessionOrdinal = existingOrdinals.length > 0 ? Math.max(...existingOrdinals) + 1 : 1;
		const tab: TabState = {
			id: crypto.randomUUID(),
			projectId,
			projectName,
			root: leaf,
			focusedPaneId: sessionId,
			sessionOrdinal,
		};
		this.tabs = [...this.tabs, tab];
		this.activeTabId = tab.id;
		return tab;
	}

	setActiveTab(id: string) {
		this.activeTabId = id;
	}

	/** FR-08 v1.3: left-click's smart switch-or-open. Returns the project's
	 *  first-in-order existing tab (and activates it) if one exists;
	 *  otherwise creates a fresh one via `openTab`. `tabs.find` already
	 *  returns tab-order-first, since tabs are appended in creation order.
	 *  The caller must only spawn a PTY when `isNew` is true — an existing
	 *  tab already has a live session, spawning again would be wrong. */
	openOrSwitchToTab(projectId: string, projectName: string, cwd: string): { tab: TabState; isNew: boolean } {
		const existing = this.tabs.find((t) => t.projectId === projectId);
		if (existing) {
			this.activeTabId = existing.id;
			return { tab: existing, isNew: false };
		}
		return { tab: this.openTab(projectId, projectName, cwd), isNew: true };
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
			return { ...tab, root: insertNode(tab.root, targetSessionId, direction, newLeaf), focusedPaneId: newSessionId };
		});
		return newSessionId;
	}

	/** The `spawn` drag case (components.md, Split Pane Container Behavior):
	 *  a 0-session `Sidebar Project List Item` was dropped on `targetTabId`'s
	 *  pane at `targetSessionId`, `zone` giving the split direction/placement.
	 *  Inserts a fresh leaf directly into the *target* tab's tree — this does
	 *  not create a new `TabState`, so it does not add to the dragged
	 *  project's own session count (mirrors `splitPane`, but placement-aware
	 *  via the drop zone instead of always "after"). Caller spawns the PTY. */
	spawnPaneInto(tabId: string, targetSessionId: string, zone: DropZone, cwd: string): string {
		const { direction, placement } = dropZoneToSplit(zone);
		const newSessionId = crypto.randomUUID();
		const newLeaf: LeafPane = { type: "leaf", sessionId: newSessionId, cwd, status: "running" };
		this.tabs = this.tabs.map((tab) =>
			tab.id === tabId
				? { ...tab, root: insertNode(tab.root, targetSessionId, direction, newLeaf, placement), focusedPaneId: newSessionId }
				: tab,
		);
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

	startDraggingTab(tabId: string) {
		this.dragSource = { kind: "graft", tabId };
	}

	startDraggingSpawn(projectId: string, projectName: string, cwd: string) {
		this.dragSource = { kind: "spawn", projectId, projectName, cwd };
	}

	stopDragging() {
		this.dragSource = null;
	}

	/** A drop is valid only when dragging onto a *different* tab's pane — a
	 *  tab's tree can never be grafted into itself (components.md: no
	 *  overlay, "not-allowed" cursor for this case). */
	canGraftTab(sourceTabId: string, targetTabId: string): boolean {
		if (sourceTabId === targetTabId) return false;
		return this.tabs.some((t) => t.id === sourceTabId) && this.tabs.some((t) => t.id === targetTabId);
	}

	/** Drag-to-split (components.md pattern "Sidebar drag-to-split"): grafts
	 *  `sourceTabId`'s entire pane tree into `targetTabId`'s tree at
	 *  `targetSessionId`'s position, split per `zone`. Reuses every existing
	 *  session id verbatim — no new PTY sessions, no backend calls needed by
	 *  this method. The source tab is removed from `tabs`; the target tab
	 *  becomes active. Returns false (no-op) for an invalid graft. */
	graftTab(sourceTabId: string, targetTabId: string, targetSessionId: string, zone: DropZone): boolean {
		if (!this.canGraftTab(sourceTabId, targetTabId)) return false;
		const sourceTab = this.tabs.find((t) => t.id === sourceTabId);
		const targetTab = this.tabs.find((t) => t.id === targetTabId);
		if (!sourceTab || !targetTab) return false;

		const { direction, placement } = dropZoneToSplit(zone);
		const graftedRoot = insertNode(targetTab.root, targetSessionId, direction, sourceTab.root, placement);
		const newFocusedPaneId = firstLeafId(sourceTab.root);

		this.tabs = this.tabs
			.filter((t) => t.id !== sourceTabId)
			.map((t) => (t.id === targetTabId ? { ...t, root: graftedRoot, focusedPaneId: newFocusedPaneId } : t));
		this.activeTabId = targetTabId;
		this.dragSource = null;
		return true;
	}
}

export const terminalStore = new TerminalStore();
