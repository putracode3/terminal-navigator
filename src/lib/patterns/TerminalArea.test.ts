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
	refresh: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
	attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
	attachCustomWheelEventHandler: ReturnType<typeof vi.fn>;
	getSelection: ReturnType<typeof vi.fn>;
	paste: ReturnType<typeof vi.fn>;
	rows: number;
	cols: number;
	buffer: { active: { type: string }; onBufferChange: ReturnType<typeof vi.fn> };
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
			refresh: vi.fn(),
			write: vi.fn(),
			attachCustomKeyEventHandler: vi.fn(),
			attachCustomWheelEventHandler: vi.fn(),
			getSelection: vi.fn(),
			paste: vi.fn(),
			rows: 24,
			cols: 80,
			// `buffer` is what TerminalPane's `fitTerminal` + buffer-change refit read.
			buffer: { active: { type: "normal" }, onBufferChange: vi.fn(() => ({ dispose: vi.fn() })) },
			options: {},
		};
		instances.push(inst);
		return inst;
	}),
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: vi.fn(function FitAddon() { return { fit: vi.fn() }; }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listenMock(...args) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	writeText: vi.fn().mockResolvedValue(undefined),
	readText: vi.fn().mockResolvedValue(""),
}));
const splitPaneApiMock = vi.fn().mockResolvedValue(undefined);
const closeTerminalMock = vi.fn().mockResolvedValue(undefined);
vi.mock("$lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/api")>();
	return {
		...actual,
		resizeTerminal: vi.fn().mockResolvedValue(undefined),
		writeTerminal: vi.fn().mockResolvedValue(undefined),
		splitPane: (...args: unknown[]) => splitPaneApiMock(...args),
		closeTerminal: (...args: unknown[]) => closeTerminalMock(...args),
	};
});

import TerminalArea from "./TerminalArea.svelte";
import { terminalStore } from "$lib/stores/terminal.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import { appStore } from "$lib/stores/app.svelte";
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
	appStore.sidebarHidden = false;
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

describe("TerminalArea — pane.move{Left,Right,Up,Down}: keyboard equivalent to drag-to-move (components.md v3.1's accessibility follow-up, PRD FR-08 v1.17)", () => {
	function altShiftArrow(code: string, target: Window | Element = window) {
		return fireEvent.keyDown(target, { altKey: true, shiftKey: true, code });
	}

	it("Alt+Shift+ArrowLeft/Right relocate the focused pane itself, not just its focus, in a row split", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "row", "/b");
		await flush();
		expect(terminalStore.tabs[0].focusedPaneId).toBe(idB); // splitPane focuses the new pane

		await altShiftArrow("ArrowLeft");
		await flush();

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(refreshed.focusedPaneId).toBe(idB); // still the same pane — relocated, not refocused
		expect(refreshed.root).toMatchObject({ type: "split", direction: "row" });
		if (refreshed.root.type === "split") {
			// B moved to A's left — the opposite order from how splitPane laid them out.
			expect(refreshed.root.children.map((c) => (c as { sessionId: string }).sessionId)).toEqual([idB, idA]);
		}
	});

	it("Alt+Shift+ArrowUp/Down relocate the focused pane in a column split", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "column", "/b");
		await flush();
		expect(terminalStore.tabs[0].focusedPaneId).toBe(idB);

		await altShiftArrow("ArrowUp");
		await flush();

		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(refreshed.root).toMatchObject({ type: "split", direction: "column" });
		if (refreshed.root.type === "split") {
			expect(refreshed.root.children.map((c) => (c as { sessionId: string }).sessionId)).toEqual([idB, idA]);
		}
	});

	it("does not recreate any pane's xterm.js Terminal when relocated via keyboard (same remount-regression guard as the drag path)", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		await flush();
		const idA = (tab.root as { sessionId: string }).sessionId;
		terminalStore.splitPane(tab.id, idA, "row", "/b");
		await flush();
		expect(instances).toHaveLength(2);
		const [instanceA, instanceB] = instances;

		await altShiftArrow("ArrowLeft");
		await flush();

		expect(instances).toHaveLength(2);
		expect(instanceA.dispose).not.toHaveBeenCalled();
		expect(instanceB.dispose).not.toHaveBeenCalled();
	});

	it("is a no-op at the edge of the grid (no matching neighbor), unlike a mismatched combo which would do nothing anyway", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		await flush(); // single pane — no neighbor in any direction

		await expect(altShiftArrow("ArrowRight")).resolves.not.toThrow();
		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(refreshed.root.type).toBe("leaf"); // still just the one pane, unchanged
	});

	it("does nothing when there is no active tab", async () => {
		render(TerminalArea);

		await expect(altShiftArrow("ArrowRight")).resolves.not.toThrow();
	});

	it("regression (B1 bug class): calls stopPropagation on a matched combo, so it can't also reach xterm's own keydown handling", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		const idA = (tab.root as { sessionId: string }).sessionId;
		terminalStore.splitPane(tab.id, idA, "row", "/b");
		await flush();

		const event = new KeyboardEvent("keydown", {
			altKey: true,
			shiftKey: true,
			code: "ArrowRight",
			bubbles: true,
			cancelable: true,
		});
		const stopPropagationSpy = vi.spyOn(event, "stopPropagation");
		window.dispatchEvent(event);
		await flush();

		expect(stopPropagationSpy).toHaveBeenCalled();
	});

	it("rebinding pane.moveLeft to a different combo changes which keys trigger it", async () => {
		settingsStore.keybindings = { ...settingsStore.keybindings, "pane.moveLeft": "Alt+Shift+H" };
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "row", "/b");
		await flush();
		expect(terminalStore.tabs[0].focusedPaneId).toBe(idB);

		await altShiftArrow("ArrowLeft"); // the old default — should no longer relocate
		await flush();
		expect(terminalStore.tabs.find((t) => t.id === tab.id)!.root).toMatchObject({
			type: "split",
			children: [{ sessionId: idA }, { sessionId: idB }],
		});

		await fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyH" }); // the newly-bound combo
		await flush();
		expect(terminalStore.tabs.find((t) => t.id === tab.id)!.root).toMatchObject({
			type: "split",
			children: [{ sessionId: idB }, { sessionId: idA }],
		});
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

// Drag to move (components.md v3.1, PRD FR-08 v1.16): relocating an
// already-open pane by its own header is a NEW tree-restructuring operation
// (detach + reinsert), so it risks reopening the exact bug class the two
// regressions above were fixed for — a leaf's each-block key changing
// position/nesting without its underlying xterm.js Terminal/PTY subscription
// surviving. It's protected by the same $lib/terminal-registry mechanism
// (keyed by sessionId, independent of tree position), but that guarantee is
// only as good as this test proving it holds for THIS operation too.
describe("TerminalArea — drag to move a pane (components.md v3.1, PRD FR-08 v1.16)", () => {
	it("does not recreate any pane's xterm.js Terminal when a pane is moved within its tab (regression-class guard)", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		await flush();
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "row", "/b");
		await flush();
		expect(instances).toHaveLength(2);
		const [instanceA, instanceB] = instances;

		terminalStore.movePaneWithinTab(tab.id, idA, idB, "right");
		await flush();

		expect(instances).toHaveLength(2); // no new Terminal created by the move
		expect(instanceA.dispose).not.toHaveBeenCalled();
		expect(instanceB.dispose).not.toHaveBeenCalled();

		// Same double-subscription risk the perpendicular-split regression
		// above guards against: a remounted (but not torn down) pane must
		// still have exactly one output/exit listener each, not two.
		const outputA = listenMock.mock.calls.filter(([name]) => name === `pty://output/${idA}`);
		const outputB = listenMock.mock.calls.filter(([name]) => name === `pty://output/${idB}`);
		expect(outputA).toHaveLength(1);
		expect(outputB).toHaveLength(1);
	});

	it("end-to-end DOM wiring: dragging a pane's header and dropping it on another pane's body actually calls terminalStore.movePaneWithinTab (TerminalArea's handleDragStartPane/handleDrop)", async () => {
		const { container } = render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		await flush();
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "row", "/b");
		await flush();

		const leaves = container.querySelectorAll(".leaf");
		expect(leaves).toHaveLength(2);
		const sourceHeader = leaves[0].querySelector(".pane-header")!;
		const targetBody = leaves[1].querySelector(".pane-body")!;

		// dragstart on the SOURCE pane's own header — PaneNodeView's
		// handlePaneDragStart → onDragStartPane → TerminalArea's
		// handleDragStartPane → terminalStore.startDraggingPane.
		const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
		Object.defineProperty(dragStart, "dataTransfer", { value: { setData: vi.fn(), effectAllowed: "" } });
		sourceHeader.dispatchEvent(dragStart);
		expect(terminalStore.dragSource).toEqual({ kind: "move-pane", tabId: tab.id, sessionId: idA });

		// dragover then drop on the TARGET pane's body — PaneNodeView's
		// handleDragOver/handleDrop → TerminalArea's handleDrop's new
		// `move-pane` branch → terminalStore.movePaneWithinTab.
		const dragOver = new Event("dragover", { bubbles: true, cancelable: true });
		Object.defineProperty(dragOver, "clientX", { value: 10 });
		Object.defineProperty(dragOver, "clientY", { value: 10 });
		targetBody.dispatchEvent(dragOver);
		targetBody.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
		await flush();

		expect(terminalStore.dragSource).toBeNull(); // cleared by a successful move
		const refreshed = terminalStore.tabs.find((t) => t.id === tab.id)!;
		expect(refreshed.focusedPaneId).toBe(idA); // the moved pane gets focus
		expect(instances).toHaveLength(2); // still no new Terminal, even through the full DOM path
	});
});

// FR-13 registry addition (architecture.md §5.6): Ctrl+Shift+W closes the
// focused pane, and the tab with it only when that was its last pane —
// mirroring Tilix/Terminator, and reusing the exact path the ✕ affordances
// already use rather than inventing a second close route.
describe("TerminalArea — terminal.closeSession shortcut (Ctrl+Shift+W)", () => {
	function ctrlShiftW(target: Window | Element = window) {
		return fireEvent.keyDown(target, { ctrlKey: true, shiftKey: true, code: "KeyW" });
	}

	it("closes the focused pane and tears down its backend PTY, leaving the tab's other pane open", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		const idA = (tab.root as { sessionId: string }).sessionId;
		const idB = terminalStore.splitPane(tab.id, idA, "row", "/b");
		await flush();
		expect(terminalStore.tabs[0].focusedPaneId).toBe(idB);

		await ctrlShiftW();
		await flush();

		expect(closeTerminalMock).toHaveBeenCalledWith(idB);
		const root = terminalStore.tabs.find((t) => t.id === tab.id)!.root;
		expect(root).toMatchObject({ type: "leaf", sessionId: idA });
	});

	it("closes the whole tab when the focused pane was its last one", async () => {
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		const idA = (tab.root as { sessionId: string }).sessionId;
		await flush();

		await ctrlShiftW();
		await flush();

		expect(closeTerminalMock).toHaveBeenCalledWith(idA);
		expect(terminalStore.tabs.find((t) => t.id === tab.id)).toBeUndefined();
	});

	it("owns the keystroke fully — Ctrl+Shift+W must not also reach xterm as terminal input", async () => {
		render(TerminalArea);
		terminalStore.openTab("proj-a", "a", "/a");
		await flush();

		const event = new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: true, code: "KeyW", bubbles: true, cancelable: true });
		const stopPropagationSpy = vi.spyOn(event, "stopPropagation");
		window.dispatchEvent(event);
		await flush();

		expect(stopPropagationSpy).toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it("does nothing with no active tab", async () => {
		render(TerminalArea);

		await expect(ctrlShiftW()).resolves.not.toThrow();
		expect(closeTerminalMock).not.toHaveBeenCalled();
	});

	it("respects a rebound combo instead of a hardcoded Ctrl+Shift+W", async () => {
		settingsStore.keybindings = { ...DEFAULT_KEYBINDINGS, "terminal.closeSession": "Alt+Shift+X" };
		render(TerminalArea);
		const tab = terminalStore.openTab("proj-a", "a", "/a");
		const idA = (tab.root as { sessionId: string }).sessionId;
		await flush();

		await ctrlShiftW();
		await flush();
		expect(closeTerminalMock).not.toHaveBeenCalled();

		await fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyX" });
		await flush();
		expect(closeTerminalMock).toHaveBeenCalledWith(idA);
	});
});

describe("TerminalArea — sidebar.toggle shortcut (Ctrl+B)", () => {
	function ctrlB(target: Window | Element = window) {
		return fireEvent.keyDown(target, { ctrlKey: true, code: "KeyB" });
	}

	it("flips appStore.sidebarHidden", async () => {
		render(TerminalArea);
		expect(appStore.sidebarHidden).toBe(false);

		await ctrlB();
		expect(appStore.sidebarHidden).toBe(true);

		await ctrlB();
		expect(appStore.sidebarHidden).toBe(false);
	});

	it("works with no active tab (unlike every other shortcut in this suite)", async () => {
		render(TerminalArea);
		expect(terminalStore.activeTabId).toBeNull();

		await expect(ctrlB()).resolves.not.toThrow();
		expect(appStore.sidebarHidden).toBe(true);
	});

	it("owns the keystroke fully — Ctrl+B must not also reach xterm as terminal input", async () => {
		render(TerminalArea);
		terminalStore.openTab("proj-a", "a", "/a");
		await flush();

		const event = new KeyboardEvent("keydown", { ctrlKey: true, code: "KeyB", bubbles: true, cancelable: true });
		const stopPropagationSpy = vi.spyOn(event, "stopPropagation");
		window.dispatchEvent(event);
		await flush();

		expect(stopPropagationSpy).toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it("respects a rebound combo instead of a hardcoded Ctrl+B", async () => {
		settingsStore.keybindings = { ...DEFAULT_KEYBINDINGS, "sidebar.toggle": "Alt+Shift+S" };
		render(TerminalArea);

		await ctrlB();
		expect(appStore.sidebarHidden).toBe(false);

		await fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyS" });
		expect(appStore.sidebarHidden).toBe(true);
	});
});
