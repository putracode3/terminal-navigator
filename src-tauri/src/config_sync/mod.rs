//! Export/import of the single encrypted data file (ADR-0004, ADR-0008, FR-07).
//! Import is replace-only for MVP: the imported file must decrypt with the
//! current master password before it's allowed to overwrite local data — no
//! merge logic, matching ADR-0008's "the file is the whole state" model.

use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::project_store::ProjectStore;

#[derive(Debug, Error)]
pub enum ConfigSyncError {
    #[error("nothing to export yet — no project data has been saved")]
    NothingToExport,
    #[error("import file not found: {0}")]
    SourceNotFound(PathBuf),
    #[error("import file could not be decrypted with the current master password, or isn't a valid Terminal Navigator data file")]
    InvalidImportFile,
    #[error("failed to read/write file")]
    Io(#[from] std::io::Error),
}

/// Copies the current encrypted data file to `destination` byte-for-byte —
/// the file itself is already the portable/git-trackable artifact (NFR-5),
/// so export needs no separate format.
pub fn export(data_file: &Path, destination: &Path) -> Result<(), ConfigSyncError> {
    if !data_file.exists() {
        return Err(ConfigSyncError::NothingToExport);
    }
    std::fs::copy(data_file, destination)?;
    Ok(())
}

/// Validates that `source` decrypts with `password` (reusing
/// `ProjectStore::unlock`'s own envelope parsing, so this module never
/// duplicates that logic), then replaces `data_file` with it wholesale.
pub fn import(source: &Path, data_file: &Path, password: &str) -> Result<(), ConfigSyncError> {
    if !source.exists() {
        return Err(ConfigSyncError::SourceNotFound(source.to_path_buf()));
    }
    ProjectStore::unlock(source.to_path_buf(), password).map_err(|_| ConfigSyncError::InvalidImportFile)?;
    std::fs::copy(source, data_file)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_store::{ProjectInput, SidebarEntry};
    use tempfile::tempdir;

    #[test]
    fn export_fails_when_nothing_saved_yet() {
        let dir = tempdir().unwrap();
        let result = export(&dir.path().join("no-such-file.enc"), &dir.path().join("out.enc"));
        assert!(matches!(result, Err(ConfigSyncError::NothingToExport)));
    }

    #[test]
    fn export_copies_the_data_file() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        ProjectStore::unlock(data_file.clone(), "pw").unwrap(); // creates an empty store on disk

        let destination = dir.path().join("exported.enc");
        export(&data_file, &destination).unwrap();

        assert_eq!(std::fs::read(&data_file).unwrap(), std::fs::read(&destination).unwrap());
    }

    #[test]
    fn import_fails_when_source_missing() {
        let dir = tempdir().unwrap();
        let result = import(
            &dir.path().join("missing.enc"),
            &dir.path().join("projects.enc"),
            "pw",
        );
        assert!(matches!(result, Err(ConfigSyncError::SourceNotFound(_))));
    }

    #[test]
    fn import_fails_with_wrong_password() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.enc");
        ProjectStore::unlock(source.clone(), "correct-password").unwrap();

        let result = import(&source, &dir.path().join("projects.enc"), "wrong-password");
        assert!(matches!(result, Err(ConfigSyncError::InvalidImportFile)));
    }

    #[test]
    fn import_replaces_local_data_wholesale() {
        let dir = tempdir().unwrap();

        // Device A: has one project, exports it.
        let device_a_file = dir.path().join("device-a.enc");
        let mut store_a = ProjectStore::unlock(device_a_file.clone(), "shared-pw").unwrap();
        store_a
            .add(ProjectInput {
                name: "from-device-a".into(),
                path: dir.path().to_path_buf(),
                setup_commands: vec![],
                notes: String::new(),
            })
            .unwrap();
        let exported = dir.path().join("exported.enc");
        export(&device_a_file, &exported).unwrap();

        // Device B: starts with a different project, then imports device A's file.
        let device_b_file = dir.path().join("device-b.enc");
        let mut store_b = ProjectStore::unlock(device_b_file.clone(), "shared-pw").unwrap();
        store_b
            .add(ProjectInput {
                name: "from-device-b".into(),
                path: dir.path().to_path_buf(),
                setup_commands: vec![],
                notes: String::new(),
            })
            .unwrap();

        import(&exported, &device_b_file, "shared-pw").unwrap();

        let reopened = ProjectStore::unlock(device_b_file, "shared-pw").unwrap();
        let names: Vec<&str> = reopened
            .entries()
            .iter()
            .filter_map(|e| match e {
                SidebarEntry::Project(p) => Some(p.name.as_str()),
                SidebarEntry::Folder(_) => None,
            })
            .collect();
        assert_eq!(names, vec!["from-device-a"], "import must replace, not merge (ADR-0008)");
    }
}
