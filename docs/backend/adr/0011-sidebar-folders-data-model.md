# ADR-0011: Sidebar Folders (FR-11) data model + envelope versioning

- **Status:** accepted
- **Date:** 2026-07-21
- **Drivers:** FR-11, NFR-3, NFR-4, NFR-6, ADR-0004

## Context

FR-11 (PRD v1.6) lets the user organize the sidebar's project list into named, flat (non-nesting) Folders, managed by drag-and-drop: a project belongs to exactly one Folder or none; both Folders and ungrouped projects need a stable, user-reorderable position; an empty Folder auto-deletes; Folder name + membership are user-authored data requiring the same at-rest protection as project notes/commands (FR-06/NFR-3), unlike Folder expand/collapse state, which is non-sensitive UI state already covered by the existing unencrypted preferences store (ADR-0009) and needs no schema decision here.

Today, `project_store`'s entire persisted state (ADR-0004) is a bare `Vec<Project>`, serialized with `bincode` and AES-256-GCM-encrypted as one blob — no wrapper struct, no format version marker. Any schema capable of expressing folder membership requires changing that root type, which raises two separate questions: what shape the new root takes, and how existing on-disk files (predating this feature, including the author's own daily-driver data) survive the change.

## Part 1 — Schema shape

### Option A — Flat fields + join
`Project` gains `folder_id: Option<Uuid>` and a `position` field; a sibling `Vec<Folder>{id, name, position}` sits alongside `Vec<Project>`. Closer to a normalized/relational shape.

### Option B — Nested ownership (chosen)
The root becomes `Vec<SidebarEntry>` where `SidebarEntry` is `Project(Project)` or `Folder(Folder)`, and `Folder` directly owns `members: Vec<Project>`. A Vec's own order *is* the position — no separate position field, at either the top level or within a folder.

```rust
#[derive(Serialize, Deserialize)]
enum SidebarEntry {
    Project(Project),
    Folder(Folder),
}

#[derive(Serialize, Deserialize)]
struct Folder {
    id: Uuid,
    name: String,
    members: Vec<Project>,
}

#[derive(Serialize, Deserialize)]
struct StoreData {
    entries: Vec<SidebarEntry>,
}
```

## Decision (Part 1)

Use Option B. Three reasons:

1. **Invalid states become unrepresentable rather than merely disallowed.** Flat-only nesting is enforced by the type system itself (`Folder` holds `Vec<Project>`, never `Vec<SidebarEntry>` — a folder physically cannot contain a folder). A dangling `folder_id` referencing a deleted folder — a real bug class Option A must actively guard against — cannot occur at all under Option B, since membership is structural, not reference-based. This matters more than usual for NFR-6 (author's first Rust project): fewer invariants to remember to maintain by hand.
2. **Ordering is free.** Both "reorder within a folder" and "reorder at top level" reduce to removing an element from one `Vec` position and inserting it at another — no fractional-indexing or renumbering scheme needed, unlike Option A's explicit `position` field.
3. **It's the shape the IPC layer needs to hand the frontend anyway.** `list_projects`'s DTO must become a renderable tree either way (Folders with ordered members, interleaved with ungrouped projects) — Option B needs no separate "reconstruct the tree from flat rows + positions" step in the command layer. This is also the same discriminated-union-tree pattern this codebase already uses for the pane-split tree (`terminal.svelte.ts`'s `PaneNode`), so it's a shape the author has already built and understands once, not a new one.

**Cost, accepted:** `ProjectStore::list() -> &[Project]`'s flat accessor goes away, since projects are no longer all siblings in one slice. `command_runner` and `pty_manager`'s existing by-id project lookup (architecture.md §5.1: they read a project's path/commands *through* `project_store`, never directly) needs a new `ProjectStore::find_project(&self, id: Uuid) -> Option<&Project>` that walks top-level entries and, for each `Folder`, its `members` — still a trivial linear scan at this app's scale (NFR-4: tens to low hundreds of entries total). `list_projects`'s Tauri command and its `ProjectDto`/frontend `appStore.projects` shape change from a flat array to a tree DTO — necessary regardless of A or B, and out of scope for this ADR (backend-implementer's IPC/DTO work, design-implementer's frontend store work).

## Part 2 — Envelope versioning / migration

`project_store::persist()` currently writes `bincode::serialize(&Vec<Project>)` directly as the encrypted plaintext, with no format marker anywhere in the envelope (`build_envelope`'s on-disk layout is `[salt][nonce][ciphertext]` — the *ciphertext*, once decrypted, is bare bincode bytes). `bincode` is not self-describing: it has no schema tag, so asking "is this plaintext an old `Vec<Project>` or a new `StoreData`?" cannot be answered by attempting to deserialize as the new type and catching failure alone — a shape mismatch can, in the worst case, misparse rather than cleanly error.

### Option 1 — Magic-byte version header (chosen)
Prepend a small fixed marker + version byte to the plaintext, before the `bincode` payload, for every file this app writes from this point forward: `[marker: 4 bytes]["FR11"][version: u8][bincode(StoreData)]`. On load, check for the marker at the start of the decrypted plaintext:
- **Present** → new format; read the version byte, deserialize the remaining bytes as `StoreData`.
- **Absent** → legacy format; deserialize the whole plaintext as `Vec<Project>` (the only shape any file lacking the marker can be, since this app never wrote anything else before this ADR), wrap each entry as `SidebarEntry::Project(..)` into a fresh `StoreData { entries }` with no folders, and immediately call `persist()` again from within `unlock` itself (implemented: `unlock` re-persists as soon as it detects the legacy path, not deferred to whatever mutating call happens to come next) so the file is upgraded on disk the moment it's successfully read — a purely read-only session (unlock, look at the list, quit) still leaves the file migrated, not just the in-memory state. This is safe because a legacy file's first bytes are `bincode`'s own `Vec` length prefix (8 bytes, little-endian) — the chosen marker is fixed ASCII bytes chosen to make an accidental collision a non-concern in practice, not a cryptographic byte sequence the old format could plausibly produce by chance for realistic list lengths.

### Option 2 — No versioning, breaking change
Ship the new root type with no migration. Existing on-disk files (including the author's own daily-driver `projects.enc`) would fail to deserialize on next launch.

## Decision (Part 2)

Use Option 1. Rejected Option 2 outright, not as a close call: this app is already the author's real daily driver (per the PRD's own success metric — replacing Tilix), so a migration-free format change would destroy the user's own live data on upgrade. The one-time detect-and-upgrade path costs a handful of lines in `project_store::unlock` and one already-idle field (a version byte) forever after; there is no real argument for skipping it.

## Consequences

- `project_store`'s public surface changes: `list()` (flat slice) is replaced by whatever the command layer needs to build the tree DTO (e.g. `entries() -> &[SidebarEntry]`), plus the new `find_project(id)` lookup. This is an internal-module contract change only — per architecture.md §10.2, `Project`/folder data remains exclusively owned and reached by other modules only through `project_store`, so nothing outside this module needs to know the shape changed.
- Folder auto-delete-when-empty needs no separate invariant-checking code path: any store method that can remove a `Folder`'s last member (moving a project out, or deleting a project per FR-01) simply filters `entries` for `Folder`s with empty `members` afterward, or never re-inserts an emptied folder — a filter, not a sweep for referential integrity.
- Every `persist()` from now on writes the marker; the very next save after a legacy-format load silently upgrades the on-disk file to the new format — no explicit "migrate" user action, no separate migration command.
- The version byte is unused today beyond distinguishing "has a marker" from "doesn't" but exists so a *second* future format change (should one ever be needed) has a real discriminator to branch on, instead of repeating this ADR's marker-detection trick a second time.
- **Revisit trigger:** if a third on-disk shape is ever needed, add a new version number and a new match arm — the marker mechanism itself does not need to change again.
