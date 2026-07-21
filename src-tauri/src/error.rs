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
    pub fn locked() -> Self {
        Self {
            kind: "locked",
            message: "The store is locked. Call unlock first.".to_string(),
        }
    }
}

impl From<ProjectStoreError> for AppError {
    fn from(err: ProjectStoreError) -> Self {
        let kind = match &err {
            ProjectStoreError::EmptyName
            | ProjectStoreError::PathNotFound(_)
            | ProjectStoreError::EmptyPassword
            | ProjectStoreError::SelfMerge => "invalid_input",
            ProjectStoreError::NotFound(_) => "not_found",
            ProjectStoreError::Crypto(_) => "crypto",
            ProjectStoreError::Io(_) => "io",
            ProjectStoreError::Corrupted => "corrupted",
            ProjectStoreError::WrongPassword => "wrong_password",
        };
        Self { kind, message: err.to_string() }
    }
}

impl From<SettingsStoreError> for AppError {
    fn from(err: SettingsStoreError) -> Self {
        let kind = match &err {
            SettingsStoreError::DuplicateKeybinding(_) => "invalid_input",
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
