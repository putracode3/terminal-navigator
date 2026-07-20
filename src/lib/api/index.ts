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

export function unlock(password: string): Promise<ProjectDto[]> {
	return invoke("unlock", { password });
}

export function listProjects(): Promise<ProjectDto[]> {
	return invoke("list_projects");
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

export function importConfig(source: string, password: string): Promise<ProjectDto[]> {
	return invoke("import_config", { source, password });
}

/** FR-01 edge case: a project's path may have moved/been deleted since it
 * was added. Read-only check, no side effects. */
export function pathExists(path: string): Promise<boolean> {
	return invoke("path_exists", { path });
}

export type SidebarPosition = "left" | "right";

export interface SettingsDto {
	themePreset: string;
	keybindings: Record<string, string>;
	sidebarPosition: SidebarPosition;
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
