import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/svelte";

// PaneNodeView renders TerminalPane, which needs xterm.js + Tauri event
// mocks — same pattern as TerminalPane.test.ts.
const openMock = vi.fn();
const focusMock = vi.fn();
const listenMock = vi.fn().mockResolvedValue(() => {});
vi.mock("@xterm/xterm", () => ({
	Terminal: vi.fn(function Terminal() {
		return { loadAddon: vi.fn(), open: openMock, onData: vi.fn(), dispose: vi.fn(), focus: focusMock, write: vi.fn(), rows: 24, cols: 80 };
	}),
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: vi.fn(function FitAddon() { return { fit: vi.fn() }; }) }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: vi.fn(function WebglAddon() { return {}; }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listenMock(...args) }));
vi.mock("$lib/api", () => ({ resizeTerminal: vi.fn(), writeTerminal: vi.fn() }));

import PaneNodeView from "./PaneNodeView.svelte";
import type { PaneNode, DragSource } from "$lib/stores/terminal.svelte";

function leaf(sessionId: string, cwd = "/proj"): PaneNode {
	return { type: "leaf", sessionId, cwd, status: "ready" };
}

function baseProps(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		node: leaf("pane-1"),
		tabId: "tab-1",
		focusedPaneId: "pane-1",
		dragSource: null as DragSource | null,
		onFocusPane: vi.fn(),
		onSplitPane: vi.fn(),
		onClosePane: vi.fn(),
		onResizeSplit: vi.fn(),
		onDrop: vi.fn(),
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
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
