//! CRUD + encrypted persistence for the project list (ADR-0004, FR-01, FR-02, FR-06)
//! and, since FR-11 (ADR-0011), user-organized drag-and-drop Folders grouping
//! projects in the sidebar. Sole owner of the `Project` and `Folder` entities
//! (architecture.md §5.1) — no other module reads or writes project/folder
//! data directly.

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

/// FR-11/ADR-0011: a flat (non-nesting) category of projects, user-created and
/// managed entirely by drag-and-drop. `members`'s own order *is* the display
/// position within the folder — there is no separate position field. Flat-only
/// nesting is enforced by the type system: this holds `Vec<Project>`, never
/// `Vec<SidebarEntry>`, so a `Folder` cannot contain another `Folder`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: Uuid,
    pub name: String,
    pub members: Vec<Project>,
}

/// The persisted sidebar tree's root shape (ADR-0011): an ordered list of
/// top-level entries, each either a standalone `Project` or a `Folder` owning
/// its own ordered members. This `Vec`'s own order is top-level display
/// position, the same way `Folder::members`'s order is position within it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SidebarEntry {
    Project(Project),
    Folder(Folder),
}

/// Where `move_project` relocates a project to. Deliberately cannot express
/// "into another folder's folder" — folders only ever nest inside the
/// top-level `Vec<SidebarEntry>`, never inside `Folder::members`, so there is
/// no variant here that could violate flat-only nesting.
#[derive(Debug, Clone, Copy)]
pub enum MoveDestination {
    TopLevel,
    Folder(Uuid),
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
    #[error("cannot merge or move an entry with/into itself")]
    SelfMerge,
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
    entries: Vec<SidebarEntry>,
    data_file: PathBuf,
    key: [u8; KEY_LEN],
    salt: [u8; SALT_LEN],
}

impl ProjectStore {
    /// Unlocks the store at `data_file` using `password`. If `data_file` doesn't
    /// exist yet, initializes a fresh empty store there instead (first run).
    /// A pre-FR-11 legacy-format file is migrated and immediately re-persisted
    /// in the new marked format right here (ADR-0011) — not deferred until
    /// some future mutating call, since a purely read-only session (unlock,
    /// look at the list, quit) would otherwise never actually upgrade the
    /// file on disk.
    pub fn unlock(data_file: PathBuf, password: &str) -> Result<Self, ProjectStoreError> {
        if data_file.exists() {
            let raw = std::fs::read(&data_file)?;
            let envelope = split_envelope(&raw)?;
            let key = crypto::derive_key(password, &envelope.salt)?;
            let plaintext = crypto::decrypt(&key, &envelope.nonce, &envelope.ciphertext)?;
            let (entries, was_legacy_format) = decode_plaintext(&plaintext)?;
            let store = Self { entries, data_file, key, salt: envelope.salt };
            if was_legacy_format {
                store.persist()?;
            }
            Ok(store)
        } else {
            let salt = crypto::generate_salt();
            let key = crypto::derive_key(password, &salt)?;
            let store = Self { entries: Vec::new(), data_file, key, salt };
            store.persist()?;
            Ok(store)
        }
    }

    /// The top-level sidebar tree, in display order — for the IPC layer to
    /// shape into a frontend-renderable DTO. Replaces the pre-FR-11 flat
    /// `list()` accessor, which could not express folders.
    pub fn entries(&self) -> &[SidebarEntry] {
        &self.entries
    }

    /// Finds a project by id wherever it currently lives — a top-level entry,
    /// or a member of some folder. This is how `command_runner`/`pty_manager`
    /// read a project's path/commands (architecture.md §5.1) now that
    /// projects are no longer all siblings in one flat slice.
    pub fn find_project(&self, id: Uuid) -> Option<&Project> {
        for entry in &self.entries {
            match entry {
                SidebarEntry::Project(p) if p.id == id => return Some(p),
                SidebarEntry::Folder(f) => {
                    if let Some(p) = f.members.iter().find(|p| p.id == id) {
                        return Some(p);
                    }
                }
                _ => {}
            }
        }
        None
    }

    fn find_project_mut(&mut self, id: Uuid) -> Option<&mut Project> {
        for entry in &mut self.entries {
            match entry {
                SidebarEntry::Project(p) if p.id == id => return Some(p),
                SidebarEntry::Folder(f) => {
                    if let Some(p) = f.members.iter_mut().find(|p| p.id == id) {
                        return Some(p);
                    }
                }
                _ => {}
            }
        }
        None
    }

    fn find_folder_mut(&mut self, folder_id: Uuid) -> Option<&mut Folder> {
        self.entries.iter_mut().find_map(|e| match e {
            SidebarEntry::Folder(f) if f.id == folder_id => Some(f),
            _ => None,
        })
    }

    /// Which folder (if any) currently owns `project_id` as a member.
    fn folder_containing(&self, project_id: Uuid) -> Option<Uuid> {
        self.entries.iter().find_map(|e| match e {
            SidebarEntry::Folder(f) if f.members.iter().any(|p| p.id == project_id) => Some(f.id),
            _ => None,
        })
    }

    /// Removes and returns the project matching `id`, wherever it currently
    /// lives (a top-level entry, or a folder member) — the single place this
    /// invariant is enforced: if removing it leaves a folder with zero
    /// members, that folder is pruned in the same step (ADR-0011 — an empty
    /// folder must never persist, even momentarily). Callers that need a
    /// same-folder reorder (moving a project within the very folder it's
    /// already in) must NOT go through this helper — see `move_project`'s
    /// own comment on why: pruning a folder down to its *last other* member
    /// being moved would destroy a folder state FR-11 explicitly allows
    /// (a 1-member folder, left behind after dragging its second-to-last
    /// member out, is not itself auto-deleted).
    fn remove_project_by_id(&mut self, id: Uuid) -> Option<Project> {
        if let Some(index) = self
            .entries
            .iter()
            .position(|e| matches!(e, SidebarEntry::Project(p) if p.id == id))
        {
            let SidebarEntry::Project(project) = self.entries.remove(index) else {
                unreachable!("index located via the Project(..) pattern above")
            };
            return Some(project);
        }

        let folder_index = self.entries.iter().position(|e| {
            matches!(e, SidebarEntry::Folder(f) if f.members.iter().any(|p| p.id == id))
        })?;

        let SidebarEntry::Folder(folder) = &mut self.entries[folder_index] else {
            unreachable!("index located via the Folder(..) pattern above")
        };
        let member_index = folder.members.iter().position(|p| p.id == id)?;
        let project = folder.members.remove(member_index);
        if folder.members.is_empty() {
            self.entries.remove(folder_index);
        }
        Some(project)
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
        self.entries.push(SidebarEntry::Project(project.clone()));
        self.persist()?;
        Ok(project)
    }

    pub fn update(&mut self, id: Uuid, input: ProjectInput) -> Result<Project, ProjectStoreError> {
        validate_input(&input)?;
        let project = self.find_project_mut(id).ok_or(ProjectStoreError::NotFound(id))?;
        project.name = input.name;
        project.path = input.path;
        project.setup_commands = input.setup_commands;
        project.notes = input.notes;
        project.updated_at = Utc::now();
        let updated = project.clone();
        self.persist()?;
        Ok(updated)
    }

    /// Deletes a project wherever it lives (top-level or inside a folder),
    /// auto-pruning an emptied folder as a side effect of `remove_project_by_id`
    /// (FR-11's "deleting a folder's last member" edge case).
    pub fn delete(&mut self, id: Uuid) -> Result<(), ProjectStoreError> {
        self.remove_project_by_id(id).ok_or(ProjectStoreError::NotFound(id))?;
        self.persist()?;
        Ok(())
    }

    /// FR-11 "drop onto a row's merge band": dragging `dragged_id` onto
    /// `target_id` either creates a new folder or joins an existing one,
    /// depending on what `target_id` currently is (resolved *before* removing
    /// `dragged_id`, so pruning `dragged_id`'s own old folder can never
    /// change what `target_id` resolves to):
    /// - `target_id` names an existing `Folder` (dropped directly on a folder
    ///   header) → `dragged_id` joins it, appended to the end.
    /// - `target_id` names a `Project` already inside some folder → `dragged_id`
    ///   joins that same folder, inserted immediately after `target_id`.
    /// - `target_id` names a top-level, unfoldered `Project` → a brand-new
    ///   folder is created, named after `target_id`'s project (design.md's
    ///   "the row that stays put becomes the anchor"), replacing that
    ///   project's own top-level position, containing `[target, dragged]`.
    ///
    /// Returns the id of the folder `dragged_id` ended up in.
    pub fn merge_or_join(&mut self, dragged_id: Uuid, target_id: Uuid) -> Result<Uuid, ProjectStoreError> {
        if dragged_id == target_id {
            return Err(ProjectStoreError::SelfMerge);
        }

        let target_is_folder_header = self
            .entries
            .iter()
            .any(|e| matches!(e, SidebarEntry::Folder(f) if f.id == target_id));
        let destination_folder_id = if target_is_folder_header {
            Some(target_id)
        } else {
            self.folder_containing(target_id)
        };

        // Code review M1: dragged is already a member of the resolved
        // destination folder — this must reposition it *within* that same
        // folder's `members`, never go through `remove_project_by_id`.
        // That helper prunes a folder the instant its members hit zero,
        // which is exactly what "drag a 1-member folder's sole member onto
        // that same folder's own header" would trigger: the removal empties
        // the folder, `remove_project_by_id` deletes it from `entries`, and
        // the lookup below would then fail to find a folder that a moment
        // ago genuinely existed. Mirrors `move_project`'s own same-folder
        // special case (this file, `move_project`'s doc comment).
        if let Some(folder_id) = destination_folder_id {
            if self.folder_containing(dragged_id) == Some(folder_id) {
                let folder = self.find_folder_mut(folder_id).ok_or(ProjectStoreError::NotFound(folder_id))?;
                let current_index = folder
                    .members
                    .iter()
                    .position(|p| p.id == dragged_id)
                    .ok_or(ProjectStoreError::NotFound(dragged_id))?;
                let dragged = folder.members.remove(current_index);
                let insert_at = folder
                    .members
                    .iter()
                    .position(|p| p.id == target_id)
                    .map(|i| i + 1)
                    .unwrap_or(folder.members.len());
                folder.members.insert(insert_at, dragged);
                self.persist()?;
                return Ok(folder_id);
            }
        }

        let dragged = self
            .remove_project_by_id(dragged_id)
            .ok_or(ProjectStoreError::NotFound(dragged_id))?;

        let folder_id = match destination_folder_id {
            Some(folder_id) => {
                let folder = match self.find_folder_mut(folder_id) {
                    Some(folder) => folder,
                    None => {
                        // Unreachable now: dragged being a member of this
                        // exact folder is handled above, before this point,
                        // so removing it here can never have pruned it.
                        // Kept as a safety net, not a designed path.
                        self.entries.push(SidebarEntry::Project(dragged));
                        self.persist()?;
                        return Err(ProjectStoreError::NotFound(folder_id));
                    }
                };
                let insert_at = folder
                    .members
                    .iter()
                    .position(|p| p.id == target_id)
                    .map(|i| i + 1)
                    .unwrap_or(folder.members.len());
                folder.members.insert(insert_at, dragged);
                folder_id
            }
            None => {
                let target_index = self
                    .entries
                    .iter()
                    .position(|e| matches!(e, SidebarEntry::Project(p) if p.id == target_id))
                    .ok_or(ProjectStoreError::NotFound(target_id))?;
                let SidebarEntry::Project(target_project) = self.entries.remove(target_index) else {
                    unreachable!("index located via the Project(..) pattern above")
                };
                let new_folder = Folder {
                    id: Uuid::new_v4(),
                    name: target_project.name.clone(),
                    members: vec![target_project, dragged],
                };
                let new_folder_id = new_folder.id;
                self.entries.insert(target_index, SidebarEntry::Folder(new_folder));
                new_folder_id
            }
        };

        self.persist()?;
        Ok(folder_id)
    }

    /// FR-11 "drop onto a reorder band, or an explicit move": relocates
    /// `project_id` to `destination` at `index` (clamped to the destination
    /// list's length). Covers both "move between folders/top-level" and
    /// "reorder within the current list" — the same primitive, since both are
    /// just "insert at position X within list Y."
    pub fn move_project(
        &mut self,
        project_id: Uuid,
        destination: MoveDestination,
        index: usize,
    ) -> Result<(), ProjectStoreError> {
        // Reordering a project within the very folder it already lives in is
        // handled separately, without `remove_project_by_id` — going through
        // that helper would prune-then-strand a folder whose sole *other*
        // member is the one being moved, since removing it would (correctly,
        // for every other caller) look like emptying the folder. A 1-member
        // folder is a valid, PRD-specified state, so this path never treats
        // "temporarily down to the one member being reordered" as empty.
        if let MoveDestination::Folder(folder_id) = destination {
            if self.folder_containing(project_id) == Some(folder_id) {
                let folder = self.find_folder_mut(folder_id).ok_or(ProjectStoreError::NotFound(folder_id))?;
                let current_index = folder
                    .members
                    .iter()
                    .position(|p| p.id == project_id)
                    .ok_or(ProjectStoreError::NotFound(project_id))?;
                let project = folder.members.remove(current_index);
                let index = index.min(folder.members.len());
                folder.members.insert(index, project);
                self.persist()?;
                return Ok(());
            }
        }

        let project = self
            .remove_project_by_id(project_id)
            .ok_or(ProjectStoreError::NotFound(project_id))?;

        match destination {
            MoveDestination::TopLevel => {
                let index = index.min(self.entries.len());
                self.entries.insert(index, SidebarEntry::Project(project));
            }
            MoveDestination::Folder(folder_id) => match self.find_folder_mut(folder_id) {
                Some(folder) => {
                    let index = index.min(folder.members.len());
                    folder.members.insert(index, project);
                }
                None => {
                    // Destination folder doesn't exist — put the project back
                    // at top level rather than lose it, then report the error.
                    self.entries.push(SidebarEntry::Project(project));
                    self.persist()?;
                    return Err(ProjectStoreError::NotFound(folder_id));
                }
            },
        }

        self.persist()?;
        Ok(())
    }

    /// FR-11: repositions a `Folder` header within the top-level list (its
    /// own reorder band, distinct from anything inside it). Folders never
    /// have a "move into another folder" equivalent — see `MoveDestination`.
    pub fn reorder_folder(&mut self, folder_id: Uuid, index: usize) -> Result<(), ProjectStoreError> {
        let current_index = self
            .entries
            .iter()
            .position(|e| matches!(e, SidebarEntry::Folder(f) if f.id == folder_id))
            .ok_or(ProjectStoreError::NotFound(folder_id))?;
        let entry = self.entries.remove(current_index);
        let index = index.min(self.entries.len());
        self.entries.insert(index, entry);
        self.persist()?;
        Ok(())
    }

    /// FR-11 rename: an empty/whitespace-only `name` silently reverts to the
    /// folder's previous name rather than erroring or saving a blank label
    /// (PRD edge case). Returns the name actually saved, since the caller
    /// can't otherwise tell a silent revert happened.
    pub fn rename_folder(&mut self, folder_id: Uuid, name: String) -> Result<String, ProjectStoreError> {
        let folder = self.find_folder_mut(folder_id).ok_or(ProjectStoreError::NotFound(folder_id))?;
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            folder.name = trimmed.to_string();
        }
        let saved_name = folder.name.clone();
        self.persist()?;
        Ok(saved_name)
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
    /// one. This protects every caller — `add`/`update`/`delete`, the FR-11
    /// folder operations, and `change_password` alike — not just password
    /// rotation specifically.
    fn persist(&self) -> Result<(), ProjectStoreError> {
        let plaintext = encode_plaintext(&self.entries)?;
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

/// ADR-0011 Part 2: marks the plaintext (the AES-GCM envelope's *decrypted*
/// contents, not the on-disk envelope itself — that framing is unchanged) as
/// the post-FR-11 `Vec<SidebarEntry>` shape rather than the pre-FR-11 bare
/// `Vec<Project>` shape. `bincode` has no schema tag of its own, so this is
/// the only reliable way to tell the two apart on load.
const FORMAT_MARKER: [u8; 4] = *b"FR11";
const FORMAT_VERSION: u8 = 1;

fn encode_plaintext(entries: &[SidebarEntry]) -> Result<Vec<u8>, ProjectStoreError> {
    let mut out = Vec::new();
    out.extend_from_slice(&FORMAT_MARKER);
    out.push(FORMAT_VERSION);
    let body = bincode::serialize(entries).map_err(|_| ProjectStoreError::Corrupted)?;
    out.extend_from_slice(&body);
    Ok(out)
}

/// Decodes `project_store`'s plaintext, handling both the current
/// marker-prefixed `Vec<SidebarEntry>` format and the pre-FR-11 legacy format
/// (a bare `bincode`-serialized `Vec<Project>`, with no marker at all).
/// Returns whether the legacy path was taken, so `unlock` knows to
/// immediately re-persist in the new marked format (each project becomes an
/// unfoldered top-level entry) — no data loss for files that predate FR-11
/// (ADR-0011).
fn decode_plaintext(plaintext: &[u8]) -> Result<(Vec<SidebarEntry>, bool), ProjectStoreError> {
    let marker_len = FORMAT_MARKER.len();
    if plaintext.len() > marker_len && plaintext[..marker_len] == FORMAT_MARKER {
        let version = plaintext[marker_len];
        if version != FORMAT_VERSION {
            // No other version has ever existed yet — an unrecognized one
            // means a newer app version wrote this file.
            return Err(ProjectStoreError::Corrupted);
        }
        let body = &plaintext[marker_len + 1..];
        let entries = bincode::deserialize(body).map_err(|_| ProjectStoreError::Corrupted)?;
        Ok((entries, false))
    } else {
        let legacy: Vec<Project> = bincode::deserialize(plaintext).map_err(|_| ProjectStoreError::Corrupted)?;
        Ok((legacy.into_iter().map(SidebarEntry::Project).collect(), true))
    }
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

    /// Test-only accessor: asserts index `idx` of `store.entries()` is a
    /// top-level `Project` and returns it, panicking with a clear message
    /// otherwise — keeps existing-style tests reading almost like the old
    /// `store.list()[idx]` did.
    fn project_at(store: &ProjectStore, idx: usize) -> &Project {
        match &store.entries()[idx] {
            SidebarEntry::Project(p) => p,
            SidebarEntry::Folder(_) => panic!("expected a top-level project at index {idx}, found a folder"),
        }
    }

    fn folder_by_id(store: &ProjectStore, id: Uuid) -> &Folder {
        store
            .entries()
            .iter()
            .find_map(|e| match e {
                SidebarEntry::Folder(f) if f.id == id => Some(f),
                _ => None,
            })
            .expect("expected a folder with this id")
    }

    #[test]
    fn unlock_creates_empty_store_when_no_file_exists() {
        let dir = tempdir().unwrap();
        let store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        assert!(store.entries().is_empty());
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
        assert_eq!(store.entries().len(), 1);
        assert_eq!(project_at(&store, 0).id, created.id);
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
        assert_eq!(store.entries().len(), 1, "update must not create a duplicate entry");
    }

    #[test]
    fn update_unknown_id_fails() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let result = store.update(Uuid::new_v4(), input("x", dir.path().to_path_buf()));
        assert!(matches!(result, Err(ProjectStoreError::NotFound(_))));
    }

    #[test]
    fn update_modifies_a_project_nested_inside_a_folder() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        store.merge_or_join(a.id, b.id).unwrap();

        let mut updated_input = input("a-renamed", dir.path().to_path_buf());
        updated_input.notes = "note".into();
        let updated = store.update(a.id, updated_input).unwrap();

        assert_eq!(updated.name, "a-renamed");
        assert_eq!(store.find_project(a.id).unwrap().name, "a-renamed");
    }

    #[test]
    fn delete_removes_project() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let created = store.add(input("to-delete", dir.path().to_path_buf())).unwrap();
        store.delete(created.id).unwrap();
        assert!(store.entries().is_empty());
    }

    #[test]
    fn delete_unknown_id_fails() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let result = store.delete(Uuid::new_v4());
        assert!(matches!(result, Err(ProjectStoreError::NotFound(_))));
    }

    #[test]
    fn deleting_a_folders_last_member_auto_deletes_the_folder() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let folder_id = store.merge_or_join(a.id, b.id).unwrap();

        store.delete(a.id).unwrap();
        assert_eq!(folder_by_id(&store, folder_id).members.len(), 1, "b alone must not auto-delete the folder");

        store.delete(b.id).unwrap();
        assert!(
            store.entries().iter().all(|e| !matches!(e, SidebarEntry::Folder(f) if f.id == folder_id)),
            "folder must be gone once its last member is deleted"
        );
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
        assert_eq!(reopened.entries().len(), 1);
        assert_eq!(project_at(&reopened, 0).name, "persisted");
        assert_eq!(project_at(&reopened, 0).notes, "secret note");
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
        assert_eq!(reopened.entries().len(), 1, "data must survive rotation intact");
        assert_eq!(project_at(&reopened, 0).name, "p");
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
        assert_eq!(reopened.entries().len(), 1);
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

    // --- FR-11: Sidebar Folders (ADR-0011) ---

    #[test]
    fn merge_or_join_creates_a_new_folder_named_after_the_target() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("frontend-app", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("backend-api", dir.path().to_path_buf())).unwrap();

        let folder_id = store.merge_or_join(a.id, b.id).unwrap();

        let folder = folder_by_id(&store, folder_id);
        assert_eq!(folder.name, "backend-api", "folder is named after the target (the row that stays put)");
        assert_eq!(folder.members.iter().map(|p| p.id).collect::<Vec<_>>(), vec![b.id, a.id]);
        assert_eq!(store.entries().len(), 1, "both projects leave the top level, replaced by one folder entry");
    }

    #[test]
    fn merge_or_join_rejects_merging_an_entry_with_itself() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();

        let result = store.merge_or_join(a.id, a.id);
        assert!(matches!(result, Err(ProjectStoreError::SelfMerge)));
    }

    #[test]
    fn merge_or_join_onto_a_project_already_in_a_folder_joins_that_folder_instead_of_nesting() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let c = store.add(input("c", dir.path().to_path_buf())).unwrap();
        let folder_id = store.merge_or_join(a.id, b.id).unwrap();

        let joined_folder_id = store.merge_or_join(c.id, b.id).unwrap();

        assert_eq!(joined_folder_id, folder_id, "must join the existing folder, not create a second one");
        let folder = folder_by_id(&store, folder_id);
        assert_eq!(folder.members.iter().map(|p| p.id).collect::<Vec<_>>(), vec![b.id, c.id, a.id]);
        assert_eq!(
            store.entries().iter().filter(|e| matches!(e, SidebarEntry::Folder(_))).count(),
            1,
            "flat-only: no nested/second folder must ever be created"
        );
    }

    #[test]
    fn merge_or_join_dropped_directly_on_a_folder_header_appends_to_the_end() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let c = store.add(input("c", dir.path().to_path_buf())).unwrap();
        let folder_id = store.merge_or_join(a.id, b.id).unwrap();

        store.merge_or_join(c.id, folder_id).unwrap();

        let folder = folder_by_id(&store, folder_id);
        assert_eq!(folder.members.iter().map(|p| p.id).collect::<Vec<_>>(), vec![b.id, a.id, c.id]);
    }

    /// Regression, code review M1: dragging a 1-member folder's sole member
    /// onto that same folder's own header used to remove the member (via
    /// `remove_project_by_id`, which prunes an emptied folder), leaving
    /// nothing for the subsequent folder lookup to find — ejecting the
    /// project to top level and returning a spurious `NotFound` error,
    /// instead of the harmless no-op a user dragging their own folder's
    /// only member onto itself would expect.
    #[test]
    fn merge_or_join_a_1_member_folders_sole_member_onto_its_own_header_is_a_harmless_no_op() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let folder_id = store.merge_or_join(a.id, b.id).unwrap(); // members: [b, a]
        store.move_project(a.id, MoveDestination::TopLevel, 0).unwrap(); // folder now has just [b]
        assert_eq!(folder_by_id(&store, folder_id).members.len(), 1);

        let result = store.merge_or_join(b.id, folder_id);

        assert_eq!(result.unwrap(), folder_id, "must resolve to the same folder, not error");
        assert_eq!(
            folder_by_id(&store, folder_id).members.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![b.id],
            "folder must survive with its sole member intact — never pruned mid-operation"
        );
    }

    /// Regression, code review M1 (the general case): dragging one member of
    /// a multi-member folder onto a fellow member reorders within that same
    /// folder instead of risking the remove-then-relookup bug the 1-member
    /// case above hit directly.
    #[test]
    fn merge_or_join_between_two_members_of_the_same_folder_reorders_in_place() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let c = store.add(input("c", dir.path().to_path_buf())).unwrap();
        let folder_id = store.merge_or_join(a.id, b.id).unwrap(); // members: [b, a]
        store.merge_or_join(c.id, folder_id).unwrap(); // members: [b, a, c]

        let result = store.merge_or_join(b.id, a.id); // drag b onto a: expect [a, b, c]

        assert_eq!(result.unwrap(), folder_id);
        assert_eq!(
            folder_by_id(&store, folder_id).members.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![a.id, b.id, c.id]
        );
    }

    #[test]
    fn move_project_within_its_own_folder_reorders_without_pruning_it() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let folder_id = store.merge_or_join(a.id, b.id).unwrap(); // members: [b, a]

        // Moving `a` to index 0 within the very folder it already lives in
        // must go through the same-folder reorder path, not
        // `remove_project_by_id` — that path would (correctly, for every
        // other caller) look like emptying the folder down to just `b`
        // mid-operation, which must never prune a folder FR-11 says is a
        // valid, non-empty state.
        store.move_project(a.id, MoveDestination::Folder(folder_id), 0).unwrap();

        let folder = folder_by_id(&store, folder_id);
        assert_eq!(folder.members.iter().map(|p| p.id).collect::<Vec<_>>(), vec![a.id, b.id]);
    }

    #[test]
    fn move_project_between_two_folders_leaves_a_valid_1_member_folder_behind() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let c = store.add(input("c", dir.path().to_path_buf())).unwrap();
        let d = store.add(input("d", dir.path().to_path_buf())).unwrap();
        let folder_ab = store.merge_or_join(a.id, b.id).unwrap();
        let folder_cd = store.merge_or_join(c.id, d.id).unwrap();

        store.move_project(a.id, MoveDestination::Folder(folder_cd), 0).unwrap();

        assert_eq!(
            folder_by_id(&store, folder_ab).members.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![b.id],
            "folder_ab must survive as a valid 1-member folder, not be pruned"
        );
        assert_eq!(
            folder_by_id(&store, folder_cd).members.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![a.id, d.id, c.id],
            "folder_cd's members were [d, c] (target-then-dragged order from merge_or_join), a inserted at index 0"
        );
    }

    #[test]
    fn move_project_to_top_level_removes_it_from_its_folder() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let c = store.add(input("c", dir.path().to_path_buf())).unwrap();
        let folder_id = store.merge_or_join(a.id, b.id).unwrap();

        store.move_project(c.id, MoveDestination::TopLevel, 0).unwrap(); // c was already top-level — no-op-ish move
        store.move_project(a.id, MoveDestination::TopLevel, 0).unwrap();

        assert_eq!(folder_by_id(&store, folder_id).members.iter().map(|p| p.id).collect::<Vec<_>>(), vec![b.id]);
        assert_eq!(project_at(&store, 0).id, a.id, "moved to the requested top-level index");
    }

    #[test]
    fn reorder_folder_repositions_it_within_the_top_level() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let c = store.add(input("c", dir.path().to_path_buf())).unwrap();
        let folder_id = store.merge_or_join(a.id, b.id).unwrap(); // folder replaces b's slot: [folder(a,b), c]

        store.reorder_folder(folder_id, 1).unwrap();

        assert_eq!(project_at(&store, 0).id, c.id);
        assert!(matches!(&store.entries()[1], SidebarEntry::Folder(f) if f.id == folder_id));
    }

    #[test]
    fn rename_folder_applies_a_non_empty_name() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let folder_id = store.merge_or_join(a.id, b.id).unwrap();

        let saved = store.rename_folder(folder_id, "My Folder".to_string()).unwrap();

        assert_eq!(saved, "My Folder");
        assert_eq!(folder_by_id(&store, folder_id).name, "My Folder");
    }

    #[test]
    fn rename_folder_with_blank_input_reverts_to_the_previous_name() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        let folder_id = store.merge_or_join(a.id, b.id).unwrap();
        store.rename_folder(folder_id, "Named".to_string()).unwrap();

        let saved = store.rename_folder(folder_id, "   ".to_string()).unwrap();

        assert_eq!(saved, "Named", "blank/whitespace-only input must revert, not save a blank label");
        assert_eq!(folder_by_id(&store, folder_id).name, "Named");
    }

    #[test]
    fn find_project_locates_a_project_nested_inside_a_folder() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::unlock(dir.path().join("projects.enc"), "pw").unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        store.merge_or_join(a.id, b.id).unwrap();

        assert_eq!(store.find_project(a.id).unwrap().id, a.id);
        assert_eq!(store.find_project(b.id).unwrap().id, b.id);
        assert!(store.find_project(Uuid::new_v4()).is_none());
    }

    /// The most safety-critical test in this module (ADR-0011 Part 2): a
    /// file written by the app *before* FR-11 shipped — a bare `bincode`
    /// `Vec<Project>`, no marker — must still unlock correctly, with every
    /// project intact as an unfoldered top-level entry, and the file must
    /// transparently upgrade to the new marked format on the very next save.
    #[test]
    fn unlock_migrates_a_pre_fr11_legacy_format_file_without_losing_data() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");

        // Hand-construct a legacy-format file the way pre-FR-11 `persist()`
        // used to: bare `bincode::serialize(&Vec<Project>)` as the plaintext,
        // no marker, AES-GCM-encrypted with a real derived key/salt so
        // `unlock` exercises the exact same decrypt path a real legacy file
        // would.
        let legacy_project = Project {
            id: Uuid::new_v4(),
            name: "pre-existing-project".to_string(),
            path: dir.path().to_path_buf(),
            setup_commands: vec!["nvm use".to_string()],
            notes: "API_KEY=legacy-secret".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let legacy_plaintext = bincode::serialize(&vec![legacy_project.clone()]).unwrap();
        let salt = crypto::generate_salt();
        let key = crypto::derive_key("pw", &salt).unwrap();
        let (nonce, ciphertext) = crypto::encrypt(&key, &legacy_plaintext).unwrap();
        let envelope = build_envelope(&salt, &nonce, &ciphertext);
        std::fs::write(&data_file, &envelope).unwrap();

        let store = ProjectStore::unlock(data_file.clone(), "pw").unwrap();

        assert_eq!(store.entries().len(), 1);
        let found = store.find_project(legacy_project.id).expect("legacy project must survive migration");
        assert_eq!(found.name, "pre-existing-project");
        assert_eq!(found.notes, "API_KEY=legacy-secret");
        assert_eq!(found.setup_commands, vec!["nvm use".to_string()]);
        assert!(
            matches!(store.entries()[0], SidebarEntry::Project(_)),
            "a legacy project must come back as an unfoldered top-level entry"
        );

        // Re-reading the on-disk file's raw bytes must now show the new
        // marker — confirming the upgrade was actually persisted, not just
        // held in memory (drop `store` first so the file isn't held open).
        drop(store);
        let raw = std::fs::read(&data_file).unwrap();
        let re_derived_key = crypto::derive_key("pw", &split_envelope(&raw).unwrap().salt).unwrap();
        let envelope = split_envelope(&raw).unwrap();
        let plaintext = crypto::decrypt(&re_derived_key, &envelope.nonce, &envelope.ciphertext).unwrap();
        assert_eq!(&plaintext[..FORMAT_MARKER.len()], &FORMAT_MARKER, "file must be upgraded to the new marked format on save");

        // And it must still unlock correctly a second time, now reading its
        // own upgraded format back.
        let reopened = ProjectStore::unlock(data_file, "pw").unwrap();
        assert_eq!(reopened.find_project(legacy_project.id).unwrap().name, "pre-existing-project");
    }
}
