import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import SidebarFolder from "./SidebarFolder.svelte";
import type { FolderDto, ProjectDto } from "$lib/api";

function project(id: string): ProjectDto {
	return { id, name: id, path: `/tmp/${id}`, setupCommands: [], notes: "" };
}

function folder(overrides: Partial<FolderDto> = {}): FolderDto {
	return { id: "folder-1", name: "My Folder", members: [project("a"), project("b")], ...overrides };
}

// A minimal stand-in for Sidebar.svelte's real `memberRow` snippet (which
// renders a full `SidebarProjectListItem`) — this component never needs to
// know that shape (see SidebarFolder.svelte's own doc comment on why
// `memberRow` is a snippet at all), so a tiny marker element is enough to
// assert render count/order/args here.
const memberRow = createRawSnippet(
	(getProject: () => ProjectDto, getIndex: () => number) =>
		({
			render: () => `<div class="member-row" data-id="${getProject().id}" data-index="${getIndex()}"></div>`,
		}) as { render: () => string },
);

/** jsdom has no layout engine — `getBoundingClientRect` always returns
 * zeros, so FR-11's band-hit-testing needs a stubbed rect to exercise at
 * all (same limitation SidebarProjectListItem.test.ts's own copy notes). */
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

function baseProps(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		folder: folder(),
		onSidebarDrop: vi.fn(),
		onDragStart: vi.fn(),
		onDragEnd: vi.fn(),
		onRename: vi.fn(),
		memberRow,
		...overrides,
	};
}

describe("SidebarFolder — anatomy", () => {
	it("renders the folder name and member count", () => {
		render(SidebarFolder, baseProps());
		expect(screen.getByText("My Folder")).toBeInTheDocument();
		expect(screen.getByText("(2)")).toBeInTheDocument();
	});

	it("renders one member row per member, in order, via the memberRow snippet", () => {
		const { container } = render(SidebarFolder, baseProps());
		const rows = container.querySelectorAll(".member-row");
		expect(rows).toHaveLength(2);
		expect(rows[0]).toHaveAttribute("data-id", "a");
		expect(rows[0]).toHaveAttribute("data-index", "0");
		expect(rows[1]).toHaveAttribute("data-id", "b");
		expect(rows[1]).toHaveAttribute("data-index", "1");
	});
});

describe("SidebarFolder — expand/collapse", () => {
	it("starts expanded, showing members", () => {
		const { container } = render(SidebarFolder, baseProps());
		expect(container.querySelector(".members")).not.toBeNull();
	});

	it("clicking the chevron collapses it, hiding members", async () => {
		const { container } = render(SidebarFolder, baseProps());
		await fireEvent.click(screen.getByRole("button", { name: "Collapse My Folder" }));
		expect(container.querySelector(".members")).toBeNull();
	});

	it("clicking the header body (not the name) also toggles", async () => {
		const { container } = render(SidebarFolder, baseProps());
		const header = container.querySelector(".header") as HTMLElement;
		await fireEvent.click(header);
		expect(container.querySelector(".members")).toBeNull();
	});

	it("clicking the chevron again re-expands", async () => {
		const { container } = render(SidebarFolder, baseProps());
		await fireEvent.click(screen.getByRole("button", { name: "Collapse My Folder" }));
		await fireEvent.click(screen.getByRole("button", { name: "Expand My Folder" }));
		expect(container.querySelector(".members")).not.toBeNull();
	});
});

// components.md v2.4: rename moved from left-click to right-click. Left-click
// on the name now falls through to the header's expand/collapse like every
// other click on the row.
describe("SidebarFolder — rename (FR-11)", () => {
	function startRenaming(container: HTMLElement) {
		return fireEvent.contextMenu(container.querySelector(".header") as HTMLElement);
	}

	it("right-clicking the header enters renaming mode with the current name pre-filled", async () => {
		const { container } = render(SidebarFolder, baseProps());
		await startRenaming(container);
		expect(screen.getByLabelText("Rename My Folder")).toHaveValue("My Folder");
	});

	it("right-clicking suppresses the webview's own context menu", async () => {
		const { container } = render(SidebarFolder, baseProps());
		const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
		(container.querySelector(".header") as HTMLElement).dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});

	it("left-clicking the name toggles expand/collapse instead of renaming", async () => {
		const { container } = render(SidebarFolder, baseProps());

		await fireEvent.click(screen.getByRole("button", { name: "My Folder" }));

		expect(screen.queryByLabelText("Rename My Folder")).toBeNull();
		expect(container.querySelector(".members")).toBeNull();
	});

	it("F2 on the focused name is the keyboard path into rename (components.md Accessibility)", async () => {
		render(SidebarFolder, baseProps());

		await fireEvent.keyDown(screen.getByRole("button", { name: "My Folder" }), { key: "F2" });

		expect(screen.getByLabelText("Rename My Folder")).toHaveValue("My Folder");
	});

	it("right-clicking while already renaming leaves the field's native menu alone", async () => {
		const { container } = render(SidebarFolder, baseProps());
		await startRenaming(container);

		const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
		screen.getByLabelText("Rename My Folder").dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
	});

	it("Enter commits a changed, non-blank name", async () => {
		const onRename = vi.fn();
		const { container } = render(SidebarFolder, baseProps({ onRename }));
		await startRenaming(container);
		const input = screen.getByLabelText("Rename My Folder");
		await fireEvent.input(input, { target: { value: "Renamed" } });
		await fireEvent.keyDown(input, { key: "Enter" });

		expect(onRename).toHaveBeenCalledWith("Renamed");
	});

	it("blur also commits", async () => {
		const onRename = vi.fn();
		const { container } = render(SidebarFolder, baseProps({ onRename }));
		await startRenaming(container);
		const input = screen.getByLabelText("Rename My Folder");
		await fireEvent.input(input, { target: { value: "Renamed" } });
		await fireEvent.blur(input);

		expect(onRename).toHaveBeenCalledWith("Renamed");
	});

	it("a blank/whitespace-only name reverts silently — onRename is never called (PRD edge case)", async () => {
		const onRename = vi.fn();
		const { container } = render(SidebarFolder, baseProps({ onRename }));
		await startRenaming(container);
		const input = screen.getByLabelText("Rename My Folder");
		await fireEvent.input(input, { target: { value: "   " } });
		await fireEvent.keyDown(input, { key: "Enter" });

		expect(onRename).not.toHaveBeenCalled();
	});

	it("Escape cancels without calling onRename", async () => {
		const onRename = vi.fn();
		const { container } = render(SidebarFolder, baseProps({ onRename }));
		await startRenaming(container);
		const input = screen.getByLabelText("Rename My Folder");
		await fireEvent.input(input, { target: { value: "Renamed" } });
		await fireEvent.keyDown(input, { key: "Escape" });

		expect(onRename).not.toHaveBeenCalled();
		expect(screen.queryByLabelText("Rename My Folder")).toBeNull();
	});

	it("committing the exact same (unchanged) name does not call onRename", async () => {
		const onRename = vi.fn();
		const { container } = render(SidebarFolder, baseProps({ onRename }));
		await startRenaming(container);
		const input = screen.getByLabelText("Rename My Folder");
		await fireEvent.keyDown(input, { key: "Enter" });

		expect(onRename).not.toHaveBeenCalled();
	});
});

describe("SidebarFolder — drag source (reorder-only, components.md Do/Don't)", () => {
	it("the header is draggable", () => {
		const { container } = render(SidebarFolder, baseProps());
		expect(container.querySelector(".header")).toHaveAttribute("draggable", "true");
	});

	it("is not draggable while renaming", async () => {
		const { container } = render(SidebarFolder, baseProps());
		await fireEvent.contextMenu(container.querySelector(".header") as HTMLElement);
		expect(container.querySelector(".header")).toHaveAttribute("draggable", "false");
	});

	it("dragstart calls onDragStart; dragend calls onDragEnd", async () => {
		const onDragStart = vi.fn();
		const onDragEnd = vi.fn();
		const { container } = render(SidebarFolder, baseProps({ onDragStart, onDragEnd }));
		const header = container.querySelector(".header") as HTMLElement;

		await fireEvent.dragStart(header);
		expect(onDragStart).toHaveBeenCalledOnce();

		await fireEvent.dragEnd(header);
		expect(onDragEnd).toHaveBeenCalledOnce();
	});
});

describe("SidebarFolder — drop bands (FR-11)", () => {
	// jsdom has no real DragEvent implementation — `fireEvent.dragOver(el, {
	// clientY })` silently drops `clientY` (same limitation noted in
	// SidebarProjectListItem.test.ts) — dispatch a plain Event with `clientY`
	// assigned directly instead.
	function dragOverAt(el: HTMLElement, clientY: number) {
		const event = new Event("dragover", { bubbles: true, cancelable: true });
		Object.assign(event, { clientY });
		el.dispatchEvent(event);
	}

	it("shows no drop indicator without a sidebar drag in progress", async () => {
		const { container } = render(SidebarFolder, baseProps());
		const header = container.querySelector(".header") as HTMLElement;
		stubRect(header, 0, 40);

		await dragOverAt(header, 20);

		expect(header).not.toHaveClass("drop-merge");
	});

	it("ignores itself as a drop target", async () => {
		const { container } = render(
			SidebarFolder,
			baseProps({ sidebarDragId: "folder-1", sidebarDragKind: "folder" }),
		);
		const header = container.querySelector(".header") as HTMLElement;
		stubRect(header, 0, 40);

		await dragOverAt(header, 20);

		expect(header).not.toHaveClass("drop-merge");
	});

	it("a dragged project shows the merge indicator in the middle band (joins this folder)", async () => {
		const { container } = render(
			SidebarFolder,
			baseProps({ sidebarDragId: "proj-x", sidebarDragKind: "project" }),
		);
		const header = container.querySelector(".header") as HTMLElement;
		stubRect(header, 0, 40);

		await dragOverAt(header, 20);

		expect(header).toHaveClass("drop-merge");
	});

	it("a dragged folder never shows the merge indicator — folders can't nest", async () => {
		const { container } = render(
			SidebarFolder,
			baseProps({ sidebarDragId: "folder-2", sidebarDragKind: "folder" }),
		);
		const header = container.querySelector(".header") as HTMLElement;
		stubRect(header, 0, 40);

		await dragOverAt(header, 20);

		expect(header).not.toHaveClass("drop-merge");
	});

	it("a dragged folder still shows reorder bands (top-level repositioning is valid)", async () => {
		const { container } = render(
			SidebarFolder,
			baseProps({ sidebarDragId: "folder-2", sidebarDragKind: "folder" }),
		);
		const header = container.querySelector(".header") as HTMLElement;
		stubRect(header, 0, 40);

		await dragOverAt(header, 5);

		expect(header).toHaveClass("drop-before");
	});

	it("drop calls onSidebarDrop with the resolved band and clears the indicator", async () => {
		const onSidebarDrop = vi.fn();
		const { container } = render(
			SidebarFolder,
			baseProps({ sidebarDragId: "proj-x", sidebarDragKind: "project", onSidebarDrop }),
		);
		const header = container.querySelector(".header") as HTMLElement;
		stubRect(header, 0, 40);
		await dragOverAt(header, 20);

		await fireEvent.drop(header);

		expect(onSidebarDrop).toHaveBeenCalledWith("merge");
		expect(header).not.toHaveClass("drop-merge");
	});
});
