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
vi.mock("$lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/api")>();
	return {
		...actual,
		exportConfig: (...args: unknown[]) => exportConfigMock(...args),
		importConfig: (...args: unknown[]) => importConfigMock(...args),
		deleteProject: (...args: unknown[]) => deleteProjectMock(...args),
		pathExists: (...args: unknown[]) => pathExistsMock(...args),
		closeTerminal: (...args: unknown[]) => closeTerminalMock(...args),
	};
});

import Sidebar from "./Sidebar.svelte";
import { appStore } from "$lib/stores/app.svelte";
import { terminalStore } from "$lib/stores/terminal.svelte";
import type { ProjectDto } from "$lib/api";

const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
	saveDialogMock.mockReset();
	openDialogMock.mockReset();
	exportConfigMock.mockReset();
	importConfigMock.mockReset();
	deleteProjectMock.mockReset();
	pathExistsMock.mockReset();
	closeTerminalMock.mockReset();
	closeTerminalMock.mockResolvedValue(undefined);
	deleteProjectMock.mockResolvedValue(undefined);
	pathExistsMock.mockResolvedValue(true);
	appStore.projects = [];
	appStore.password = "master-pw";
	appStore.sidebarHidden = false;
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

describe("Sidebar — invalid path indicator (FR-01 edge case)", () => {
	it("marks a project invalid when its path no longer exists, and clicking shows a message instead of opening it", async () => {
		pathExistsMock.mockImplementation(async (path: string) => path !== "/gone");
		appStore.projects = [
			{ id: "a", name: "gone-project", path: "/gone", setupCommands: [], notes: "" },
		];
		const onOpenProject = vi.fn();
		render(Sidebar, { onOpenProject, onForceNewTab: vi.fn() });

		const row = await screen.findByText("gone-project");
		await fireEvent.click(row);

		expect(onOpenProject).not.toHaveBeenCalled();
		expect(await screen.findByText(/no longer exists on disk/i)).toBeInTheDocument();
	});

	it("does not mark a project invalid when its path exists", async () => {
		pathExistsMock.mockResolvedValue(true);
		appStore.projects = [
			{ id: "a", name: "healthy-project", path: "/ok", setupCommands: [], notes: "" },
		];
		const onOpenProject = vi.fn();
		render(Sidebar, { onOpenProject, onForceNewTab: vi.fn() });

		const row = await screen.findByText("healthy-project");
		await fireEvent.click(row);

		expect(onOpenProject).toHaveBeenCalledOnce();
	});
});

describe("Sidebar — delete project with open sessions (FR-08 v1.4 edge case)", () => {
	it("closes all of a project's open sessions before deleting it", async () => {
		appStore.projects = [{ id: "a", name: "busy-project", path: "/busy", setupCommands: [], notes: "" }];
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
		appStore.projects = [{ id: "a", name: "busy-project", path: "/busy", setupCommands: [], notes: "" }];
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
		appStore.projects = [{ id: "a", name: "idle-project", path: "/idle", setupCommands: [], notes: "" }];

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
		const imported: ProjectDto[] = [
			{ id: "x", name: "imported-project", path: "/tmp/x", setupCommands: [], notes: "" },
		];
		importConfigMock.mockResolvedValue(imported);
		appStore.projects = [
			{ id: "old", name: "old-project", path: "/tmp/old", setupCommands: [], notes: "" },
		];

		render(Sidebar, { onOpenProject: vi.fn(), onForceNewTab: vi.fn() });
		await fireEvent.click(screen.getByRole("button", { name: "Import" }));
		await fireEvent.click(screen.getByRole("button", { name: "Replace and import" }));

		expect(importConfigMock).toHaveBeenCalledWith("/tmp/incoming.enc", "master-pw");
		expect(appStore.projects).toEqual(imported);
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
