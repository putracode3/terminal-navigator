import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SidebarProjectListItem from "./SidebarProjectListItem.svelte";
import type { ProjectDto } from "$lib/api";
import type { TabState } from "$lib/stores/terminal.svelte";

const project: ProjectDto = {
	id: "proj-1",
	name: "my-project",
	path: "/home/user/my-project",
	setupCommands: [],
	notes: "",
};

const flush = () => new Promise((r) => setTimeout(r, 10));

/** jsdom has no layout engine — `getBoundingClientRect` always returns
 * zeros, so FR-11's band-hit-testing needs a stubbed rect to exercise at
 * all (same limitation TerminalPane.test.ts's own comment notes for its
 * layout-dependent fit() behavior). */
function stubRect(el: HTMLElement, top: number, height: number) {
	vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
		top,
		height,
		bottom: top + height,
		left: 0,
		right: 100,
		width: 100,
		x: 0,
		y: top,
		toJSON() {},
	} as DOMRect);
}

function session(id: string, ordinal: number): TabState {
	return {
		id,
		projectId: project.id,
		projectName: project.name,
		root: { type: "leaf", sessionId: `${id}-pane`, cwd: project.path, status: "ready" },
		focusedPaneId: `${id}-pane`,
		sessionOrdinal: ordinal,
	};
}

function baseProps(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		project,
		sessions: [] as TabState[],
		activeTabId: null,
		onOpen: vi.fn(),
		onForceNewTab: vi.fn(),
		onSwitchSession: vi.fn(),
		onCloseTerminal: vi.fn(),
		onCloseSession: vi.fn(),
		onEdit: vi.fn(),
		onDelete: vi.fn(),
		onDragStart: vi.fn(),
		onSessionDragStart: vi.fn(),
		onDragEnd: vi.fn(),
		...overrides,
	};
}

describe("SidebarProjectListItem — 0-session mode", () => {
	it("left-click calls onOpen", async () => {
		const onOpen = vi.fn();
		render(SidebarProjectListItem, baseProps({ onOpen }));

		await fireEvent.click(screen.getByText("my-project"));

		expect(onOpen).toHaveBeenCalledOnce();
	});

	it("left-click on an invalid project shows a message instead of calling onOpen", async () => {
		const onOpen = vi.fn();
		render(SidebarProjectListItem, baseProps({ onOpen, invalid: true }));

		await fireEvent.click(screen.getByText("my-project"));

		expect(onOpen).not.toHaveBeenCalled();
		expect(await screen.findByText(/no longer exists on disk/i)).toBeInTheDocument();
	});

	it("Menu has no 'Close terminal' item (nothing open to close)", async () => {
		render(SidebarProjectListItem, baseProps());

		await fireEvent.contextMenu(screen.getByText("my-project"));

		expect(screen.queryByRole("menuitem", { name: "Close terminal" })).toBeNull();
	});

	it("the row is draggable (spawn source)", () => {
		const { container } = render(SidebarProjectListItem, baseProps());
		expect(container.querySelector(".item")).toHaveAttribute("draggable", "true");
	});

	it("full path is exposed via aria-label; the tooltip copy is hidden from assistive tech", () => {
		const { container } = render(SidebarProjectListItem, baseProps());
		expect(container.querySelector(".item")).toHaveAttribute(
			"aria-label",
			"my-project, /home/user/my-project",
		);
		expect(container.querySelector(".path-tooltip")).toHaveAttribute("aria-hidden", "true");
		expect(container.querySelector(".path-tooltip")).toHaveTextContent("/home/user/my-project");
	});
});

describe("SidebarProjectListItem — 1-session mode", () => {
	it("left-click switches (calls onOpen, the switch-or-open callback) rather than opening a duplicate", async () => {
		const onOpen = vi.fn();
		render(SidebarProjectListItem, baseProps({ sessions: [session("tab-1", 1)], onOpen }));

		await fireEvent.click(screen.getByText("my-project"));

		expect(onOpen).toHaveBeenCalledOnce();
	});

	it("applies the active class when its one session is the active tab", () => {
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sessions: [session("tab-1", 1)], activeTabId: "tab-1" }),
		);
		expect(container.querySelector(".item")).toHaveClass("active");
	});

	it("applies the open (not active) class when its one session isn't the active tab", () => {
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sessions: [session("tab-1", 1)], activeTabId: "some-other-tab" }),
		);
		const el = container.querySelector(".item");
		expect(el).toHaveClass("open");
		expect(el).not.toHaveClass("active");
	});

	it("Menu includes 'Close terminal', and selecting it calls onCloseTerminal", async () => {
		const onCloseTerminal = vi.fn();
		render(SidebarProjectListItem, baseProps({ sessions: [session("tab-1", 1)], onCloseTerminal }));

		await fireEvent.contextMenu(screen.getByText("my-project"));
		await fireEvent.click(screen.getByRole("menuitem", { name: "Close terminal" }));

		expect(onCloseTerminal).toHaveBeenCalledOnce();
	});

	it("no sub-items render", () => {
		const { container } = render(SidebarProjectListItem, baseProps({ sessions: [session("tab-1", 1)] }));
		expect(container.querySelector(".sub-items")).toBeNull();
	});

});

describe("SidebarProjectListItem — grouped (2+ session) mode (FR-08 v1.4)", () => {
	const sessions = [session("tab-1", 1), session("tab-2", 2)];

	it("left-click on the parent row is a no-op", async () => {
		const onOpen = vi.fn();
		render(SidebarProjectListItem, baseProps({ sessions, onOpen }));

		await fireEvent.click(screen.getByText("my-project"));

		expect(onOpen).not.toHaveBeenCalled();
	});

	it("the parent row is not draggable", () => {
		const { container } = render(SidebarProjectListItem, baseProps({ sessions }));
		expect(container.querySelector(".item")).toHaveAttribute("draggable", "false");
	});

	it("renders one Sidebar Session Sub-item per open session, labeled by stable ordinal", () => {
		render(SidebarProjectListItem, baseProps({ sessions }));

		expect(screen.getByText("Session 1")).toBeInTheDocument();
		expect(screen.getByText("Session 2")).toBeInTheDocument();
	});

	it("clicking a sub-item calls onSwitchSession with that session's tab id", async () => {
		const onSwitchSession = vi.fn();
		render(SidebarProjectListItem, baseProps({ sessions, onSwitchSession }));

		await fireEvent.click(screen.getByText("Session 2"));

		expect(onSwitchSession).toHaveBeenCalledWith("tab-2");
	});

	it("Menu has no 'Close terminal' item (closing is per sub-item, not project-scoped, when grouped)", async () => {
		render(SidebarProjectListItem, baseProps({ sessions }));

		await fireEvent.click(screen.getByRole("button", { name: "More actions for my-project" }));

		expect(screen.queryByRole("menuitem", { name: "Close terminal" })).toBeNull();
	});

	it("Menu's 'Open in new tab' still works (adds another session to the group)", async () => {
		const onForceNewTab = vi.fn();
		render(SidebarProjectListItem, baseProps({ sessions, onForceNewTab }));

		await fireEvent.click(screen.getByRole("button", { name: "More actions for my-project" }));
		await fireEvent.click(screen.getByRole("menuitem", { name: "Open in new tab" }));

		expect(onForceNewTab).toHaveBeenCalledOnce();
	});
});

describe("SidebarProjectListItem — Menu (right-click context + overflow anchored)", () => {
	it("right-click opens a context menu with Open in new tab / Edit / Delete", async () => {
		render(SidebarProjectListItem, baseProps());

		await fireEvent.contextMenu(screen.getByText("my-project"));

		expect(screen.getByRole("menuitem", { name: "Open in new tab" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
	});

	it("right-click does not itself call onOpen (no accidental left-click behavior)", async () => {
		const onOpen = vi.fn();
		render(SidebarProjectListItem, baseProps({ onOpen }));

		await fireEvent.contextMenu(screen.getByText("my-project"));

		expect(onOpen).not.toHaveBeenCalled();
	});

	it("the overflow '⋮' button opens the identical menu (anchored variant)", async () => {
		render(SidebarProjectListItem, baseProps());

		await fireEvent.click(screen.getByRole("button", { name: "More actions for my-project" }));

		expect(screen.getByRole("menuitem", { name: "Open in new tab" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
	});

	it("selecting 'Open in new tab' calls onForceNewTab, not onOpen", async () => {
		const onOpen = vi.fn();
		const onForceNewTab = vi.fn();
		render(SidebarProjectListItem, baseProps({ onOpen, onForceNewTab }));

		await fireEvent.contextMenu(screen.getByText("my-project"));
		await fireEvent.click(screen.getByRole("menuitem", { name: "Open in new tab" }));

		expect(onForceNewTab).toHaveBeenCalledOnce();
		expect(onOpen).not.toHaveBeenCalled();
	});

	it("selecting Edit/Delete from the menu calls the respective callback", async () => {
		const onEdit = vi.fn();
		render(SidebarProjectListItem, baseProps({ onEdit }));

		await fireEvent.contextMenu(screen.getByText("my-project"));
		await fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

		expect(onEdit).toHaveBeenCalledOnce();
	});

	it("the overflow button click does not bubble into the row's own left-click handler", async () => {
		const onOpen = vi.fn();
		render(SidebarProjectListItem, baseProps({ onOpen }));

		await fireEvent.click(screen.getByRole("button", { name: "More actions for my-project" }));

		expect(onOpen).not.toHaveBeenCalled();
	});

	it("clicking outside closes an open menu", async () => {
		render(SidebarProjectListItem, baseProps());
		await fireEvent.contextMenu(screen.getByText("my-project"));
		await flush();

		const outside = document.createElement("div");
		document.body.appendChild(outside);
		await fireEvent.click(outside);

		expect(screen.queryByRole("menu")).toBeNull();
		document.body.removeChild(outside);
	});
});

describe("SidebarProjectListItem — FR-11 sidebar drop bands (reorder/merge, components.md Sidebar Folder)", () => {
	// jsdom has no real DragEvent implementation — @testing-library's
	// `fireEvent.dragOver(el, { clientY })` silently drops `clientY` (it
	// comes back `undefined` in the handler), so the band-hit-testing this
	// feature depends on can't be exercised through it. Dispatching a plain
	// `Event` with `clientY` assigned directly as an own property survives
	// intact, since the handler only ever reads `e.clientY`/`e.currentTarget`,
	// never anything DragEvent-specific like `dataTransfer`.
	function dragOverAt(row: HTMLElement, clientY: number) {
		const event = new Event("dragover", { bubbles: true, cancelable: true });
		Object.assign(event, { clientY });
		row.dispatchEvent(event);
	}

	it("shows no drop band when no sidebar drag is in progress", async () => {
		const { container } = render(SidebarProjectListItem, baseProps());
		const row = container.querySelector(".item") as HTMLElement;
		stubRect(row, 0, 40);

		await dragOverAt(row, 20);

		expect(row).not.toHaveClass("drop-before");
		expect(row).not.toHaveClass("drop-merge");
		expect(row).not.toHaveClass("drop-after");
	});

	it("ignores itself as a drop target (dragging a row onto itself is a no-op)", async () => {
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sidebarDragId: project.id, sidebarDragKind: "project" }),
		);
		const row = container.querySelector(".item") as HTMLElement;
		stubRect(row, 0, 40);

		await dragOverAt(row, 20);

		expect(row).not.toHaveClass("drop-merge");
	});

	it("top ~25% band shows the 'before' reorder indicator", async () => {
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sidebarDragId: "other-project", sidebarDragKind: "project" }),
		);
		const row = container.querySelector(".item") as HTMLElement;
		stubRect(row, 0, 40);

		await dragOverAt(row, 5); // 5/40 = 12.5%

		expect(row).toHaveClass("drop-before");
	});

	it("middle ~50% band shows the merge indicator", async () => {
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sidebarDragId: "other-project", sidebarDragKind: "project" }),
		);
		const row = container.querySelector(".item") as HTMLElement;
		stubRect(row, 0, 40);

		await dragOverAt(row, 20); // 50%

		expect(row).toHaveClass("drop-merge");
	});

	it("bottom ~25% band shows the 'after' reorder indicator", async () => {
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sidebarDragId: "other-project", sidebarDragKind: "project" }),
		);
		const row = container.querySelector(".item") as HTMLElement;
		stubRect(row, 0, 40);

		await dragOverAt(row, 35); // 87.5%

		expect(row).toHaveClass("drop-after");
	});

	it("a dragged folder never shows the merge indicator — folders can't nest", async () => {
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sidebarDragId: "folder-1", sidebarDragKind: "folder" }),
		);
		const row = container.querySelector(".item") as HTMLElement;
		stubRect(row, 0, 40);

		await dragOverAt(row, 20);

		expect(row).not.toHaveClass("drop-merge");
	});

	it("a dragged folder still shows reorder bands on a project row (reordering a folder past a project is valid)", async () => {
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sidebarDragId: "folder-1", sidebarDragKind: "folder" }),
		);
		const row = container.querySelector(".item") as HTMLElement;
		stubRect(row, 0, 40);

		await dragOverAt(row, 5);

		expect(row).toHaveClass("drop-before");
	});

	it("dropping in a valid band calls onSidebarDrop with that band and clears the indicator", async () => {
		const onSidebarDrop = vi.fn();
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sidebarDragId: "other-project", sidebarDragKind: "project", onSidebarDrop }),
		);
		const row = container.querySelector(".item") as HTMLElement;
		stubRect(row, 0, 40);
		await dragOverAt(row, 20);

		await fireEvent.drop(row);

		expect(onSidebarDrop).toHaveBeenCalledWith("merge");
		expect(row).not.toHaveClass("drop-merge");
	});

	it("dropping a self-drag calls nothing (no-op, not even with an invalid band)", async () => {
		const onSidebarDrop = vi.fn();
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sidebarDragId: project.id, sidebarDragKind: "project", onSidebarDrop }),
		);
		const row = container.querySelector(".item") as HTMLElement;
		stubRect(row, 0, 40);
		await dragOverAt(row, 20);

		await fireEvent.drop(row);

		expect(onSidebarDrop).not.toHaveBeenCalled();
	});

	it("dragleave clears the indicator without calling onSidebarDrop", async () => {
		const onSidebarDrop = vi.fn();
		const { container } = render(
			SidebarProjectListItem,
			baseProps({ sidebarDragId: "other-project", sidebarDragKind: "project", onSidebarDrop }),
		);
		const row = container.querySelector(".item") as HTMLElement;
		stubRect(row, 0, 40);
		await dragOverAt(row, 20);

		await fireEvent.dragLeave(row);

		expect(row).not.toHaveClass("drop-merge");
		expect(onSidebarDrop).not.toHaveBeenCalled();
	});
});

describe("SidebarProjectListItem — hover state after right-click menu closes (regression)", () => {
	// Some webviews (WebKitGTK on Linux) leave `:hover` stuck on the
	// right-clicked row after the popup closes, even though the pointer has
	// moved on — hover is tracked in JS instead so it can be forced off.
	it("closing a right-click-opened menu clears the row's hover state", async () => {
		const { container } = render(SidebarProjectListItem, baseProps());
		const row = screen.getByText("my-project").closest(".item") as HTMLElement;

		await fireEvent.mouseEnter(row);
		expect(row).toHaveClass("hovering");

		await fireEvent.contextMenu(row);
		await flush();
		expect(row).toHaveClass("hovering");

		await fireEvent.keyDown(window, { key: "Escape" });

		expect(row).not.toHaveClass("hovering");
		expect(container.querySelector('[role="menu"]')).toBeNull();
	});

	it("closing the overflow ('⋮') anchored menu leaves hover state untouched", async () => {
		render(SidebarProjectListItem, baseProps());
		const row = screen.getByText("my-project").closest(".item") as HTMLElement;

		await fireEvent.mouseEnter(row);
		await fireEvent.click(screen.getByRole("button", { name: "More actions for my-project" }));
		await flush();
		await fireEvent.keyDown(window, { key: "Escape" });

		expect(row).toHaveClass("hovering");
	});
});
