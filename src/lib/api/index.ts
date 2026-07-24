// Typed wrappers around the Tauri IPC commands defined in
// src-tauri/src/commands/mod.rs. This is the app's only file that calls
// `invoke` directly — everything else imports from here.
import { invoke } from "@tauri-apps/api/core";

export interface ProjectDto {
	id: string;
	name: string;
	path: string;
	setupCommands: string[];
	notes: string;
}

export interface ProjectInput {
	name: string;
	path: string;
	setupCommands: string[];
	notes: string;
}

/** FR-11 (ADR-0011): a folder's ordered members — order is display position,
 * same as the top-level `SidebarEntryDto[]` array itself. */
export interface FolderDto {
	id: string;
	name: string;
	members: ProjectDto[];
}

/** FR-11: the sidebar's top-level tree, replacing the pre-FR-11 flat
 * `ProjectDto[]` — discriminated by `type` so folders and ungrouped projects
 * can interleave in one array. */
export type SidebarEntryDto = ({ type: "project" } & ProjectDto) | ({ type: "folder" } & FolderDto);

/** FR-11: where `moveProject` sends a project — mirrors the Rust
 * `MoveDestination` enum. */
export type MoveDestinationDto = { type: "topLevel" } | { type: "folder"; folderId: string };

export interface AppError {
	kind: string;
	message: string;
}

export function isAppError(e: unknown): e is AppError {
	return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

/** Extracts a human-readable message whether `e` is an AppError or something else. */
export function errorMessage(e: unknown): string {
	if (isAppError(e)) return e.message;
	if (e instanceof Error) return e.message;
	return String(e);
}

export function unlock(password: string): Promise<SidebarEntryDto[]> {
	return invoke("unlock", { password });
}

/** FR-11: renamed from `list_projects` on the Rust side — the sidebar tree
 * now includes folders, not just a flat project list. */
export function listSidebarEntries(): Promise<SidebarEntryDto[]> {
	return invoke("list_sidebar_entries");
}

export function addProject(input: ProjectInput): Promise<ProjectDto> {
	return invoke("add_project", { input });
}

export function updateProject(id: string, input: ProjectInput): Promise<ProjectDto> {
	return invoke("update_project", { id, input });
}

export function deleteProject(id: string): Promise<void> {
	return invoke("delete_project", { id });
}

/** FR-11 "drop onto a row's merge band": creates a new folder or joins an
 * existing one depending on what `targetId` currently is — the backend
 * resolves which case applies (see `merge_or_join`'s own doc comment in
 * project_store); the frontend always calls this for any merge-band drop. */
export function mergeProjects(draggedId: string, targetId: string): Promise<FolderDto> {
	return invoke("merge_projects", { draggedId, targetId });
}

/** FR-11 "drop onto a reorder band, or move between folders/top level": one
 * primitive for both — reordering-in-place and moving-to-a-different-list are
 * the same operation with a different `destination`/`index`. */
export function moveProject(projectId: string, destination: MoveDestinationDto, index: number): Promise<void> {
	return invoke("move_project", { projectId, destination, index });
}

/** FR-11: repositions a folder header within the sidebar's top level. */
export function reorderFolder(folderId: string, index: number): Promise<void> {
	return invoke("reorder_folder", { folderId, index });
}

/** FR-11: renames a folder. Returns the name actually saved — a
 * blank/whitespace-only `name` silently reverts server-side to the previous
 * name, so callers should use the returned value rather than assume their
 * own input was applied verbatim. */
export function renameFolder(folderId: string, name: string): Promise<string> {
	return invoke("rename_folder", { folderId, name });
}

export function openTerminal(projectId: string, sessionId: string): Promise<void> {
	return invoke("open_terminal", { projectId, sessionId });
}

export function splitPane(sessionId: string, cwd: string): Promise<void> {
	return invoke("split_pane", { sessionId, cwd });
}

export function writeTerminal(sessionId: string, data: string): Promise<void> {
	return invoke("write_terminal", { sessionId, data });
}

export function resizeTerminal(sessionId: string, rows: number, cols: number): Promise<void> {
	return invoke("resize_terminal", { sessionId, rows, cols });
}

export function closeTerminal(sessionId: string): Promise<void> {
	return invoke("close_terminal", { sessionId });
}

export function exportConfig(destination: string): Promise<void> {
	return invoke("export_config", { destination });
}

export function importConfig(source: string, password: string): Promise<SidebarEntryDto[]> {
	return invoke("import_config", { source, password });
}

/** FR-01 edge case: a project's path may have moved/been deleted since it
 * was added. Read-only check, no side effects. */
export function pathExists(path: string): Promise<boolean> {
	return invoke("path_exists", { path });
}

/** FR-17: `path`'s current git branch (or a detached-HEAD short hash),
 * for display in a pane's title. `null` when `path` isn't inside a git
 * repository — not an error. */
export function getGitBranch(path: string): Promise<string | null> {
	return invoke("get_git_branch", { path });
}

export type SidebarPosition = "left" | "right";

/** design.md §4.1a (v2.5) — app-chrome appearance, distinct from
 * `themePreset` (terminal content colors only, §4.5). "system" is resolved
 * to "dark"/"light" by the frontend via `matchMedia`; the backend only
 * persists the raw preference. */
export type ThemeMode = "dark" | "light" | "system";

export interface SettingsDto {
	themePreset: string;
	keybindings: Record<string, string>;
	sidebarPosition: SidebarPosition;
	/** FR-14 glass intensity, 0..1 (0 = fully opaque). Range is enforced
	 *  backend-side too — see settings_store::validate. */
	glassIntensity: number;
	/** FR-15 window transparency, 0..1 (0 = fully opaque). Separate from
	 *  glassIntensity by design (ADR-0012): glass is panel-over-panel inside
	 *  the app, this is the whole app over the desktop. */
	windowTransparency: number;
	/** design.md §4.1a (v2.5). Defaults to "dark" server-side for settings
	 * files written before this field existed. */
	themeMode: ThemeMode;
}

/** FR-13 — readable/writable without `unlock` (NFR-8/ADR-0009): callable
 * before the master password is ever entered. */
export function getSettings(): Promise<SettingsDto> {
	return invoke("get_settings");
}

export function saveSettings(settings: SettingsDto): Promise<SettingsDto> {
	return invoke("save_settings", { settings });
}

/** FR-13/ADR-0010 — unlike settings above, this requires the store to
 * already be unlocked (it rotates the encryption key itself). */
export function changeMasterPassword(currentPassword: string, newPassword: string): Promise<void> {
	return invoke("change_master_password", { currentPassword, newPassword });
}
