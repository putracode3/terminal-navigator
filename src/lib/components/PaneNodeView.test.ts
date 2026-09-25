import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/svelte";

// PaneNodeView renders TerminalPane, which needs xterm.js + Tauri event
// mocks — same pattern as TerminalPane.test.ts.
const openMock = vi.fn();
const focusMock = vi.fn();
const listenMock = vi.fn().mockResolvedValue(() => {});
vi.mock("@xterm/xterm", () => ({
	Terminal: vi.fn(function Terminal() {
		return {
			loadAddon: vi.fn(),
			open: openMock,
			onData: vi.fn(),
			dispose: vi.fn(),
			focus: focusMock,
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
	}),
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: vi.fn(function FitAddon() { return { fit: vi.fn() }; }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listenMock(...args) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	writeText: vi.fn().mockResolvedValue(undefined),
	readText: vi.fn().mockResolvedValue(""),
}));
vi.mock("$lib/api", () => ({
	resizeTerminal: vi.fn().mockResolvedValue(undefined),
	writeTerminal: vi.fn().mockResolvedValue(undefined),
	getGitBranch: vi.fn().mockResolvedValue(null),
}));

import PaneNodeView from "./PaneNodeView.svelte";
import type { PaneNode, DragSource } from "$lib/stores/terminal.svelte";
import { __resetTerminalRegistryForTests } from "$lib/terminal-registry";
import { __resetGitBranchCacheForTests } from "$lib/git-branch-cache";

function leaf(sessionId: string, cwd = "/proj"): PaneNode {
	return { type: "leaf", sessionId, cwd, status: "ready" };
}

function baseProps(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		node: leaf("pane-1"),
		tabId: "tab-1",
		focusedPaneId: "pane-1",
		dragSource: null as DragSource | null,
		canDragPanes: false,
		onFocusPane: vi.fn(),
		onSplitPane: vi.fn(),
		onClosePane: vi.fn(),
		onResizeSplit: vi.fn(),
		onDrop: vi.fn(),
		onDragStartPane: vi.fn(),
		onDragEndPane: vi.fn(),
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	// Several tests here reuse the same literal sessionId (e.g. "pane-1")
	// across cases — the registry is a module-level singleton, so it must be
	// reset per test (see TerminalPane.test.ts's own beforeEach for the same
	// reasoning). Same reasoning for the git-branch cache (FR-17).
	__resetTerminalRegistryForTests();
	__resetGitBranchCacheForTests();
	// TerminalPane (rendered inside every leaf) needs these — jsdom has
	// neither (see TerminalPane.test.ts for the same pattern).
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
	vi.stubGlobal(
		"ResizeObserver",
		vi.fn(function ResizeObserver() {
			return { observe: vi.fn(), disconnect: vi.fn() };
		}),
	);
});

describe("PaneNodeView — remounts TerminalPane when the root leaf's session changes", () => {
	// Regression test: the root leaf isn't inside a keyed {#each} (only split
	// children are), so without a {#key node.sessionId} wrapper, switching a
	// single-pane tab to a different single-pane tab reused the same
	// TerminalPane instance — leaving it permanently subscribed to the OLD
	// session's PTY output and never re-running its mount-time focus effect.
	it("creates a fresh xterm.js Terminal (and re-focuses it) when the leaf's sessionId changes", async () => {
		const { rerender } = render(
			PaneNodeView,
			baseProps({ node: leaf("s1"), tabId: "tab-a", focusedPaneId: "s1" }),
		);
		expect(openMock).toHaveBeenCalledTimes(1);
		expect(listenMock).toHaveBeenCalledWith("pty://output/s1", expect.any(Function));

		await rerender(baseProps({ node: leaf("s2"), tabId: "tab-b", focusedPaneId: "s2" }));

		expect(openMock).toHaveBeenCalledTimes(2); // remounted, not reused
		expect(listenMock).toHaveBeenCalledWith("pty://output/s2", expect.any(Function));
		expect(focusMock).toHaveBeenCalled(); // the new instance's mount-time focus effect ran
	});

	it("does NOT remount when the leaf's sessionId is unchanged (no unnecessary PTY resubscription)", async () => {
		const { rerender } = render(
			PaneNodeView,
			baseProps({ node: leaf("s1", "/a"), tabId: "tab-a", focusedPaneId: "s1" }),
		);
		expect(openMock).toHaveBeenCalledTimes(1);

		await rerender(baseProps({ node: leaf("s1", "/a-renamed"), tabId: "tab-a", focusedPaneId: "s1" }));

		expect(openMock).toHaveBeenCalledTimes(1);
	});
});

describe("PaneNodeView — reacts to the shell exiting on its own (regression: a pane used to stay open forever after `exit`, since nothing told the frontend the shell process had ended)", () => {
	it("calls onClosePane with the leaf's sessionId when TerminalPane's pty://exit fires", () => {
		const onClosePane = vi.fn();
		render(PaneNodeView, baseProps({ node: leaf("pane-1"), focusedPaneId: "pane-1", onClosePane }));

		const exitCall = listenMock.mock.calls.find(([name]) => name === "pty://exit/pane-1");
		expect(exitCall).toBeDefined();
		(exitCall![1] as () => void)();

		expect(onClosePane).toHaveBeenCalledWith("pane-1");
	});
});

describe("PaneNodeView — pane header (always present, v1.4)", () => {
	it("renders the pane header (with cwd and a close button) even for a single pane", () => {
		render(PaneNodeView, baseProps({ node: leaf("pane-1", "/home/user/proj") }));
		expect(screen.getByTitle("/home/user/proj")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Close pane" })).toBeInTheDocument();
	});
});

describe("PaneNodeView — drag-to-split target validity (components.md, Split Pane Container)", () => {
	it("rejects a drop when the drag source is null (dragover does not preventDefault, no overlay)", () => {
		const { container } = render(PaneNodeView, baseProps({ dragSource: null }));
		const paneBody = container.querySelector(".pane-body")!;
		const event = new Event("dragover", { bubbles: true, cancelable: true });
		paneBody.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
		expect(container.querySelector(".drop-zone-overlay")).toBeNull();
	});

	it("rejects a 'graft' drag source over its own tab's pane", () => {
		const { container } = render(
			PaneNodeView,
			baseProps({ tabId: "tab-1", dragSource: { kind: "graft", tabId: "tab-1" } }),
		);
		const paneBody = container.querySelector(".pane-body")!;
		const event = new Event("dragover", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clientX", { value: 50 });
		Object.defineProperty(event, "clientY", { value: 50 });
		paneBody.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
	});

	it("accepts a 'graft' drag source from a different tab", () => {
		const { container } = render(
			PaneNodeView,
			baseProps({ tabId: "tab-1", dragSource: { kind: "graft", tabId: "tab-2" } }),
		);
		const paneBody = container.querySelector(".pane-body")!;
		const event = new Event("dragover", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clientX", { value: 50 });
		Object.defineProperty(event, "clientY", { value: 50 });
		paneBody.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
	});

	it("accepts a 'spawn' drag source over any pane — it has no 'self' to collide with", () => {
		const { container } = render(
			PaneNodeView,
			baseProps({
				tabId: "tab-1",
				dragSource: { kind: "spawn", projectId: "proj-1", projectName: "a", cwd: "/a" },
			}),
		);
		const paneBody = container.querySelector(".pane-body")!;
		const event = new Event("dragover", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clientX", { value: 50 });
		Object.defineProperty(event, "clientY", { value: 50 });
		paneBody.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
	});
});

describe("PaneNodeView — drag to move (components.md v3.1, PRD FR-08 v1.16)", () => {
	it("pane header is draggable only when canDragPanes is true (a pane alone in its tab has no valid same-tab target)", () => {
		const { container: single } = render(PaneNodeView, baseProps({ canDragPanes: false }));
		expect(single.querySelector(".pane-header")).toHaveAttribute("draggable", "false");

		const { container: multi } = render(PaneNodeView, baseProps({ canDragPanes: true }));
		expect(multi.querySelector(".pane-header")).toHaveAttribute("draggable", "true");
	});

	it("the close-pane button is carved out of the draggable region (draggable=false), even when the header itself is draggable", () => {
		const { getByRole } = render(PaneNodeView, baseProps({ canDragPanes: true }));
		expect(getByRole("button", { name: "Close pane" })).toHaveAttribute("draggable", "false");
	});

	it("dragging the header calls onDragStartPane with the leaf's sessionId, and onDragEndPane on dragend", () => {
		const onDragStartPane = vi.fn();
		const onDragEndPane = vi.fn();
		const { container } = render(
			PaneNodeView,
			baseProps({ node: leaf("pane-1"), canDragPanes: true, onDragStartPane, onDragEndPane }),
		);
		const header = container.querySelector(".pane-header")!;

		const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
		Object.defineProperty(dragStart, "dataTransfer", { value: { setData: vi.fn(), effectAllowed: "" } });
		header.dispatchEvent(dragStart);
		expect(onDragStartPane).toHaveBeenCalledWith("pane-1");

		header.dispatchEvent(new Event("dragend", { bubbles: true }));
		expect(onDragEndPane).toHaveBeenCalled();
	});

	it("rejects a 'move-pane' drag source from a different tab (same-tab only)", () => {
		const { container } = render(
			PaneNodeView,
			baseProps({ tabId: "tab-1", dragSource: { kind: "move-pane", tabId: "tab-2", sessionId: "other-pane" } }),
		);
		const paneBody = container.querySelector(".pane-body")!;
		const event = new Event("dragover", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clientX", { value: 50 });
		Object.defineProperty(event, "clientY", { value: 50 });
		paneBody.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
	});

	it("rejects a 'move-pane' drag source hovering the exact pane being dragged (can't drop onto itself)", () => {
		const { container } = render(
			PaneNodeView,
			baseProps({
				node: leaf("pane-1"),
				tabId: "tab-1",
				dragSource: { kind: "move-pane", tabId: "tab-1", sessionId: "pane-1" },
			}),
		);
		const paneBody = container.querySelector(".pane-body")!;
		const event = new Event("dragover", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clientX", { value: 50 });
		Object.defineProperty(event, "clientY", { value: 50 });
		paneBody.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
	});

	it("accepts a 'move-pane' drag source from the same tab, hovering a different pane", () => {
		const { container } = render(
			PaneNodeView,
			baseProps({
				node: leaf("pane-2"),
				tabId: "tab-1",
				dragSource: { kind: "move-pane", tabId: "tab-1", sessionId: "pane-1" },
			}),
		);
		const paneBody = container.querySelector(".pane-body")!;
		const event = new Event("dragover", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clientX", { value: 50 });
		Object.defineProperty(event, "clientY", { value: 50 });
		paneBody.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
	});

	it("dims the pane being dragged (opacity via .dragging class) — same treatment as Sidebar Session Sub-item's dragging state", () => {
		const { container } = render(
			PaneNodeView,
			baseProps({
				node: leaf("pane-1"),
				tabId: "tab-1",
				dragSource: { kind: "move-pane", tabId: "tab-1", sessionId: "pane-1" },
			}),
		);
		expect(container.querySelector(".leaf")).toHaveClass("dragging");
	});

	it("does not dim a pane that is not the one being dragged", () => {
		const { container } = render(
			PaneNodeView,
			baseProps({
				node: leaf("pane-2"),
				tabId: "tab-1",
				dragSource: { kind: "move-pane", tabId: "tab-1", sessionId: "pane-1" },
			}),
		);
		expect(container.querySelector(".leaf")).not.toHaveClass("dragging");
	});
});
