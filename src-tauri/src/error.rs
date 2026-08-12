//! Single error contract for the Tauri IPC layer — every command returns
//! `Result<T, AppError>` so the frontend always parses one shape, never a
//! bare string it has to pattern-match by content.

use serde::Serialize;

use crate::config_sync::ConfigSyncError;
use crate::project_store::ProjectStoreError;
use crate::pty_manager::PtyError;
use crate::settings_store::SettingsStoreError;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub kind: &'static str,
    pub message: String,
}

impl AppError {
    /// Not a security gate (ADR-0014 removed the lock/unlock state machine
    /// entirely) — just defensive null-safety against a command being
    /// called before `init_store`/`migrate_and_load` has populated
    /// `AppState.store` on startup, which should only ever be a brief
    /// ordering race, never a deliberate "keep this shut" boundary.
    pub fn not_ready() -> Self {
        Self {
            kind: "not_ready",
            message: "The project store hasn't finished loading yet. Call init_store first.".to_string(),
        }
    }
}

impl From<ProjectStoreError> for AppError {
    fn from(err: ProjectStoreError) -> Self {
        let kind = match &err {
            ProjectStoreError::EmptyName
            | ProjectStoreError::PathNotFound(_)
            | ProjectStoreError::SelfMerge => "invalid_input",
            ProjectStoreError::NotFound(_) => "not_found",
            ProjectStoreError::Crypto(_) => "crypto",
            ProjectStoreError::Io(_) => "io",
            ProjectStoreError::Corrupted => "corrupted",
            ProjectStoreError::WrongPassword => "wrong_password",
            ProjectStoreError::NeedsMigration => "needs_migration",
        };
        Self { kind, message: err.to_string() }
    }
}

impl From<SettingsStoreError> for AppError {
    fn from(err: SettingsStoreError) -> Self {
        let kind = match &err {
            SettingsStoreError::DuplicateKeybinding(_) => "invalid_input",
            SettingsStoreError::GlassIntensityOutOfRange(_) => "invalid_input",
            SettingsStoreError::WindowTransparencyOutOfRange(_) => "invalid_input",
            SettingsStoreError::Io(_) => "io",
            SettingsStoreError::Corrupted => "corrupted",
        };
        Self { kind, message: err.to_string() }
    }
}

impl From<PtyError> for AppError {
    fn from(err: PtyError) -> Self {
        let kind = match &err {
            PtyError::SessionNotFound => "not_found",
            _ => "pty",
        };
        Self { kind, message: err.to_string() }
    }
}

impl From<ConfigSyncError> for AppError {
    fn from(err: ConfigSyncError) -> Self {
        let kind = match &err {
            ConfigSyncError::SourceNotFound(_) => "not_found",
            ConfigSyncError::NothingToExport | ConfigSyncError::InvalidImportFile => "invalid_input",
            ConfigSyncError::Io(_) => "io",
        };
        Self { kind, message: err.to_string() }
    }
}
