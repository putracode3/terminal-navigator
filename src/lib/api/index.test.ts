import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Imported after the mock so the module under test picks up the mocked `invoke`.
import {
	unlock,
	listSidebarEntries,
	addProject,
	updateProject,
	deleteProject,
	openTerminal,
	splitPane,
	writeTerminal,
	resizeTerminal,
	closeTerminal,
	exportConfig,
	importConfig,
	pathExists,
	getGitBranch,
	mergeProjects,
	moveProject,
	reorderFolder,
	renameFolder,
	isAppError,
	errorMessage,
} from "./index";

describe("api/index — IPC command mapping", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue(undefined);
	});

	// Each assertion pins the exact command name (must match the Rust
	// #[tauri::command] fn name literally) and the exact camelCase argument
	// keys (Tauri auto-camelCases command args; the Rust DTOs are
	// #[serde(rename_all = "camelCase")]) — a mismatch here breaks the
	// feature silently at runtime, so this is the single highest-value test
	// in the whole frontend suite.

	it("unlock() invokes 'unlock' with the password", () => {
		unlock("hunter2");
		expect(invokeMock).toHaveBeenCalledWith("unlock", { password: "hunter2" });
	});

	it("listSidebarEntries() invokes 'list_sidebar_entries' with no args", () => {
		listSidebarEntries();
		expect(invokeMock).toHaveBeenCalledWith("list_sidebar_entries");
	});

	it("addProject() invokes 'add_project' with the input under 'input'", () => {
		const input = { name: "n", path: "/p", setupCommands: ["echo hi"], notes: "note" };
		addProject(input);
		expect(invokeMock).toHaveBeenCalledWith("add_project", { input });
	});

	it("updateProject() invokes 'update_project' with camelCase id + input", () => {
		const input = { name: "n", path: "/p", setupCommands: [], notes: "" };
		updateProject("abc-123", input);
		expect(invokeMock).toHaveBeenCalledWith("update_project", { id: "abc-123", input });
	});

	it("deleteProject() invokes 'delete_project' with the id", () => {
		deleteProject("abc-123");
		expect(invokeMock).toHaveBeenCalledWith("delete_project", { id: "abc-123" });
	});

	it("openTerminal() camelCases projectId/sessionId", () => {
		openTerminal("proj-1", "sess-1");
		expect(invokeMock).toHaveBeenCalledWith("open_terminal", {
			projectId: "proj-1",
			sessionId: "sess-1",
		});
	});

	it("splitPane() camelCases sessionId and passes cwd", () => {
		splitPane("sess-1", "/some/path");
		expect(invokeMock).toHaveBeenCalledWith("split_pane", { sessionId: "sess-1", cwd: "/some/path" });
	});

	it("writeTerminal() passes sessionId and data", () => {
		writeTerminal("sess-1", "echo hi\n");
		expect(invokeMock).toHaveBeenCalledWith("write_terminal", { sessionId: "sess-1", data: "echo hi\n" });
	});

	it("resizeTerminal() passes sessionId, rows, cols", () => {
		resizeTerminal("sess-1", 24, 80);
		expect(invokeMock).toHaveBeenCalledWith("resize_terminal", { sessionId: "sess-1", rows: 24, cols: 80 });
	});

	it("closeTerminal() passes sessionId", () => {
		closeTerminal("sess-1");
		expect(invokeMock).toHaveBeenCalledWith("close_terminal", { sessionId: "sess-1" });
	});

	it("exportConfig() passes destination", () => {
		exportConfig("/tmp/out.enc");
		expect(invokeMock).toHaveBeenCalledWith("export_config", { destination: "/tmp/out.enc" });
	});

	it("importConfig() passes source and password", () => {
		importConfig("/tmp/in.enc", "hunter2");
		expect(invokeMock).toHaveBeenCalledWith("import_config", {
			source: "/tmp/in.enc",
			password: "hunter2",
		});
	});

	it("pathExists() passes path", () => {
		pathExists("/tmp/some-project");
		expect(invokeMock).toHaveBeenCalledWith("path_exists", { path: "/tmp/some-project" });
	});

	it("getGitBranch() passes path", () => {
		getGitBranch("/tmp/some-project");
		expect(invokeMock).toHaveBeenCalledWith("get_git_branch", { path: "/tmp/some-project" });
	});

	it("mergeProjects() passes draggedId and targetId", () => {
		mergeProjects("drag-1", "target-1");
		expect(invokeMock).toHaveBeenCalledWith("merge_projects", { draggedId: "drag-1", targetId: "target-1" });
	});

	it("moveProject() passes projectId, destination, and index", () => {
		moveProject("proj-1", { type: "folder", folderId: "folder-1" }, 2);
		expect(invokeMock).toHaveBeenCalledWith("move_project", {
			projectId: "proj-1",
			destination: { type: "folder", folderId: "folder-1" },
			index: 2,
		});
	});

	it("reorderFolder() passes folderId and index", () => {
		reorderFolder("folder-1", 3);
		expect(invokeMock).toHaveBeenCalledWith("reorder_folder", { folderId: "folder-1", index: 3 });
	});

	it("renameFolder() passes folderId and name", () => {
		renameFolder("folder-1", "New name");
		expect(invokeMock).toHaveBeenCalledWith("rename_folder", { folderId: "folder-1", name: "New name" });
	});
});

describe("isAppError / errorMessage", () => {
	it("recognizes a well-formed AppError", () => {
		expect(isAppError({ kind: "not_found", message: "gone" })).toBe(true);
	});

	it("rejects a plain Error instance", () => {
		expect(isAppError(new Error("boom"))).toBe(false);
	});

	it("rejects null/undefined/primitives", () => {
		expect(isAppError(null)).toBe(false);
		expect(isAppError(undefined)).toBe(false);
		expect(isAppError("boom")).toBe(false);
	});

	it("errorMessage extracts the message from an AppError", () => {
		expect(errorMessage({ kind: "locked", message: "The store is locked." })).toBe(
			"The store is locked.",
		);
	});

	it("errorMessage extracts the message from a native Error", () => {
		expect(errorMessage(new Error("network down"))).toBe("network down");
	});

	it("errorMessage stringifies anything else", () => {
		expect(errorMessage("plain string")).toBe("plain string");
	});
});
