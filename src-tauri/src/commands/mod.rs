//! Tauri IPC entry points. Thin by design (architecture.md §10, rule 2):
//! each command only shapes DTOs and delegates to `project_store` — no
//! business logic lives here.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::config_sync;
use crate::error::AppError;
use crate::project_store::{Folder, MoveDestination, Project, ProjectInput, ProjectStore, SidebarEntry};
use crate::pty_manager::PtyManager;
use crate::settings_store::{self, Settings, SidebarPosition};

/// Shared app state: `None` while locked, `Some(store)` once unlocked with the
/// master password. `data_file` is resolved once at startup (see lib.rs).
/// `pty_manager` needs no lock/unlock state — terminal sessions are runtime-only
/// (architecture.md §5.3) and independent of whether the project store is open.
/// `settings_file` is deliberately outside `store`'s lock/unlock lifecycle
/// (ADR-0009/NFR-8) — settings commands never check `store`.
pub struct AppState {
    pub store: Mutex<Option<ProjectStore>>,
    pub data_file: PathBuf,
    pub settings_file: PathBuf,
    pub pty_manager: PtyManager,
}

fn parse_uuid(raw: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(raw).map_err(|_| AppError { kind: "invalid_input", message: "Invalid id".to_string() })
}

/// Every pane's PTY output is emitted on its own event name, so the frontend's
/// `terminal_view` for that pane only ever hears its own session (architecture.md §5.6).
fn output_event_name(session_id: Uuid) -> String {
    format!("pty://output/{session_id}")
}

/// Fired once, with no payload, when the shell's end of the pty closes on its
/// own (the user typed `exit`, the shell crashed, etc.) — the frontend reacts
/// exactly as it would to the user clicking a pane's own "Close pane" button,
/// since `pty_manager` never removes the session or kills the (already-dead)
/// child by itself (see `PtyManager::spawn`'s doc comment).
fn exit_event_name(session_id: Uuid) -> String {
    format!("pty://exit/{session_id}")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub setup_commands: Vec<String>,
    pub notes: String,
}

impl From<&Project> for ProjectDto {
    fn from(p: &Project) -> Self {
        Self {
            id: p.id.to_string(),
            name: p.name.clone(),
            path: p.path.to_string_lossy().to_string(),
            setup_commands: p.setup_commands.clone(),
            notes: p.notes.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInputDto {
    pub name: String,
    pub path: String,
    pub setup_commands: Vec<String>,
    pub notes: String,
}

impl From<ProjectInputDto> for ProjectInput {
    fn from(dto: ProjectInputDto) -> Self {
        Self {
            name: dto.name,
            path: PathBuf::from(dto.path),
            setup_commands: dto.setup_commands,
            notes: dto.notes,
        }
    }
}

/// FR-11 (ADR-0011): a folder's ordered members, DTO-shaped the same way
/// `ProjectDto` already is (never serialize domain structs directly across
/// the IPC boundary — see `ProjectDto`'s own precedent).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDto {
    pub id: String,
    pub name: String,
    pub members: Vec<ProjectDto>,
}

impl From<&Folder> for FolderDto {
    fn from(f: &Folder) -> Self {
        Self {
            id: f.id.to_string(),
            name: f.name.clone(),
            members: f.members.iter().map(ProjectDto::from).collect(),
        }
    }
}

/// FR-11: the sidebar's top-level tree, replacing the pre-FR-11 flat
/// `Vec<ProjectDto>` — internally tagged so the frontend can discriminate
/// `{"type": "project", ...}` from `{"type": "folder", ...}` without a
/// separate wrapper shape.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SidebarEntryDto {
    Project(ProjectDto),
    Folder(FolderDto),
}

impl From<&SidebarEntry> for SidebarEntryDto {
    fn from(entry: &SidebarEntry) -> Self {
        match entry {
            SidebarEntry::Project(p) => SidebarEntryDto::Project(p.into()),
            SidebarEntry::Folder(f) => SidebarEntryDto::Folder(f.into()),
        }
    }
}

/// FR-11: where `move_project` sends a project — mirrors
/// `project_store::MoveDestination`, translated from a raw `folderId` string
/// (fallible — must be parsed) rather than deriving `Deserialize` on the
/// domain type directly, same reasoning as every other *Dto in this file.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MoveDestinationDto {
    TopLevel,
    Folder { folder_id: String },
}

/// FR-13 — the non-sensitive preferences DTO. Same shape as `Settings`
/// (settings_store has no internal fields to hide), kept as a distinct DTO
/// anyway to match this project's existing convention of never serializing
/// domain structs directly across the IPC boundary.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub theme_preset: String,
    pub keybindings: std::collections::HashMap<String, String>,
    pub sidebar_position: SidebarPosition,
    /// FR-14 — see `settings_store::Settings::glass_intensity`. `default`
    /// here too, so a frontend that predates this field still round-trips.
    #[serde(default)]
    pub glass_intensity: f32,
}

impl From<Settings> for SettingsDto {
    fn from(s: Settings) -> Self {
        Self {
            theme_preset: s.theme_preset,
            keybindings: s.keybindings,
            sidebar_position: s.sidebar_position,
            glass_intensity: s.glass_intensity,
        }
    }
}

impl From<SettingsDto> for Settings {
    fn from(dto: SettingsDto) -> Self {
        Self {
            theme_preset: dto.theme_preset,
            keybindings: dto.keybindings,
            sidebar_position: dto.sidebar_position,
            glass_intensity: dto.glass_intensity,
        }
    }
}

#[tauri::command]
pub fn unlock(password: String, state: State<AppState>) -> Result<Vec<SidebarEntryDto>, AppError> {
    let store = ProjectStore::unlock(state.data_file.clone(), &password)?;
    let entries = store.entries().iter().map(SidebarEntryDto::from).collect();
    *state.store.lock().unwrap() = Some(store);
    Ok(entries)
}

/// FR-11: renamed from `list_projects` — the sidebar tree now includes
/// folders, not just a flat project list, so `list_projects` would
/// undersell what this returns.
#[tauri::command]
pub fn list_sidebar_entries(state: State<AppState>) -> Result<Vec<SidebarEntryDto>, AppError> {
    let guard = state.store.lock().unwrap();
    let store = guard.as_ref().ok_or_else(AppError::locked)?;
    Ok(store.entries().iter().map(SidebarEntryDto::from).collect())
}

#[tauri::command]
pub fn add_project(input: ProjectInputDto, state: State<AppState>) -> Result<ProjectDto, AppError> {
    let mut guard = state.store.lock().unwrap();
    let store = guard.as_mut().ok_or_else(AppError::locked)?;
    let project = store.add(input.into())?;
    Ok((&project).into())
}

#[tauri::command]
pub fn update_project(
    id: String,
    input: ProjectInputDto,
    state: State<AppState>,
) -> Result<ProjectDto, AppError> {
    let id = parse_uuid(&id)?;
    let mut guard = state.store.lock().unwrap();
    let store = guard.as_mut().ok_or_else(AppError::locked)?;
    let project = store.update(id, input.into())?;
    Ok((&project).into())
}

#[tauri::command]
pub fn delete_project(id: String, state: State<AppState>) -> Result<(), AppError> {
    let id = parse_uuid(&id)?;
    let mut guard = state.store.lock().unwrap();
    let store = guard.as_mut().ok_or_else(AppError::locked)?;
    store.delete(id)?;
    Ok(())
}

/// FR-11 "drop onto a row's merge band": creates a new folder or joins an
/// existing one, per `ProjectStore::merge_or_join`'s own doc comment for
/// exactly which case applies. Returns the resulting folder so the frontend
/// can render/auto-expand it without a separate round trip.
#[tauri::command]
pub fn merge_projects(
    dragged_id: String,
    target_id: String,
    state: State<AppState>,
) -> Result<FolderDto, AppError> {
    let dragged_id = parse_uuid(&dragged_id)?;
    let target_id = parse_uuid(&target_id)?;
    let mut guard = state.store.lock().unwrap();
    let store = guard.as_mut().ok_or_else(AppError::locked)?;
    let folder_id = store.merge_or_join(dragged_id, target_id)?;
    let folder = store
        .entries()
        .iter()
        .find_map(|e| match e {
            SidebarEntry::Folder(f) if f.id == folder_id => Some(f),
            _ => None,
        })
        .expect("merge_or_join returns the id of a folder it just created or joined");
    Ok(folder.into())
}

/// FR-11 "drop onto a reorder band, or move between folders/top level":
/// relocates a project to `destination` at `index` — see
/// `ProjectStore::move_project`'s own doc comment.
#[tauri::command]
pub fn move_project(
    project_id: String,
    destination: MoveDestinationDto,
    index: usize,
    state: State<AppState>,
) -> Result<(), AppError> {
    let project_id = parse_uuid(&project_id)?;
    let destination = match destination {
        MoveDestinationDto::TopLevel => MoveDestination::TopLevel,
        MoveDestinationDto::Folder { folder_id } => MoveDestination::Folder(parse_uuid(&folder_id)?),
    };
    let mut guard = state.store.lock().unwrap();
    let store = guard.as_mut().ok_or_else(AppError::locked)?;
    store.move_project(project_id, destination, index)?;
    Ok(())
}

/// FR-11: repositions a folder header within the sidebar's top level.
#[tauri::command]
pub fn reorder_folder(folder_id: String, index: usize, state: State<AppState>) -> Result<(), AppError> {
    let folder_id = parse_uuid(&folder_id)?;
    let mut guard = state.store.lock().unwrap();
    let store = guard.as_mut().ok_or_else(AppError::locked)?;
    store.reorder_folder(folder_id, index)?;
    Ok(())
}

/// FR-11: renames a folder. Returns the name actually saved — a
/// blank/whitespace-only `name` silently reverts to the previous name
/// (`ProjectStore::rename_folder`'s own doc comment), so the frontend can
/// tell that happened instead of assuming its own input was applied verbatim.
#[tauri::command]
pub fn rename_folder(folder_id: String, name: String, state: State<AppState>) -> Result<String, AppError> {
    let folder_id = parse_uuid(&folder_id)?;
    let mut guard = state.store.lock().unwrap();
    let store = guard.as_mut().ok_or_else(AppError::locked)?;
    Ok(store.rename_folder(folder_id, name)?)
}

/// Opens a new terminal pane at `project_id`'s path and runs its setup
/// commands (FR-03, FR-04). `session_id` is generated by the frontend when
/// the pane is created (ADR-0007) — one pane maps 1:1 to one PTY session.
#[tauri::command]
pub fn open_terminal(
    app: AppHandle,
    project_id: String,
    session_id: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let project_id = parse_uuid(&project_id)?;
    let session_id = parse_uuid(&session_id)?;

    let guard = state.store.lock().unwrap();
    let store = guard.as_ref().ok_or_else(AppError::locked)?;
    let project = store
        .find_project(project_id)
        .ok_or_else(|| AppError { kind: "not_found", message: "Project not found".to_string() })?;

    let event_name = output_event_name(session_id);
    let exit_event_name = exit_event_name(session_id);
    let exit_app = app.clone();
    state
        .pty_manager
        .spawn_for_project(
            session_id,
            project,
            move |chunk| {
                let _ = app.emit(&event_name, chunk);
            },
            move || {
                let _ = exit_app.emit(&exit_event_name, ());
            },
        )?;
    Ok(())
}

/// Splits a new pane at `cwd`, with no project/setup-commands attached — a
/// plain shell at the same working directory (components.md, Split Pane Container).
#[tauri::command]
pub fn split_pane(
    app: AppHandle,
    session_id: String,
    cwd: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    // Security audit 2026-07-20, M1: this command doesn't otherwise touch
    // `state.store` (it needs no project data), so without this check it
    // was the one command that could spawn a real shell before the app was
    // ever unlocked — every other stateful command already gates on this.
    state.store.lock().unwrap().as_ref().ok_or_else(AppError::locked)?;
    let session_id = parse_uuid(&session_id)?;
    let event_name = output_event_name(session_id);
    let exit_event_name = exit_event_name(session_id);
    let exit_app = app.clone();
    state.pty_manager.spawn(
        session_id,
        std::path::Path::new(&cwd),
        move |chunk| {
            let _ = app.emit(&event_name, chunk);
        },
        move || {
            let _ = exit_app.emit(&exit_event_name, ());
        },
    )?;
    Ok(())
}

#[tauri::command]
pub fn write_terminal(session_id: String, data: String, state: State<AppState>) -> Result<(), AppError> {
    let session_id = parse_uuid(&session_id)?;
    state.pty_manager.write(session_id, &data)?;
    Ok(())
}

#[tauri::command]
pub fn resize_terminal(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<AppState>,
) -> Result<(), AppError> {
    let session_id = parse_uuid(&session_id)?;
    state.pty_manager.resize(session_id, rows, cols)?;
    Ok(())
}

/// Closes exactly one pane's session — never affects any other pane (ADR-0007).
#[tauri::command]
pub fn close_terminal(session_id: String, state: State<AppState>) -> Result<(), AppError> {
    let session_id = parse_uuid(&session_id)?;
    state.pty_manager.close(session_id)?;
    Ok(())
}

/// Copies the current encrypted data file to `destination` (FR-07).
#[tauri::command]
pub fn export_config(destination: String, state: State<AppState>) -> Result<(), AppError> {
    config_sync::export(&state.data_file, &PathBuf::from(destination))?;
    Ok(())
}

/// Checks whether `path` still exists on disk (FR-01 edge case: a project's
/// folder may have moved/been deleted since it was added). Read-only,
/// side-effect-free — deliberately the smallest possible surface for this
/// check rather than exposing broader filesystem access to the frontend.
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Imports `source`, replacing all local project data (ADR-0008 — replace,
/// not merge). Re-unlocks from the new file afterward so the in-memory list
/// reflects the import immediately, without requiring an app restart.
#[tauri::command]
pub fn import_config(
    source: String,
    password: String,
    state: State<AppState>,
) -> Result<Vec<SidebarEntryDto>, AppError> {
    config_sync::import(&PathBuf::from(source), &state.data_file, &password)?;
    let store = ProjectStore::unlock(state.data_file.clone(), &password)?;
    let entries = store.entries().iter().map(SidebarEntryDto::from).collect();
    *state.store.lock().unwrap() = Some(store);
    Ok(entries)
}

/// Reads current settings (FR-13). Deliberately does **not** check
/// `state.store` — settings must be readable before `unlock` is ever called
/// (NFR-8), unlike every project-data command above.
#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<SettingsDto, AppError> {
    let settings = settings_store::load(&state.settings_file)?;
    Ok(settings.into())
}

/// Saves settings wholesale (FR-13) — same whole-object style as
/// `update_project`, not per-field patches. Validates keybinding conflicts
/// (settings_store::save) before writing. No unlock check, same reasoning
/// as `get_settings`.
#[tauri::command]
pub fn save_settings(settings: SettingsDto, state: State<AppState>) -> Result<SettingsDto, AppError> {
    let settings: Settings = settings.into();
    settings_store::save(&state.settings_file, &settings)?;
    Ok(settings.into())
}

/// Rotates the master password (FR-13, ADR-0010). Unlike settings commands,
/// this requires the store to already be unlocked — it operates on the
/// live `ProjectStore`, not a file path, since rotation needs the
/// currently-held key/salt in memory (project_store::change_password).
#[tauri::command]
pub fn change_master_password(
    current_password: String,
    new_password: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let mut guard = state.store.lock().unwrap();
    let store = guard.as_mut().ok_or_else(AppError::locked)?;
    store.change_password(&current_password, &new_password)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn path_exists_true_for_a_real_directory() {
        let dir = tempdir().unwrap();
        assert!(path_exists(dir.path().to_string_lossy().to_string()));
    }

    #[test]
    fn path_exists_false_for_a_missing_path() {
        assert!(!path_exists("/definitely/does/not/exist/xyz".to_string()));
    }
}
