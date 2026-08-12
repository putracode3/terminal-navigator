import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";

const deleteProjectMock = vi.fn();
const pathExistsMock = vi.fn();
const closeTerminalMock = vi.fn();
const mergeProjectsMock = vi.fn();
const moveProjectMock = vi.fn();
const reorderFolderMock = vi.fn();
const renameFolderMock = vi.fn();
const listSidebarEntriesMock = vi.fn();
vi.mock("$lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/api")>();
	return {
		...actual,
		deleteProject: (...args: unknown[]) => deleteProjectMock(...args),
		pathExists: (...args: unknown[]) => pathExistsMock(...args),
		closeTerminal: (...args: unknown[]) => closeTerminalMock(...args),
		mergeProjects: (...args: unknown[]) => mergeProjectsMock(...args),
		moveProject: (...args: unknown[]) => moveProjectMock(...args),
		reorderFolder: (...args: unknown[]) => reorderFolderMock(...args),
		renameFolder: (...args: unknown[]) => renameFolderMock(...args),
		listSidebarEntries: (...args: unknown[]) => listSidebarEntriesMock(...args),
	};
});

import Sidebar from "./Sidebar.svelte";
import { appStore } from "$lib/stores/app.svelte";
import { terminalStore } from "$lib/stores/terminal.svelte";
import type { ProjectDto, SidebarEntryDto } from "$lib/api";

function projectEntry(overrides: Partial<ProjectDto> = {}): SidebarEntryDto {
	return { type: "project", id: "a", name: "demo", path: "/tmp/demo", setupCommands: [], notes: "", ...overrides };
}

function folderEntry(id: string, name: string, members: ProjectDto[]): SidebarEntryDto {
	return { type: "folder", id, name, members };
}

function project(overrides: Partial<ProjectDto> = {}): ProjectDto {
	return { id: "a", name: "demo", path: "/tmp/demo", setupCommands: [], notes: "", ...overrides };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

// jsdom has no real DragEvent implementation — dispatching a plain Event
// with `clientY` assigned directly survives intact, unlike
// `fireEvent.dragOver(el, { clientY })`, which silently drops it (see
// SidebarProjectListItem.test.ts's own note on this jsdom limitation).
function dragOverAt(el: HTMLElement, clientY: number) {
	const event = new Event("dragover", { bubbles: true, cancelable: true });
	Object.assign(event, { clientY });
	el.dispatchEvent(event);
}

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

beforeEach(() => {
	deleteProjectMock.mockReset();
	pathExistsMock.mockReset();
	closeTerminalMock.mockReset();
	mergeProjectsMock.mockReset();
	moveProjectMock.mockReset();
	reorderFolderMock.mockReset();
	renameFolderMock.mockReset();
	listSidebarEntriesMock.mockReset();
	closeTerminalMock.mockResolvedValue(undefined);
	deleteProjectMock.mockResolvedValue(undefined);
	pathExistsMock.mockResolvedValue(true);
	appStore.entries = [];
	appStore.sidebarHidden = false;
	appStore.sidebarDrag = null;
	terminalStore.tabs = [];
	terminalStore.activeTabId = null;
});

// v2.8: show/hide toggle and Settings trigger moved to TitleBar.svelte — see
// TitleBar.test.ts. Export/Import moved to SettingsModal.svelte's Data group
// — see SettingsModal.test.ts.

describe("Sidebar — invalid path indicator (FR-01 edge case)", () => {
	it("marks a project invalid when its path no longer exists, and clicking shows a message instead of opening it", async () => {
		pathExistsMock.mockImplementation(async (path: string) => path !== "/gone");
		appStore.entries = [projectEntry({ id: "a", name: "gone-project", path: "/gone" })];
		const onOpenProject = vi.fn();
		render(Sidebar, { onOpenProject, onForceNewTab: vi.fn() });

		const row = await screen.findByText("gone-project");
		await fireEvent.click(row);

		expect(onOpenProject).not.toHaveBeenCalled();
		expect(await screen.findByText(/no longer exists on disk/i)).toBeInTheDocument();
	});

	it("does not mark a project invalid when its path exists", async () => {
		pathExistsMock.mockResolvedValue(true);
		appStore.entries = [projectEntry({ id: "a", name: "healthy-project", path: "/ok" })];
		const onOpenProject = vi.fn();
		render(Sidebar, { onOpenProject, onForceNewTab: vi.fn() });

		const row = await screen.findByText("healthy-project");
		await fireEvent.click(row);

		expect(onOpenProject).toHaveBeenCalledOnce();
	});
});

describe("Sidebar — delete project with open sessions (FR-08 v1.4 edge case)", () => {
	it("closes all of a project's open sessions before deleting it", async () => {
		appStore.entries = [projectEntry({ id: "a", name: "busy-project", path: "/busy" })];
		const tab = terminalStore.openTab("a", "busy-project", "/busy");
		const paneId = (tab.root as { sessionId: string }).sessionId;

		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });
		const row = await screen.findByText("busy-project");
		await fireEvent.contextMenu(row);
		await fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
		await fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
		await flush();

		expect(closeTerminalMock).toHaveBeenCalledWith(paneId);
		expect(deleteProjectMock).toHaveBeenCalledWith("a");
		expect(terminalStore.tabs.find((t) => t.id === tab.id)).toBeUndefined();
	});

	it("closes every open session when a project has 2+ (grouped mode)", async () => {
		appStore.entries = [projectEntry({ id: "a", name: "busy-project", path: "/busy" })];
		const tabA = terminalStore.openTab("a", "busy-project", "/busy");
		const tabB = terminalStore.openTab("a", "busy-project", "/busy");
		const paneA = (tabA.root as { sessionId: string }).sessionId;
		const paneB = (tabB.root as { sessionId: string }).sessionId;

		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });
		const row = await screen.findByText("busy-project");
		await fireEvent.contextMenu(row);
		await fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
		await fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
		await flush();

		expect(closeTerminalMock).toHaveBeenCalledWith(paneA);
		expect(closeTerminalMock).toHaveBeenCalledWith(paneB);
		expect(deleteProjectMock).toHaveBeenCalledWith("a");
	});

	it("deletes normally (no closeTerminal calls) when the project has no open sessions", async () => {
		appStore.entries = [projectEntry({ id: "a", name: "idle-project", path: "/idle" })];

		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });
		const row = await screen.findByText("idle-project");
		await fireEvent.contextMenu(row);
		await fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
		await fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
		await flush();

		expect(closeTerminalMock).not.toHaveBeenCalled();
		expect(deleteProjectMock).toHaveBeenCalledWith("a");
	});
});

// v2.8: export/import coverage relocated to SettingsModal.test.ts.

describe("Sidebar — FR-11 sidebar folder drag-drop", () => {
	it("dropping one project row onto another's merge band calls mergeProjects and refreshes the tree from the backend", async () => {
		appStore.entries = [projectEntry({ id: "a", name: "alpha" }), projectEntry({ id: "b", name: "beta" })];
		mergeProjectsMock.mockResolvedValue({
			id: "folder-1",
			name: "beta",
			members: [project({ id: "b", name: "beta" }), project({ id: "a", name: "alpha" })],
		});
		const refreshed = [
			folderEntry("folder-1", "beta", [project({ id: "b", name: "beta" }), project({ id: "a", name: "alpha" })]),
		];
		listSidebarEntriesMock.mockResolvedValue(refreshed);
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		appStore.startDraggingSidebarEntry("project", "a");
		await flush();
		const targetRow = screen.getByText("beta").closest(".item") as HTMLElement;
		stubRect(targetRow, 0, 40);
		dragOverAt(targetRow, 20); // middle band
		await fireEvent.drop(targetRow);
		await flush();

		expect(mergeProjectsMock).toHaveBeenCalledWith("a", "b");
		expect(listSidebarEntriesMock).toHaveBeenCalledOnce();
		expect(appStore.entries).toEqual(refreshed);
		expect(appStore.sidebarDrag).toBeNull();
	});

	it("dropping a project onto another's top reorder band calls moveProject with the top-level destination and that row's index", async () => {
		appStore.entries = [projectEntry({ id: "a", name: "alpha" }), projectEntry({ id: "b", name: "beta" })];
		moveProjectMock.mockResolvedValue(undefined);
		listSidebarEntriesMock.mockResolvedValue(appStore.entries);
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		appStore.startDraggingSidebarEntry("project", "b");
		await flush();
		const targetRow = screen.getByText("alpha").closest(".item") as HTMLElement;
		stubRect(targetRow, 0, 40);
		dragOverAt(targetRow, 5); // top band -> "before", alpha's own index (0)
		await fireEvent.drop(targetRow);
		await flush();

		expect(moveProjectMock).toHaveBeenCalledWith("b", { type: "topLevel" }, 0);
	});

	it("dropping a project onto another's bottom reorder band uses index + 1 ('after')", async () => {
		appStore.entries = [projectEntry({ id: "a", name: "alpha" }), projectEntry({ id: "b", name: "beta" })];
		moveProjectMock.mockResolvedValue(undefined);
		listSidebarEntriesMock.mockResolvedValue(appStore.entries);
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		appStore.startDraggingSidebarEntry("project", "b");
		await flush();
		const targetRow = screen.getByText("alpha").closest(".item") as HTMLElement;
		stubRect(targetRow, 0, 40);
		dragOverAt(targetRow, 35); // bottom band -> "after", alpha's index (0) + 1
		await fireEvent.drop(targetRow);
		await flush();

		expect(moveProjectMock).toHaveBeenCalledWith("b", { type: "topLevel" }, 1);
	});

	it("dropping a project onto a folder member's merge band joins that member's folder", async () => {
		appStore.entries = [
			projectEntry({ id: "outside", name: "outside-project" }),
			folderEntry("folder-1", "My Folder", [project({ id: "m1", name: "member-one" })]),
		];
		mergeProjectsMock.mockResolvedValue({ id: "folder-1", name: "My Folder", members: [] });
		listSidebarEntriesMock.mockResolvedValue(appStore.entries);
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		appStore.startDraggingSidebarEntry("project", "outside");
		await flush();
		const memberRow = screen.getByText("member-one").closest(".item") as HTMLElement;
		stubRect(memberRow, 0, 40);
		dragOverAt(memberRow, 20);
		await fireEvent.drop(memberRow);
		await flush();

		expect(mergeProjectsMock).toHaveBeenCalledWith("outside", "m1");
	});

	it("dropping a project directly onto a folder header's merge band joins that folder", async () => {
		appStore.entries = [
			projectEntry({ id: "outside", name: "outside-project" }),
			folderEntry("folder-1", "My Folder", [project({ id: "m1", name: "member-one" })]),
		];
		mergeProjectsMock.mockResolvedValue({ id: "folder-1", name: "My Folder", members: [] });
		listSidebarEntriesMock.mockResolvedValue(appStore.entries);
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		appStore.startDraggingSidebarEntry("project", "outside");
		await flush();
		const header = screen.getByRole("button", { name: "My Folder" }).closest(".header") as HTMLElement;
		stubRect(header, 0, 40);
		dragOverAt(header, 20);
		await fireEvent.drop(header);
		await flush();

		expect(mergeProjectsMock).toHaveBeenCalledWith("outside", "folder-1");
	});

	it("reordering a folder header (dropped on another top-level row's reorder band) calls reorderFolder, not moveProject", async () => {
		appStore.entries = [
			projectEntry({ id: "a", name: "alpha" }),
			folderEntry("folder-1", "My Folder", [project({ id: "m1" })]),
		];
		reorderFolderMock.mockResolvedValue(undefined);
		listSidebarEntriesMock.mockResolvedValue(appStore.entries);
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		appStore.startDraggingSidebarEntry("folder", "folder-1");
		await flush();
		const targetRow = screen.getByText("alpha").closest(".item") as HTMLElement;
		stubRect(targetRow, 0, 40);
		dragOverAt(targetRow, 5); // top band -> "before", alpha's index (0)
		await fireEvent.drop(targetRow);
		await flush();

		expect(reorderFolderMock).toHaveBeenCalledWith("folder-1", 0);
		expect(moveProjectMock).not.toHaveBeenCalled();
	});

	it("dropping a project onto genuinely empty list space moves it back to top level, appended at the end", async () => {
		appStore.entries = [
			folderEntry("folder-1", "My Folder", [
				project({ id: "m1", name: "member-one" }),
				project({ id: "m2", name: "member-two" }),
			]),
		];
		moveProjectMock.mockResolvedValue(undefined);
		listSidebarEntriesMock.mockResolvedValue(appStore.entries);
		const { container } = render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		appStore.startDraggingSidebarEntry("project", "m1");
		await flush();
		const list = container.querySelector(".list") as HTMLElement;
		await fireEvent.dragOver(list);
		await fireEvent.drop(list);
		await flush();

		expect(moveProjectMock).toHaveBeenCalledWith("m1", { type: "topLevel" }, 1);
	});

	it("renaming a folder calls renameFolder with the committed name and refreshes the tree", async () => {
		appStore.entries = [folderEntry("folder-1", "Old Name", [project({ id: "m1" })])];
		renameFolderMock.mockResolvedValue("New Name");
		listSidebarEntriesMock.mockResolvedValue([folderEntry("folder-1", "New Name", [project({ id: "m1" })])]);
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		// components.md v2.4: rename is a right-click gesture now.
		await fireEvent.contextMenu(screen.getByText("Old Name").closest(".header") as HTMLElement);
		const input = screen.getByLabelText("Rename Old Name");
		await fireEvent.input(input, { target: { value: "New Name" } });
		await fireEvent.keyDown(input, { key: "Enter" });
		await flush();

		expect(renameFolderMock).toHaveBeenCalledWith("folder-1", "New Name");
		expect(listSidebarEntriesMock).toHaveBeenCalledOnce();
	});

	it("dropping a dragged item onto itself is a no-op (no backend call)", async () => {
		appStore.entries = [projectEntry({ id: "a", name: "alpha" }), projectEntry({ id: "b", name: "beta" })];
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		appStore.startDraggingSidebarEntry("project", "a");
		await flush();
		const ownRow = screen.getByText("alpha").closest(".item") as HTMLElement;
		stubRect(ownRow, 0, 40);
		dragOverAt(ownRow, 20);
		await fireEvent.drop(ownRow);
		await flush();

		expect(mergeProjectsMock).not.toHaveBeenCalled();
		expect(moveProjectMock).not.toHaveBeenCalled();
	});
});

// Regression (2026-07-23): a sidebar error banner, once shown, never went
// away — it survived every subsequent successful operation and had no
// dismiss control, so a single transient failure left a permanent red line
// under the Export/Import row for the rest of the session. Root cause:
// `syncStatus` had a lifecycle helper (`flashStatus`, auto-clearing) but
// `syncError` was assigned raw at six catch sites with nothing owning its
// lifetime.
// v2.8: this banner is now exclusively for drag/rename/move failures —
// export/import's own status/error lifecycle moved to SettingsModal.test.ts
// along with the buttons that trigger it. The dismiss-timing behavior itself
// (auto-dismiss after 8s, immediate manual dismiss) is shared logic that
// both components implement independently; each gets its own coverage using
// whichever trigger is actually its own.
describe("Sidebar — transient error banner lifecycle (drag/rename/move failures)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("can be dismissed immediately, without waiting out the timeout", async () => {
		appStore.entries = [projectEntry({ id: "a", name: "alpha" }), projectEntry({ id: "b", name: "beta" })];
		moveProjectMock.mockRejectedValue({ kind: "invalid_input", message: "move failed" });
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });
		await vi.advanceTimersByTimeAsync(10);

		appStore.startDraggingSidebarEntry("project", "a");
		await vi.advanceTimersByTimeAsync(10);
		const targetRow = screen.getByText("beta").closest(".item") as HTMLElement;
		stubRect(targetRow, 0, 40);
		dragOverAt(targetRow, 2);
		await fireEvent.drop(targetRow);
		await vi.advanceTimersByTimeAsync(10);
		expect(screen.getByText("move failed")).toBeInTheDocument();

		await fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));

		expect(screen.queryByText("move failed")).toBeNull();
	});

	it("a failed folder drag-drop error also auto-dismisses (not just export/import)", async () => {
		appStore.entries = [projectEntry({ id: "a", name: "alpha" }), projectEntry({ id: "b", name: "beta" })];
		moveProjectMock.mockRejectedValue({ kind: "invalid_input", message: "move failed" });
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });
		await vi.advanceTimersByTimeAsync(10);

		appStore.startDraggingSidebarEntry("project", "a");
		await vi.advanceTimersByTimeAsync(10);
		const targetRow = screen.getByText("beta").closest(".item") as HTMLElement;
		stubRect(targetRow, 0, 40);
		dragOverAt(targetRow, 2);
		await fireEvent.drop(targetRow);
		await vi.advanceTimersByTimeAsync(10);
		expect(screen.getByText("move failed")).toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(8000);

		expect(screen.queryByText("move failed")).toBeNull();
	});
});
