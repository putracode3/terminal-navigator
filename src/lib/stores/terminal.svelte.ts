// Tab + pane state (FR-08). MVP: exactly one pane per tab (components.md,
// Split Pane Container "single" variant) — the structure already supports
// multiple panes per tab; only the split/resize interaction is deferred.
export type PaneStatus = "running" | "ready" | "error";

export interface PaneState {
	sessionId: string;
	cwd: string;
	status: PaneStatus;
	errorMessage?: string;
}

export interface TabState {
	id: string;
	projectId: string | null;
	projectName: string;
	panes: PaneState[];
	focusedPaneId: string;
}

class TerminalStore {
	tabs = $state<TabState[]>([]);
	activeTabId = $state<string | null>(null);

	get activeTab(): TabState | undefined {
		return this.tabs.find((t) => t.id === this.activeTabId);
	}

	openTab(projectId: string | null, projectName: string, cwd: string): TabState {
		const sessionId = crypto.randomUUID();
		const tab: TabState = {
			id: crypto.randomUUID(),
			projectId,
			projectName,
			panes: [{ sessionId, cwd, status: "running" }],
			focusedPaneId: sessionId,
		};
		this.tabs = [...this.tabs, tab];
		this.activeTabId = tab.id;
		return tab;
	}

	setActiveTab(id: string) {
		this.activeTabId = id;
	}

	setPaneStatus(sessionId: string, status: PaneStatus, errorMessage?: string) {
		this.tabs = this.tabs.map((tab) => ({
			...tab,
			panes: tab.panes.map((pane) =>
				pane.sessionId === sessionId ? { ...pane, status, errorMessage } : pane,
			),
		}));
	}

	closeTab(id: string): PaneState[] {
		const tab = this.tabs.find((t) => t.id === id);
		const closedPanes = tab?.panes ?? [];
		this.tabs = this.tabs.filter((t) => t.id !== id);
		if (this.activeTabId === id) {
			this.activeTabId = this.tabs.at(-1)?.id ?? null;
		}
		return closedPanes;
	}
}

export const terminalStore = new TerminalStore();
