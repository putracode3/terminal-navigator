import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

// TerminalArea renders every open tab's SplitPaneContainer → PaneNodeView →
// TerminalPane, which needs xterm.js + Tauri event mocks — same pattern as
// PaneNodeView.test.ts, except each mocked Terminal instance is tracked
// separately (not one shared mock) so tests can tell which tab's terminal
// got focused/recreated.
type FakeTerm = {
	loadAddon: ReturnType<typeof vi.fn>;
	open: ReturnType<typeof vi.fn>;
	onData: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
	focus: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
	attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
	attachCustomWheelEventHandler: ReturnType<typeof vi.fn>;
	getSelection: ReturnType<typeof vi.fn>;
	paste: ReturnType<typeof vi.fn>;
	rows: number;
	cols: number;
	options: { theme?: unknown };
};
let instances: FakeTerm[] = [];
const listenMock = vi.fn().mockResolvedValue(() => {});
vi.mock("@xterm/xterm", () => ({
	Terminal: vi.fn(function Terminal() {
		const inst: FakeTerm = {
			loadAddon: vi.fn(),
			open: vi.fn(),
			onData: vi.fn(),
			dispose: vi.fn(),
			focus: vi.fn(),
			write: vi.fn(),
			attachCustomKeyEventHandler: vi.fn(),
			attachCustomWheelEventHandler: vi.fn(),
			getSelection: vi.fn(),
			paste: vi.fn(),
			rows: 24,
			cols: 80,
			options: {},
		};
		instances.push(inst);
		return inst;
	}),
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: vi.fn(function FitAddon() { return { fit: vi.fn() }; }) }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: vi.fn(function WebglAddon() { return {}; }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listenMock(...args) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	writeText: vi.fn().mockResolvedValue(undefined),
	readText: vi.fn().mockResolvedValue(""),
}));
const splitPaneApiMock = vi.fn().mockResolvedValue(undefined);
vi.mock("$lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/api")>();
	return {
		...actual,
		resizeTerminal: vi.fn().mockResolvedValue(undefined),
		writeTerminal: vi.fn().mockResolvedValue(undefined),
		splitPane: (...args: unknown[]) => splitPaneApiMock(...args),
	};
});

import TerminalArea from "./TerminalArea.svelte";
import { terminalStore } from "$lib/stores/terminal.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import { DEFAULT_KEYBINDINGS } from "$lib/keybindings";
import { __resetTerminalRegistryForTests } from "$lib/terminal-registry";

const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
	vi.clearAllMocks();
	// Real sessionIds here come from crypto.randomUUID() (openTab/splitPane),
	// so they won't collide across tests — but every session opened in one
	// test still leaks into the registry (a module-level singleton) unless a
	// test explicitly closes it, so reset explicitly rather than relying on
	// that coincidence.
	__resetTerminalRegistryForTests();
	splitPaneApiMock.mockResolvedValue(undefined);
	instances = [];
	terminalStore.tabs = [];
	terminalStore.activeTabId = null;
	settingsStore.keybindings = { ...DEFAULT_KEYBINDINGS };
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
	vi.stubGlobal(
		"ResizeObserver",
		vi.fn(function ResizeObserver() {
			return { observe: vi.fn(), disconnect: vi.fn() };
		}),
	);
});

describe("TerminalArea — switching tabs keeps a backgrounded session's terminal alive (regression)", () => {
	// Regression: TerminalArea used to mount only the active tab's pane tree
	// ({#if terminalStore.activeTab}), so switching sidebar sessions away and
	// back destroyed and recreated that tab's xterm.js Terminal from scratch —
	// even though the backend PTY session kept running the whole time, the
	// frontend lost all its buffered output/scrollback and rendered blank.
	it("does not recreate a tab's xterm.js Terminal when switching away and back", async () => {
		render(TerminalArea);

		const tabA = terminalStore.openTab("proj-a", "a", "/a");
		await flush();
		terminalStore.openTab("proj-b", "b", "/b");
		await flush();

		expect(instances).toHaveLength(2); // one xterm.js Terminal per tab so far

		terminalStore.setActiveTab(tabA.id);
		await flush();

		expect(instances).toHaveLength(2); // still 2 — tab A's Terminal was reused, not recreated
	});

	it("keeps a backgrounded tab's pane tree in the DOM (hidden via CSS), not unmounted", async () => {
		const { container } = render(TerminalArea);

		terminalStore.openTab("proj-a", "a", "/a");
		await flush();
		terminalStore.openTab("proj-b", "b", "/b");
		await flush();

		expect(container.querySelectorAll(".tab-tree")).toHaveLength(2);
		expect(container.querySelectorAll(".tab-tree-active")).toHaveLength(1);
	});

	it("re-focuses the pane's terminal when switching back to its tab", async () => {
		render(TerminalArea);

		const tabA = terminalStore.openTab("proj-a", "a", "/a");
		await flush();
		const termA = instances[0];
		expect(termA.focus).toHaveBeenCalledTimes(1); // focused on its own mount

		terminalStore.openTab("proj-b", "b", "/b"); // backgrounds tab A
		await flush();
		expect(termA.focus).toHaveBeenCalledTimes(1); // not re-focused while hidden

		terminalStore.setActiveTab(tabA.id);
		await flush();
		expect(termA.focus).toHaveBeenCalledTimes(2); // re-focused on return
	});
});

describe("TerminalArea — FR-13 keyboard pane split/move-focus (architecture.md §5.6)", () => {
	function altShiftKey(code: string, target: Window | Element = window) {
		return fireEvent.keyDown(target, { altKey: true, shiftKey: true, code });
	}
	function altArrow(code: string, target: Window | Element = window) {
		return fireEvent.keyDown(target, { altKey: true, code });
	}

	it("Alt+Shift+D splits the focused pane downward (column direction)", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		await flush();

		await altShiftKey("KeyD");
		await flush();

		const root = terminalStore.tabs.find((t) => t.id === tab.id)!.root;
		expect(root.type).toBe("split");
		expect((root as { direction: string }).direction).toBe("column");
		expect(splitPaneApiMock).toHaveBeenCalled();
	});

	it("Alt+Shift+R splits the focused pane rightward (row direction)", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		await flush();

		await altShiftKey("KeyR");
		await flush();

		const root = terminalStore.tabs.find((t) => t.id === tab.id)!.root;
		expect(root.type).toBe("split");
		expect((root as { direction: string }).direction).toBe("row");
	});

	it("Alt+ArrowLeft/Right move focus between panes in a row split", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "row", "/b");
		await flush();
		expect(terminalStore.tabs[0].focusedPaneId).toBe(idB);

		await altArrow("ArrowLeft");
		await flush();
		expect(terminalStore.tabs[0].focusedPaneId).toBe(idA);

		await altArrow("ArrowRight");
		await flush();
		expect(terminalStore.tabs[0].focusedPaneId).toBe(idB);
	});

	it("does nothing when there is no active tab", async () => {
		render(TerminalArea);

		await expect(altShiftKey("KeyD")).resolves.not.toThrow();
		expect(splitPaneApiMock).not.toHaveBeenCalled();
	});

	it("regression (code review B1): calls stopPropagation on a matched combo, so it can't also reach xterm's own keydown handling on the focused pane", async () => {
		render(TerminalArea);
		terminalStore.openTab("proj-a", "a", "/a");
		await flush();

		const event = new KeyboardEvent("keydown", { altKey: true, shiftKey: true, code: "KeyD", bubbles: true, cancelable: true });
		const stopPropagationSpy = vi.spyOn(event, "stopPropagation");
		window.dispatchEvent(event);
		await flush();

		expect(stopPropagationSpy).toHaveBeenCalled();
	});

	it("is skipped when the event originates inside an open dialog (e.g. Settings modal fields)", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "row", "/b");
		await flush();

		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		const fieldInsideDialog = document.createElement("input");
		dialog.appendChild(fieldInsideDialog);
		document.body.appendChild(dialog);

		await altArrow("ArrowLeft", fieldInsideDialog);
		await flush();

		expect(terminalStore.tabs[0].focusedPaneId).toBe(idB); // unchanged
		document.body.removeChild(dialog);
	});

	it("rebinding pane.splitBottom to a different combo changes which keys trigger it", async () => {
		settingsStore.keybindings = { ...settingsStore.keybindings, "pane.splitBottom": "Alt+Shift+X" };
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		await flush();

		await altShiftKey("KeyD"); // the old default — should no longer split
		await flush();
		expect(terminalStore.tabs.find((t) => t.id === tab.id)!.root.type).toBe("leaf");

		await altShiftKey("KeyX"); // the newly-bound combo
		await flush();
		expect(terminalStore.tabs.find((t) => t.id === tab.id)!.root.type).toBe("split");
	});

	it("Ctrl+Tab / Ctrl+Shift+Tab cycle the active tab", async () => {
		render(TerminalArea);
		const tabA = terminalStore.openTab("proj-a", "a", "/a");
		const tabB = terminalStore.openTab("proj-b", "b", "/b");
		await flush();
		terminalStore.setActiveTab(tabA.id);

		await fireEvent.keyDown(window, { ctrlKey: true, code: "Tab" });
		await flush();
		expect(terminalStore.activeTabId).toBe(tabB.id);

		await fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, code: "Tab" });
		await flush();
		expect(terminalStore.activeTabId).toBe(tabA.id);
	});

	it("regression: Ctrl+Tab calls stopPropagation, same as every other pane shortcut (B1 bug class)", async () => {
		render(TerminalArea);
		terminalStore.openTab("proj-a", "a", "/a");
		terminalStore.openTab("proj-b", "b", "/b");
		await flush();

		const event = new KeyboardEvent("keydown", { ctrlKey: true, code: "Tab", bubbles: true, cancelable: true });
		const stopPropagationSpy = vi.spyOn(event, "stopPropagation");
		window.dispatchEvent(event);
		await flush();

		expect(stopPropagationSpy).toHaveBeenCalled();
	});
});

describe("TerminalArea — regression: splitting a tab's only pane used to remount it, losing scrollback (bug report: \"terminal yang satunya jadi tidak bisa scroll\")", () => {
	it("does not recreate the pre-existing pane's xterm.js Terminal when the tab's single leaf is split", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		await flush();
		expect(instances).toHaveLength(1);
		const originalInstance = instances[0];

		const idA = (tab.root as { sessionId: string }).sessionId;
		// Simulates the toolbar-click / drag-to-split path directly (NOT the
		// keyboard listener) — same terminalStore.splitPane call every split
		// trigger uses, ruling out the keyboard listener as the cause.
		terminalStore.splitPane(tab.id, idA, "row", "/b");
		await flush();

		expect(instances).toHaveLength(2); // only the NEW pane's terminal is created
		expect(originalInstance.dispose).not.toHaveBeenCalled(); // the existing one survives
	});
});

// Was a KNOWN GAP: splitting a pane *perpendicular* to its parent split's
// existing direction (when the tab already has 2+ panes) used to remount the
// pane being split, because terminal.svelte.ts's insertNode wraps it in a
// brand-new split node with a fresh random id — that new id becomes the
// each-block key at that position, so no amount of {#each} keying could tell
// Svelte "this is the same slot, now nested" (unlike the root leaf→split
// case above, fixable with a keying trick precisely because that leaf's key
// never left its {#each} block's key space). Fixed not by trying to make
// Svelte preserve the component instance across a restructuring it
// fundamentally can't diff across, but by making the (still-happening)
// remount harmless: the actual xterm.js Terminal/scrollback/PTY
// subscriptions now live in $lib/terminal-registry, keyed by session id,
// independent of which <TerminalPane> instance currently renders them — see
// that file's own doc comment for the full reasoning.
describe("TerminalArea — perpendicular split on an already-split tab reuses the split target's terminal", () => {
	it("does not create a new xterm.js Terminal for the target pane when split perpendicular to its parent's direction", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		await flush();
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "row", "/b"); // root becomes row-split[A,B]
		await flush();
		const instanceB = instances[1];

		terminalStore.splitPane(tab.id, idB, "column", "/c"); // perpendicular to the existing row split
		await flush();

		expect(instances).toHaveLength(3); // only C (genuinely new) gets a new Terminal
		expect(instanceB.dispose).not.toHaveBeenCalled(); // B's terminal is reused, not torn down

		// The real risk this fix could have introduced: a naive "just don't
		// dispose on unmount" change would leave B's *second* mount registering
		// a second `pty://output`/`pty://exit` subscription on top of the
		// first — since `listen()` (unlike xterm's single-slot custom-handler
		// hooks) is a genuine multiple-subscriber event system, that would
		// silently double-render every byte of B's output. Must stay exactly 1
		// each, not 2, across the remount.
		const outputSubscriptions = listenMock.mock.calls.filter(([name]) => name === `pty://output/${idB}`);
		const exitSubscriptions = listenMock.mock.calls.filter(([name]) => name === `pty://exit/${idB}`);
		expect(outputSubscriptions).toHaveLength(1);
		expect(exitSubscriptions).toHaveLength(1);
	});
});
