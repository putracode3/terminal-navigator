import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";

const saveDialogMock = vi.fn();
const openDialogMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
	save: (...args: unknown[]) => saveDialogMock(...args),
	open: (...args: unknown[]) => openDialogMock(...args),
}));

const exportConfigMock = vi.fn();
const importConfigMock = vi.fn();
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
		exportConfig: (...args: unknown[]) => exportConfigMock(...args),
		importConfig: (...args: unknown[]) => importConfigMock(...args),
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
	saveDialogMock.mockReset();
	openDialogMock.mockReset();
	exportConfigMock.mockReset();
	importConfigMock.mockReset();
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
	appStore.password = "master-pw";
	appStore.sidebarHidden = false;
	appStore.sidebarDrag = null;
	terminalStore.tabs = [];
	terminalStore.activeTabId = null;
});

describe("Sidebar — show/hide toggle", () => {
	it("clicking 'Hide sidebar' sets appStore.sidebarHidden", async () => {
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

		expect(appStore.sidebarHidden).toBe(true);
	});
});

describe("Sidebar — Settings trigger (FR-13)", () => {
	it("does not render the Settings modal until opened", () => {
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
	});

	it("clicking the Settings button opens the Settings modal", async () => {
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Settings" }));

		expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
	});
});

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

describe("Sidebar — export (FR-07)", () => {
	it("does nothing if the user cancels the save dialog", async () => {
		saveDialogMock.mockResolvedValue(null);
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Export" }));

		expect(exportConfigMock).not.toHaveBeenCalled();
	});

	it("exports to the chosen destination and shows a confirmation", async () => {
		saveDialogMock.mockResolvedValue("/tmp/backup.enc");
		exportConfigMock.mockResolvedValue(undefined);
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Export" }));

		expect(exportConfigMock).toHaveBeenCalledWith("/tmp/backup.enc");
		expect(await screen.findByText("Exported")).toBeInTheDocument();
	});

	it("shows the backend error when export fails", async () => {
		saveDialogMock.mockResolvedValue("/tmp/backup.enc");
		exportConfigMock.mockRejectedValue({ kind: "invalid_input", message: "Nothing to export yet." });
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Export" }));

		expect(await screen.findByText("Nothing to export yet.")).toBeInTheDocument();
	});
});

describe("Sidebar — import (FR-07, ADR-0008 replace-only)", () => {
	it("does nothing if the user cancels the file picker", async () => {
		openDialogMock.mockResolvedValue(null);
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Import" }));

		expect(screen.queryByRole("dialog", { name: "Import project data" })).toBeNull();
	});

	it("shows a replace-data confirmation before importing", async () => {
		openDialogMock.mockResolvedValue("/tmp/incoming.enc");
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Import" }));

		expect(await screen.findByText(/This cannot be undone/i)).toBeInTheDocument();
		expect(importConfigMock).not.toHaveBeenCalled();
	});

	it("cancelling the confirmation does not call importConfig", async () => {
		openDialogMock.mockResolvedValue("/tmp/incoming.enc");
		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });
		await fireEvent.click(screen.getByRole("button", { name: "Import" }));
		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(importConfigMock).not.toHaveBeenCalled();
	});

	it("confirming imports using the already-unlocked session's password and replaces the project list", async () => {
		openDialogMock.mockResolvedValue("/tmp/incoming.enc");
		const imported: SidebarEntryDto[] = [projectEntry({ id: "x", name: "imported-project", path: "/tmp/x" })];
		importConfigMock.mockResolvedValue(imported);
		appStore.entries = [projectEntry({ id: "old", name: "old-project", path: "/tmp/old" })];

		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });
		await fireEvent.click(screen.getByRole("button", { name: "Import" }));
		await fireEvent.click(screen.getByRole("button", { name: "Replace and import" }));

		expect(importConfigMock).toHaveBeenCalledWith("/tmp/incoming.enc", "master-pw");
		expect(appStore.entries).toEqual(imported);
	});

	it("shows the backend error when import validation fails (wrong password / bad file)", async () => {
		openDialogMock.mockResolvedValue("/tmp/incoming.enc");
		importConfigMock.mockRejectedValue({
			kind: "invalid_input",
			message: "Import file could not be decrypted.",
		});

		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });
		await fireEvent.click(screen.getByRole("button", { name: "Import" }));
		await fireEvent.click(screen.getByRole("button", { name: "Replace and import" }));

		expect(await screen.findByText("Import file could not be decrypted.")).toBeInTheDocument();
	});
});

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

		await fireEvent.click(screen.getByRole("button", { name: "Old Name" }));
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
