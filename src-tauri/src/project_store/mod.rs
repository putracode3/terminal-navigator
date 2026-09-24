//! CRUD + plain-file persistence for the project list (ADR-0004, FR-01,
//! FR-02; encryption removed by ADR-0014) and, since FR-11 (ADR-0011),
//! user-organized drag-and-drop Folders grouping projects in the sidebar.
//! Sole owner of the `Project` and `Folder` entities (architecture.md §5.1)
//! — no other module reads or writes project/folder data directly.
//!
//! ADR-0014: the data file may still be found in the pre-ADR-0014 AES-GCM
//! encrypted envelope format (the author's own real, pre-existing file).
//! `load` never touches `crypto` — a file in that legacy format is reported
//! via `ProjectStoreError::NeedsMigration` instead, and the caller (the IPC
//! layer) is expected to prompt for the legacy master password exactly once
//! and call `migrate_from_legacy`, which decrypts it and immediately
//! re-persists in the current plain format. Every subsequent `load` then
//! takes the plain-format path and never touches `crypto` again.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::crypto::{self, CryptoError, NONCE_LEN, SALT_LEN};

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
    /// FR-01 (amended): the "Home" entry is the sidebar's permanent default
    /// and can never be deleted — matched by name, the same lookup FR-01's
    /// launch auto-open already uses to find it, since there's no separate
    /// identity field on `Project` to flag it with instead. Renaming it away
    /// from "Home" first makes it an ordinary, deletable entry.
    #[error("the \"Home\" entry can't be deleted — it's the sidebar's default")]
    ProtectedEntry,
    #[error(transparent)]
    Crypto(#[from] CryptoError),
    #[error("failed to read/write data file")]
    Io(#[from] std::io::Error),
    #[error("data file is corrupted or in an unrecognized format")]
    Corrupted,
    #[error("legacy password is incorrect")]
    WrongPassword,
    /// `load` found a file that isn't in the current plain format — either
    /// the pre-ADR-0014 AES-GCM envelope, still holding the author's real
    /// data, or (only reachable in principle) an even older pre-FR-11
    /// unmarked shape. The IPC layer should prompt for the legacy master
    /// password once and call `migrate_from_legacy`.
    #[error("data file is in the pre-ADR-0014 encrypted format and needs one-time migration")]
    NeedsMigration,
}

pub struct ProjectStore {
    entries: Vec<SidebarEntry>,
    data_file: PathBuf,
}

/// The seeded default entry's name — see `ProjectStoreError::ProtectedEntry`.
const HOME_ENTRY_NAME: &str = "Home";

impl ProjectStore {
    /// Loads the store at `data_file`. If it doesn't exist yet, initializes
    /// a fresh store there instead (first run) — no password is ever asked
    /// (ADR-0014). A fresh store is seeded with one "Home" project pointing
    /// at `default_home`, when given and it exists on disk, so a first
    /// launch never starts on a totally empty sidebar; pass `None` (or a
    /// path that doesn't exist) to start genuinely empty instead. If the
    /// file exists but isn't in the current plain format, returns
    /// `NeedsMigration` rather than attempting to read it — callers must go
    /// through `migrate_from_legacy` for that case.
    pub fn load(data_file: PathBuf, default_home: Option<PathBuf>) -> Result<Self, ProjectStoreError> {
        if !data_file.exists() {
            let entries = default_home.filter(|p| p.exists()).map_or_else(Vec::new, |path| {
                let now = Utc::now();
                vec![SidebarEntry::Project(Project {
                    id: Uuid::new_v4(),
                    name: HOME_ENTRY_NAME.to_string(),
                    path,
                    setup_commands: Vec::new(),
                    notes: String::new(),
                    created_at: now,
                    updated_at: now,
                })]
            });
            let store = Self { entries, data_file };
            store.persist()?;
            return Ok(store);
        }

        let raw = std::fs::read(&data_file)?;
        if !is_plain_format(&raw) {
            return Err(ProjectStoreError::NeedsMigration);
        }
        let entries = decode_plain_file(&raw)?;
        Ok(Self { entries, data_file })
    }

    /// One-time migration (ADR-0014): decrypts a pre-existing AES-GCM-encrypted
    /// data file with the legacy master password and immediately re-persists
    /// it in the current plain format — `persist`'s atomic write (temp file +
    /// rename) means a crash mid-migration leaves either the original
    /// encrypted file or the fully-written plain file intact, never a
    /// truncated/corrupt one. Every subsequent `load` then takes the plain
    /// path and never calls this again. Also transparently handles the even
    /// older pre-FR-11 unmarked shape nested inside the decrypted plaintext
    /// (ADR-0011) — both legacy shapes collapse to the same current format
    /// in one migration step.
    pub fn migrate_from_legacy(data_file: PathBuf, legacy_password: &str) -> Result<Self, ProjectStoreError> {
        let raw = std::fs::read(&data_file)?;
        let envelope = split_envelope(&raw)?;
        let key = crypto::derive_key(legacy_password, &envelope.salt)?;
        let plaintext = crypto::decrypt(&key, &envelope.nonce, &envelope.ciphertext)
            .map_err(|_| ProjectStoreError::WrongPassword)?;
        let entries = decode_legacy_plaintext(&plaintext)?;
        let store = Self { entries, data_file };
        store.persist()?;
        Ok(store)
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
    /// (FR-11's "deleting a folder's last member" edge case). Rejects the
    /// "Home" entry outright (FR-01) — checked before any removal happens, so
    /// a rejected delete never touches `entries` or persists anything.
    pub fn delete(&mut self, id: Uuid) -> Result<(), ProjectStoreError> {
        if self.find_project(id).is_some_and(|p| p.name == HOME_ENTRY_NAME) {
            return Err(ProjectStoreError::ProtectedEntry);
        }
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

    /// Writes the current entries to disk in the plain format (ADR-0014).
    /// Atomic (temp file + rename in the same directory, ADR-0010): a crash
    /// mid-write leaves either the previous file or the fully-written new
    /// one, never a truncated/corrupt one. This protects every caller —
    /// `add`/`update`/`delete`, the FR-11 folder operations, and
    /// `migrate_from_legacy` alike.
    fn persist(&self) -> Result<(), ProjectStoreError> {
        let body = encode_plain_file(&self.entries)?;

        let dir = self.data_file.parent().unwrap_or_else(|| Path::new("."));
        let file_name = self.data_file.file_name().and_then(|n| n.to_str()).unwrap_or("projects.enc");
        let tmp_path = dir.join(format!(".{file_name}.tmp"));

        std::fs::write(&tmp_path, &body)?;
        // Security audit 2026-07-20, M3: restrict the data file to
        // owner-only — otherwise it's written with the OS default/umask
        // permissions (typically world-readable). Now that the file is
        // plain (ADR-0014), this permission is the *only* protection the
        // data has, not a defense-in-depth layer on top of encryption. Set
        // on the temp file before the rename — permissions carry through a
        // rename on the same filesystem.
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

/// Legacy on-disk layout, pre-ADR-0014: [salt (16 bytes)][nonce (12
/// bytes)][AES-GCM ciphertext]. Only ever read now, during migration —
/// never written again.
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

/// ADR-0011 Part 2: marks the *decrypted* contents of the legacy AES-GCM
/// envelope as the post-FR-11 `Vec<SidebarEntry>` shape rather than the
/// pre-FR-11 bare `Vec<Project>` shape. `bincode` has no schema tag of its
/// own, so this was the only reliable way to tell the two apart on load.
/// Retained read-only for `migrate_from_legacy` — nothing encodes into this
/// shape anymore (see `encode_plain_file` for the current on-disk format).
const LEGACY_FORMAT_MARKER: [u8; 4] = *b"FR11";
const LEGACY_FORMAT_VERSION: u8 = 1;

/// Decodes the legacy AES-GCM envelope's decrypted contents, handling both
/// the post-FR-11 marker-prefixed `Vec<SidebarEntry>` format and the even
/// older pre-FR-11 legacy format (a bare `bincode`-serialized `Vec<Project>`,
/// no marker at all) — both collapse to the same `Vec<SidebarEntry>` here,
/// since `migrate_from_legacy` re-persists in the current plain format
/// immediately either way (each pre-FR-11 project becomes an unfoldered
/// top-level entry, same as ADR-0011 originally specified).
fn decode_legacy_plaintext(plaintext: &[u8]) -> Result<Vec<SidebarEntry>, ProjectStoreError> {
    let marker_len = LEGACY_FORMAT_MARKER.len();
    if plaintext.len() > marker_len && plaintext[..marker_len] == LEGACY_FORMAT_MARKER {
        let version = plaintext[marker_len];
        if version != LEGACY_FORMAT_VERSION {
            return Err(ProjectStoreError::Corrupted);
        }
        let body = &plaintext[marker_len + 1..];
        bincode::deserialize(body).map_err(|_| ProjectStoreError::Corrupted)
    } else {
        let legacy: Vec<Project> = bincode::deserialize(plaintext).map_err(|_| ProjectStoreError::Corrupted)?;
        Ok(legacy.into_iter().map(SidebarEntry::Project).collect())
    }
}

/// Test-fixture-only counterparts to `split_envelope`/`decode_legacy_plaintext`
/// — construct a legacy AES-GCM-encrypted file the way pre-ADR-0014
/// `persist()` used to, so migration tests exercise the exact same decrypt
/// path a real legacy file would.
#[cfg(test)]
fn build_legacy_envelope(salt: &[u8; SALT_LEN], nonce: &[u8], ciphertext: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(SALT_LEN + nonce.len() + ciphertext.len());
    out.extend_from_slice(salt);
    out.extend_from_slice(nonce);
    out.extend_from_slice(ciphertext);
    out
}

#[cfg(test)]
fn encode_legacy_plaintext_fixture(entries: &[SidebarEntry]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&LEGACY_FORMAT_MARKER);
    out.push(LEGACY_FORMAT_VERSION);
    out.extend_from_slice(&bincode::serialize(entries).unwrap());
    out
}

/// Current on-disk format (ADR-0014): [marker (4 bytes)][version (1
/// byte)][`bincode`-serialized `Vec<SidebarEntry>`], with no encryption
/// envelope around it. The marker is distinct from `LEGACY_FORMAT_MARKER`
/// (which only ever appeared *inside* the decrypted legacy envelope, never
/// on disk directly) so `is_plain_format` can tell a plain file apart from
/// a legacy encrypted one — whose first 16 bytes are an effectively random
/// salt — without needing to attempt a decrypt first.
const PLAIN_FILE_MARKER: [u8; 4] = *b"TNPL";
const PLAIN_FILE_VERSION: u8 = 1;

fn is_plain_format(raw: &[u8]) -> bool {
    raw.len() > PLAIN_FILE_MARKER.len() && raw[..PLAIN_FILE_MARKER.len()] == PLAIN_FILE_MARKER
}

fn encode_plain_file(entries: &[SidebarEntry]) -> Result<Vec<u8>, ProjectStoreError> {
    let mut out = Vec::new();
    out.extend_from_slice(&PLAIN_FILE_MARKER);
    out.push(PLAIN_FILE_VERSION);
    let body = bincode::serialize(entries).map_err(|_| ProjectStoreError::Corrupted)?;
    out.extend_from_slice(&body);
    Ok(out)
}

fn decode_plain_file(raw: &[u8]) -> Result<Vec<SidebarEntry>, ProjectStoreError> {
    let marker_len = PLAIN_FILE_MARKER.len();
    let version = raw[marker_len];
    if version != PLAIN_FILE_VERSION {
        // No other version has ever existed yet — an unrecognized one means
        // a newer app version wrote this file.
        return Err(ProjectStoreError::Corrupted);
    }
    let body = &raw[marker_len + 1..];
    bincode::deserialize(body).map_err(|_| ProjectStoreError::Corrupted)
}

/// Read-only, crate-internal validation used by `config_sync::import` to
/// confirm a candidate import file is a well-formed plain-format data file
/// before it's allowed to replace local data — without needing to fully
/// construct a `ProjectStore` (which also has persist-on-load side effects
/// this check must not have).
pub(crate) fn validate_plain_file(raw: &[u8]) -> Result<(), ProjectStoreError> {
    if !is_plain_format(raw) {
        return Err(ProjectStoreError::Corrupted);
    }
    decode_plain_file(raw)?;
    Ok(())
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
    fn load_creates_empty_store_when_no_file_exists_and_no_default_home_given() {
        let dir = tempdir().unwrap();
        let store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
        assert!(store.entries().is_empty());
    }

    #[test]
    fn load_seeds_a_home_project_on_a_fresh_store_when_default_home_given() {
        let dir = tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();

        let store = ProjectStore::load(dir.path().join("projects.enc"), Some(home.clone())).unwrap();

        assert_eq!(store.entries().len(), 1);
        let seeded = project_at(&store, 0);
        assert_eq!(seeded.name, "Home");
        assert_eq!(seeded.path, home);
    }

    #[test]
    fn load_does_not_seed_when_default_home_does_not_exist_on_disk() {
        let dir = tempdir().unwrap();
        let missing_home = dir.path().join("does-not-exist");

        let store = ProjectStore::load(dir.path().join("projects.enc"), Some(missing_home)).unwrap();

        assert!(store.entries().is_empty());
    }

    #[test]
    fn load_does_not_seed_when_the_data_file_already_exists() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();

        // First run: store already exists on disk (e.g. the user already
        // added/removed projects down to zero) — a later `load` must not
        // re-seed Home just because the tree is currently empty.
        ProjectStore::load(data_file.clone(), None).unwrap();

        let reopened = ProjectStore::load(data_file, Some(home)).unwrap();

        assert!(reopened.entries().is_empty(), "an existing (even empty) data file must never be re-seeded");
    }

    #[cfg(unix)]
    #[test]
    fn data_file_is_restricted_to_owner_only() {
        // Regression test, security audit 2026-07-20 (M3): the data file
        // must not be left at the OS-default/umask permissions (typically
        // world-readable) — since ADR-0014 removed encryption, this
        // permission is the file's *only* protection, not one layer of two.
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        ProjectStore::load(data_file.clone(), None).unwrap();

        let mode = std::fs::metadata(&data_file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "data file must be owner-read/write only, got {mode:o}");
    }

    #[test]
    fn add_rejects_nonexistent_path() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
        let result = store.add(input("test", PathBuf::from("/definitely/does/not/exist/xyz")));
        assert!(matches!(result, Err(ProjectStoreError::PathNotFound(_))));
    }

    #[test]
    fn add_rejects_empty_name() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
        let result = store.add(input("   ", dir.path().to_path_buf()));
        assert!(matches!(result, Err(ProjectStoreError::EmptyName)));
    }

    #[test]
    fn add_then_list_returns_the_project() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
        let created = store.add(input("my-project", dir.path().to_path_buf())).unwrap();
        assert_eq!(store.entries().len(), 1);
        assert_eq!(project_at(&store, 0).id, created.id);
    }

    #[test]
    fn update_modifies_existing_project() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
        let result = store.update(Uuid::new_v4(), input("x", dir.path().to_path_buf()));
        assert!(matches!(result, Err(ProjectStoreError::NotFound(_))));
    }

    #[test]
    fn update_modifies_a_project_nested_inside_a_folder() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
        let created = store.add(input("to-delete", dir.path().to_path_buf())).unwrap();
        store.delete(created.id).unwrap();
        assert!(store.entries().is_empty());
    }

    #[test]
    fn delete_unknown_id_fails() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
        let result = store.delete(Uuid::new_v4());
        assert!(matches!(result, Err(ProjectStoreError::NotFound(_))));
    }

    #[test]
    fn delete_rejects_the_seeded_home_entry() {
        let dir = tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), Some(home)).unwrap();
        let seeded = project_at(&store, 0).id;

        let result = store.delete(seeded);

        assert!(matches!(result, Err(ProjectStoreError::ProtectedEntry)));
        assert_eq!(store.entries().len(), 1, "a rejected delete must leave the entry in place");
    }

    #[test]
    fn delete_rejects_a_user_created_entry_also_named_home() {
        // The guard matches by name (FR-01's existing lookup convention, no
        // separate identity field exists) — so it applies uniformly to
        // whichever entry currently holds that name, seeded or not.
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
        let created = store.add(input("Home", dir.path().to_path_buf())).unwrap();

        let result = store.delete(created.id);

        assert!(matches!(result, Err(ProjectStoreError::ProtectedEntry)));
    }

    #[test]
    fn renaming_the_home_entry_away_makes_it_deletable() {
        let dir = tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), Some(home)).unwrap();
        let seeded = project_at(&store, 0).id;
        let mut renamed_input = input("My Home Dir", dir.path().to_path_buf());
        renamed_input.path = dir.path().to_path_buf();
        store.update(seeded, renamed_input).unwrap();

        store.delete(seeded).unwrap();

        assert!(store.entries().is_empty());
    }

    #[test]
    fn delete_rejects_the_home_entry_even_nested_inside_a_folder() {
        let dir = tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), Some(home)).unwrap();
        let seeded = project_at(&store, 0).id;
        let other = store.add(input("other", dir.path().to_path_buf())).unwrap();
        store.merge_or_join(seeded, other.id).unwrap();

        let result = store.delete(seeded);

        assert!(matches!(result, Err(ProjectStoreError::ProtectedEntry)));
    }

    #[test]
    fn deleting_a_folders_last_member_auto_deletes_the_folder() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
    fn data_persists_across_load_calls() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");

        {
            let mut store = ProjectStore::load(data_file.clone(), None).unwrap();
            let mut proj_input = input("persisted", dir.path().to_path_buf());
            proj_input.notes = "secret note".into();
            store.add(proj_input).unwrap();
        }

        let reopened = ProjectStore::load(data_file, None).unwrap();
        assert_eq!(reopened.entries().len(), 1);
        assert_eq!(project_at(&reopened, 0).name, "persisted");
        assert_eq!(project_at(&reopened, 0).notes, "secret note");
    }

    /// ADR-0014: the whole point of removing encryption is that `load`
    /// never asks for a password — confirms the on-disk file is genuinely
    /// human-readable now, the mirror image of the old
    /// `data_file_on_disk_is_not_plaintext` test this replaces.
    #[test]
    fn data_file_on_disk_is_plaintext() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        let mut store = ProjectStore::load(data_file.clone(), None).unwrap();
        let mut proj_input = input("visible-project", dir.path().to_path_buf());
        proj_input.notes = "some notes".into();
        store.add(proj_input).unwrap();

        let raw = std::fs::read(&data_file).unwrap();
        let raw_str = String::from_utf8_lossy(&raw);
        assert!(raw_str.contains("visible-project"));
        assert!(raw_str.contains("some notes"));
    }

    #[test]
    fn load_reports_needs_migration_for_a_legacy_encrypted_file() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        let salt = crypto::generate_salt();
        let key = crypto::derive_key("legacy-pw", &salt).unwrap();
        let (nonce, ciphertext) = crypto::encrypt(&key, b"irrelevant, load never decrypts").unwrap();
        std::fs::write(&data_file, build_legacy_envelope(&salt, &nonce, &ciphertext)).unwrap();

        let result = ProjectStore::load(data_file, None);
        assert!(matches!(result, Err(ProjectStoreError::NeedsMigration)));
    }

    #[test]
    fn migrate_from_legacy_rejects_wrong_password_without_touching_the_file() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        let salt = crypto::generate_salt();
        let key = crypto::derive_key("correct-password", &salt).unwrap();
        let (nonce, ciphertext) = crypto::encrypt(&key, &encode_legacy_plaintext_fixture(&[])).unwrap();
        let envelope = build_legacy_envelope(&salt, &nonce, &ciphertext);
        std::fs::write(&data_file, &envelope).unwrap();

        let result = ProjectStore::migrate_from_legacy(data_file.clone(), "wrong-password");

        assert!(matches!(result, Err(ProjectStoreError::WrongPassword)));
        assert_eq!(std::fs::read(&data_file).unwrap(), envelope, "a rejected migration must not touch the on-disk file");
    }

    #[test]
    fn persist_leaves_no_leftover_temp_file() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");
        let mut store = ProjectStore::load(data_file.clone(), None).unwrap();
        store.add(input("p", dir.path().to_path_buf())).unwrap();

        assert!(!dir.path().join(".projects.enc.tmp").exists());
    }

    // --- FR-11: Sidebar Folders (ADR-0011) ---

    #[test]
    fn merge_or_join_creates_a_new_folder_named_after_the_target() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();

        let result = store.merge_or_join(a.id, a.id);
        assert!(matches!(result, Err(ProjectStoreError::SelfMerge)));
    }

    #[test]
    fn merge_or_join_onto_a_project_already_in_a_folder_joins_that_folder_instead_of_nesting() {
        let dir = tempdir().unwrap();
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
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
        let mut store = ProjectStore::load(dir.path().join("projects.enc"), None).unwrap();
        let a = store.add(input("a", dir.path().to_path_buf())).unwrap();
        let b = store.add(input("b", dir.path().to_path_buf())).unwrap();
        store.merge_or_join(a.id, b.id).unwrap();

        assert_eq!(store.find_project(a.id).unwrap().id, a.id);
        assert_eq!(store.find_project(b.id).unwrap().id, b.id);
        assert!(store.find_project(Uuid::new_v4()).is_none());
    }

    /// The most safety-critical test in this module (ADR-0014): a file
    /// written by the app *before* this change — AES-GCM-encrypted, in the
    /// post-FR-11 marked shape — must migrate to the current plain format
    /// via `migrate_from_legacy` with every project intact, and the file
    /// must never be read as an encrypted envelope again afterward.
    #[test]
    fn migrate_from_legacy_converts_a_post_fr11_encrypted_file_without_losing_data() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");

        let legacy_project = Project {
            id: Uuid::new_v4(),
            name: "pre-existing-project".to_string(),
            path: dir.path().to_path_buf(),
            setup_commands: vec!["nvm use".to_string()],
            notes: "API_KEY=legacy-secret".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let legacy_entries = vec![SidebarEntry::Project(legacy_project.clone())];
        let legacy_plaintext = encode_legacy_plaintext_fixture(&legacy_entries);
        let salt = crypto::generate_salt();
        let key = crypto::derive_key("legacy-pw", &salt).unwrap();
        let (nonce, ciphertext) = crypto::encrypt(&key, &legacy_plaintext).unwrap();
        let envelope = build_legacy_envelope(&salt, &nonce, &ciphertext);
        std::fs::write(&data_file, &envelope).unwrap();

        // `load` must not attempt to read the legacy file itself.
        assert!(matches!(ProjectStore::load(data_file.clone(), None), Err(ProjectStoreError::NeedsMigration)));

        let store = ProjectStore::migrate_from_legacy(data_file.clone(), "legacy-pw").unwrap();

        assert_eq!(store.entries().len(), 1);
        let found = store.find_project(legacy_project.id).expect("legacy project must survive migration");
        assert_eq!(found.name, "pre-existing-project");
        assert_eq!(found.notes, "API_KEY=legacy-secret");
        assert_eq!(found.setup_commands, vec!["nvm use".to_string()]);

        // Re-reading the on-disk file's raw bytes must now be plain, not the
        // old envelope — confirming migration actually persisted, not just
        // held in memory (drop `store` first so the file isn't held open).
        drop(store);
        let raw = std::fs::read(&data_file).unwrap();
        assert!(is_plain_format(&raw), "file must be migrated to the plain format on disk");

        // And a normal `load` must now succeed directly, no more migration needed.
        let reopened = ProjectStore::load(data_file, None).unwrap();
        assert_eq!(reopened.find_project(legacy_project.id).unwrap().name, "pre-existing-project");
    }

    /// The even-older pre-FR-11 shape (a bare, unmarked `bincode`
    /// `Vec<Project>` inside the legacy encrypted envelope) must also
    /// migrate correctly in one step, collapsing straight to the current
    /// plain format (ADR-0011's original migration target, now reached via
    /// `migrate_from_legacy` instead of the old `unlock`).
    #[test]
    fn migrate_from_legacy_converts_a_pre_fr11_encrypted_file_without_losing_data() {
        let dir = tempdir().unwrap();
        let data_file = dir.path().join("projects.enc");

        let legacy_project = Project {
            id: Uuid::new_v4(),
            name: "very-old-project".to_string(),
            path: dir.path().to_path_buf(),
            setup_commands: vec![],
            notes: String::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        // Bare, unmarked bincode — the true pre-FR-11 shape, no LEGACY_FORMAT_MARKER at all.
        let legacy_plaintext = bincode::serialize(&vec![legacy_project.clone()]).unwrap();
        let salt = crypto::generate_salt();
        let key = crypto::derive_key("legacy-pw", &salt).unwrap();
        let (nonce, ciphertext) = crypto::encrypt(&key, &legacy_plaintext).unwrap();
        std::fs::write(&data_file, build_legacy_envelope(&salt, &nonce, &ciphertext)).unwrap();

        let store = ProjectStore::migrate_from_legacy(data_file, "legacy-pw").unwrap();

        assert_eq!(store.entries().len(), 1);
        assert!(
            matches!(store.entries()[0], SidebarEntry::Project(ref p) if p.id == legacy_project.id),
            "a pre-FR-11 project must come back as an unfoldered top-level entry"
        );
    }
}
