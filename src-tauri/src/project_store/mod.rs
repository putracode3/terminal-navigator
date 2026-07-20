//! CRUD + encrypted persistence for the project list (ADR-0004, FR-01, FR-02, FR-06).
//! Sole owner of the `Project` entity (architecture.md §5.1) — no other module
//! reads or writes project data directly.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use thiserror::Error;
use uuid::Uuid;

use crate::crypto::{self, CryptoError, KEY_LEN, NONCE_LEN, SALT_LEN};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub path: PathBuf,
    pub setup_commands: Vec<String>,
    pub notes: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Fields a caller supplies to create or update a project. Deliberately excludes
/// id/timestamps — those are always assigned by the store, never by a caller.
#[derive(Debug, Clone)]
pub struct ProjectInput {
    pub name: String,
    pub path: PathBuf,
    pub setup_commands: Vec<String>,
    pub notes: String,
}

#[derive(Debug, Error)]
pub enum ProjectStoreError {
    #[error("project name cannot be empty")]
    EmptyName,
    #[error("path does not exist: {0}")]
    PathNotFound(PathBuf),
    #[error("project not found")]
    NotFound(Uuid),
    #[error(transparent)]
    Crypto(#[from] CryptoError),
    #[error("failed to read/write data file")]
    Io(#[from] std::io::Error),
    #[error("data file is corrupted or in an unrecognized format")]
    Corrupted,
    #[error("current password is incorrect")]
    WrongPassword,
    #[error("new password cannot be empty")]
    EmptyPassword,
}

pub struct ProjectStore {
    projects: Vec<Project>,
    data_file: PathBuf,
    key: [u8; KEY_LEN],
    salt: [u8; SALT_LEN],
}

impl ProjectStore {
    /// Unlocks the store at `data_file` using `password`. If `data_file` doesn't
    /// exist yet, initializes a fresh empty store there instead (first run).
    pub fn unlock(data_file: PathBuf, password: &str) -> Result<Self, ProjectStoreError> {
        if data_file.exists() {
            let raw = std::fs::read(&data_file)?;
            let envelope = split_envelope(&raw)?;
            let key = crypto::derive_key(password, &envelope.salt)?;
            let plaintext = crypto::decrypt(&key, &envelope.nonce, &envelope.ciphertext)?;
            let projects: Vec<Project> =
                bincode::deserialize(&plaintext).map_err(|_| ProjectStoreError::Corrupted)?;
            Ok(Self { projects, data_file, key, salt: envelope.salt })
        } else {
            let salt = crypto::generate_salt();
            let key = crypto::derive_key(password, &salt)?;
            let store = Self { projects: Vec::new(), data_file, key, salt };
            store.persist()?;
            Ok(store)
        }
    }

    pub fn list(&self) -> &[Project] {
        &self.projects
    }

    pub fn add(&mut self, input: ProjectInput) -> Result<Project, ProjectStoreError> {
        validate_input(&input)?;
        let now = Utc::now();
        let project = Project {
            id: Uuid::new_v4(),
            name: input.name,
            path: input.path,
            setup_commands: input.setup_commands,
            notes: input.notes,
            created_at: now,
            updated_at: now,
        };
        self.projects.push(project.clone());
        self.persist()?;
        Ok(project)
    }

    pub fn update(&mut self, id: Uuid, input: ProjectInput) -> Result<Project, ProjectStoreError> {
        validate_input(&input)?;
        let project = self
            .projects
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or(ProjectStoreError::NotFound(id))?;
        project.name = input.name;
        project.path = input.path;
        project.setup_commands = input.setup_commands;
        project.notes = input.notes;
        project.updated_at = Utc::now();
        let updated = project.clone();
        self.persist()?;
        Ok(updated)
    }

    pub fn delete(&mut self, id: Uuid) -> Result<(), ProjectStoreError> {
        let idx = self
            .projects
            .iter()
            .position(|p| p.id == id)
            .ok_or(ProjectStoreError::NotFound(id))?;
        self.projects.remove(idx);
        self.persist()?;
        Ok(())
    }

    /// Rotates the master password (FR-13, ADR-0010): verifies
    /// `current_password` against the store's own derived key (constant-time
    /// comparison — this is real key material, not a plain string), then
    /// re-derives a fresh key/salt from `new_password` and re-persists.
    /// `persist()`'s atomic write means a crash mid-rotation leaves either
    /// the old file or the new file intact, never a partially-written one.
    /// If the write itself fails, the in-memory key/salt are rolled back so
    /// memory and disk never disagree about which password is current.
    pub fn change_password(
        &mut self,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), ProjectStoreError> {
        if new_password.is_empty() {
            return Err(ProjectStoreError::EmptyPassword);
        }

        let candidate_key = crypto::derive_key(current_password, &self.salt)?;
        if candidate_key.ct_eq(&self.key).unwrap_u8() == 0 {
            return Err(ProjectStoreError::WrongPassword);
        }

        // Derive the new salt/key into locals first — only assign to `self`
        // once both have succeeded, so the sole failure window needing a
        // rollback below is `persist()` itself. Mutating `self.salt` before
        // `derive_key` was known to succeed would leave a mismatched
        // salt/key pair in memory with no rollback path if that derivation
        // ever failed (code review finding M1).
        let new_salt = crypto::generate_salt();
        let new_key = crypto::derive_key(new_password, &new_salt)?;

        let previous_key = self.key;
        let previous_salt = self.salt;

        self.key = new_key;
        self.salt = new_salt;

        if let Err(err) = self.persist() {
            self.key = previous_key;
            self.salt = previous_salt;
            return Err(err);
        }
        Ok(())
    }

    /// Writes the current envelope to disk. Atomic (temp file + rename in
    /// the same directory, ADR-0010): a crash mid-write leaves either the
    /// previous file or the fully-written new one, never a truncated/corrupt
    /// one. This protects every caller — `add`/`update`/`delete` and
    /// `change_password` alike — not just password rotation specifically.
    fn persist(&self) -> Result<(), ProjectStoreError> {
        let plaintext = bincode::serialize(&self.projects).map_err(|_| ProjectStoreError::Corrupted)?;
        let (nonce, ciphertext) = crypto::encrypt(&self.key, &plaintext)?;
        let envelope = build_envelope(&self.salt, &nonce, &ciphertext);

        let dir = self.data_file.parent().unwrap_or_else(|| Path::new("."));
        let file_name = self.data_file.file_name().and_then(|n| n.to_str()).unwrap_or("projects.enc");
        let tmp_path = dir.join(format!(".{file_name}.tmp"));

        std::fs::write(&tmp_path, &envelope)?;
        // Security audit 2026-07-20, M3: restrict the encrypted data file to
        // owner-only — otherwise it's written with the OS default/umask
        // permissions (typically world-readable), letting any other local
        // user copy the ciphertext out for unlimited offline password
        // cracking, unconstrained by this app's own protections. Set on the
        // temp file before the rename — permissions carry through a rename
        // on the same filesystem.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(&tmp_path, &self.data_file)?;
        Ok(())
    }
}

/// Domain validation (PRD FR-01/FR-02): name must be non-empty, path must exist
/// on disk at the time of add/edit.
fn validate_input(input: &ProjectInput) -> Result<(), ProjectStoreError> {
    if input.name.trim().is_empty() {
        return Err(ProjectStoreError::EmptyName);
    }
    if !input.path.exists() {
        return Err(ProjectStoreError::PathNotFound(input.path.clone()));
    }
    Ok(())
}

/// On-disk layout: [salt (16 bytes)][nonce (12 bytes)][AES-GCM ciphertext].
fn build_envelope(salt: &[u8; SALT_LEN], nonce: &[u8], ciphertext: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(SALT_LEN + nonce.len() + ciphertext.len());
    out.extend_from_slice(salt);
    out.extend_from_slice(nonce);
    out.extend_from_slice(ciphertext);
    out
}

struct EnvelopeParts {
    salt: [u8; SALT_LEN],
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

fn split_envelope(raw: &[u8]) -> Result<EnvelopeParts, ProjectStoreError> {
    if raw.len() < SALT_LEN + NONCE_LEN {
        return Err(ProjectStoreError::Corrupted);
    }
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&raw[..SALT_LEN]);
    let nonce = raw[SALT_LEN..SALT_LEN + NONCE_LEN].to_vec();
    let ciphertext = raw[SALT_LEN + NONCE_LEN..].to_vec();
    Ok(EnvelopeParts { salt, nonce, ciphertext })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn input(name: &str, path: PathBuf) -> ProjectInput {
        ProjectInput {
            name: name.to_string(),
            path,
            setup_commands: vec![],
            notes: String::new(),
        }
    }

    #[test]
    fn unlock_creates_empty_store_when_no_file_exists() {
        let dir = tempdir().unwrap();
        let store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        assert!(store.list().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn data_file_is_restricted_to_owner_only() {
        // Regression test, security audit 2026-07-20 (M3): the encrypted
        // data file must not be left at the OS-default/umask permissions
        // (typically world-readable) — anyone else with local access could
        // otherwise copy the ciphertext out for unlimited offline cracking.
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        ProjectStore::unlock(data_file.clone(), "pw").unwrap();

        let mode = std::fs::metadata(&data_file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "data file must be owner-read/write only, got {mode:o}");
    }

    #[test]
    fn add_rejects_nonexistent_path() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let result = store.add(input("test", PathBuf::from("/definitely/does/not/exist/xyz")));
        assert!(matches!(result, Err(ProjectStoreError::PathNotFound(_))));
    }

    #[test]
    fn add_rejects_empty_name() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let result = store.add(input("   ", dir.path().to_path_buf()));
        assert!(matches!(result, Err(ProjectStoreError::EmptyName)));
    }

    #[test]
    fn add_then_list_returns_the_project() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let created = store.add(input("my-project", dir.path().to_path_buf())).unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].id, created.id);
    }

    #[test]
    fn update_modifies_existing_project() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let created = store.add(input("old-name", dir.path().to_path_buf())).unwrap();

        let mut updated_input = input("new-name", dir.path().to_path_buf());
        updated_input.notes = "updated".into();
        let updated = store.update(created.id, updated_input).unwrap();

        assert_eq!(updated.name, "new-name");
        assert_eq!(updated.notes, "updated");
        assert_eq!(store.list().len(), 1, "update must not create a duplicate entry");
    }

    #[test]
    fn update_unknown_id_fails() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let result = store.update(Uuid::new_v4(), input("x", dir.path().to_path_buf()));
        assert!(matches!(result, Err(ProjectStoreError::NotFound(_))));
    }

    #[test]
    fn delete_removes_project() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let created = store.add(input("to-delete", dir.path().to_path_buf())).unwrap();
        store.delete(created.id).unwrap();
        assert!(store.list().is_empty());
    }

    #[test]
    fn delete_unknown_id_fails() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let result = store.delete(Uuid::new_v4());
        assert!(matches!(result, Err(ProjectStoreError::NotFound(_))));
    }

    #[test]
    fn data_persists_across_unlock_calls() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");

        {
            let mut store = ProjectStore::unlock(data_file.clone(), "pw").unwrap();
            let mut proj_input = input("persisted", dir.path().to_path_buf());
            proj_input.notes = "secret note".into();
            store.add(proj_input).unwrap();
        }

        let reopened = ProjectStore::unlock(data_file, "pw").unwrap();
        assert_eq!(reopened.list().len(), 1);
        assert_eq!(reopened.list()[0].name, "persisted");
        assert_eq!(reopened.list()[0].notes, "secret note");
    }

    #[test]
    fn wrong_password_fails_to_unlock_existing_store() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");

        {
            let mut store = ProjectStore::unlock(data_file.clone(), "correct-password").unwrap();
            store.add(input("p", dir.path().to_path_buf())).unwrap();
        }

        let result = ProjectStore::unlock(data_file, "wrong-password");
        assert!(result.is_err());
    }

    #[test]
    fn data_file_on_disk_is_not_plaintext() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        let mut store = ProjectStore::unlock(data_file.clone(), "pw").unwrap();
        let mut proj_input = input("super-secret-project", dir.path().to_path_buf());
        proj_input.notes = "API_KEY=abc123".into();
        store.add(proj_input).unwrap();

        let raw = std::fs::read(&data_file).unwrap();
        let raw_str = String::from_utf8_lossy(&raw);
        assert!(!raw_str.contains("super-secret-project"));
        assert!(!raw_str.contains("API_KEY"));
    }

    #[test]
    fn change_password_allows_unlock_with_new_password_afterward() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");

        {
            let mut store = ProjectStore::unlock(data_file.clone(), "old-password").unwrap();
            store.add(input("p", dir.path().to_path_buf())).unwrap();
            store.change_password("old-password", "new-password").unwrap();
        }

        let reopened = ProjectStore::unlock(data_file, "new-password").unwrap();
        assert_eq!(reopened.list().len(), 1, "data must survive rotation intact");
        assert_eq!(reopened.list()[0].name, "p");
    }

    #[test]
    fn change_password_rejects_old_password_after_rotation() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");

        {
            let mut store = ProjectStore::unlock(data_file.clone(), "old-password").unwrap();
            store.change_password("old-password", "new-password").unwrap();
        }

        let result = ProjectStore::unlock(data_file, "old-password");
        assert!(result.is_err(), "old password must stop working after rotation");
    }

    #[test]
    fn change_password_rejects_wrong_current_password_without_mutating_data() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        let mut store = ProjectStore::unlock(data_file.clone(), "correct-password").unwrap();
        store.add(input("p", dir.path().to_path_buf())).unwrap();
        let before = std::fs::read(&data_file).unwrap();

        let result = store.change_password("wrong-current-password", "new-password");

        assert!(matches!(result, Err(ProjectStoreError::WrongPassword)));
        let after = std::fs::read(&data_file).unwrap();
        assert_eq!(before, after, "a rejected rotation must not touch the on-disk file");

        // The store must still unlock with the original password — an
        // in-memory-only rejection, nothing was rotated.
        let reopened = ProjectStore::unlock(data_file, "correct-password").unwrap();
        assert_eq!(reopened.list().len(), 1);
    }

    #[test]
    fn change_password_rejects_empty_new_password() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let result = store.change_password("pw", "");
        assert!(matches!(result, Err(ProjectStoreError::EmptyPassword)));
    }

    #[test]
    fn persist_leaves_no_leftover_temp_file() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        let mut store = ProjectStore::unlock(data_file.clone(), "pw").unwrap();
        store.add(input("p", dir.path().to_path_buf())).unwrap();

        assert!(!dir.path().join(".projects.enc.tmp").exists());
    }
}
