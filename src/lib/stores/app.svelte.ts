// App-wide reactive state: load status + the sidebar tree (projects and,
// since FR-11, folders). Svelte 5 runes store — a single shared instance
// (module singleton). ADR-0014 removed the lock/unlock state machine —
// `ready`/`needsMigration` below replace it with a one-time startup
// sequence instead of a persistent security gate.
import type { ProjectDto, SidebarEntryDto } from "$lib/api";

/** FR-11: the sidebar-internal drag currently in progress (folder
 * create/join/reorder), or null. Deliberately separate from
 * `terminalStore.dragSource` (drag-to-split, targeting terminal panes) — the
 * same physical drag can set both at once, disambiguated entirely by what
 * kind of element it ends up dropped on (a pane vs. another sidebar row). */
export type SidebarDragKind = "project" | "folder";
export interface SidebarDragSource {
	kind: SidebarDragKind;
	id: string;
}

/** Every project in the tree, top-level and folder-nested alike, in display
 * order — for consumers that genuinely need "every project regardless of
 * grouping" (duplicate-path checks, path-validity checks), not the tree
 * shape itself. */
function flattenProjects(entries: SidebarEntryDto[]): ProjectDto[] {
	const result: ProjectDto[] = [];
	for (const entry of entries) {
		if (entry.type === "project") {
			result.push(entry);
		} else {
			result.push(...entry.members);
		}
	}
	return result;
}

/** Replaces a project wherever it currently lives (top-level or inside a
 * folder) — mirrors `find_project_mut`'s reach in the Rust store. */
function replaceProject(entries: SidebarEntryDto[], updated: ProjectDto): SidebarEntryDto[] {
	return entries.map((entry) => {
		if (entry.type === "project") {
			return entry.id === updated.id ? { ...updated, type: "project" as const } : entry;
		}
		return { ...entry, members: entry.members.map((m) => (m.id === updated.id ? updated : m)) };
	});
}

/** Removes a project wherever it lives, pruning a folder that becomes empty
 * as a result — mirrors `remove_project_by_id`'s invariant client-side too,
 * so the UI doesn't show a stale empty folder until the next full reload. */
function removeProjectEntry(entries: SidebarEntryDto[], id: string): SidebarEntryDto[] {
	return entries
		.filter((entry) => !(entry.type === "project" && entry.id === id))
		.map((entry) =>
			entry.type === "folder" ? { ...entry, members: entry.members.filter((m) => m.id !== id) } : entry,
		)
		.filter((entry) => !(entry.type === "folder" && entry.members.length === 0));
}

/** A project not yet present anywhere in the tree is a brand-new one (via
 * `add_project`) — it always starts ungrouped at top level, mirroring the
 * Rust store's own `add()`, which only ever pushes a fresh top-level entry. */
function upsertProjectEntries(entries: SidebarEntryDto[], project: ProjectDto): SidebarEntryDto[] {
	const exists = flattenProjects(entries).some((p) => p.id === project.id);
	if (!exists) return [...entries, { ...project, type: "project" as const }];
	return replaceProject(entries, project);
}

class AppStore {
	/** True once `initStore`/`migrateAndLoad` has resolved and `entries`
	 *  reflects real data — replaces the old `locked` flag (ADR-0014). */
	ready = $state(false);
	/** True when `initStore` reported the data file is still in the
	 *  pre-ADR-0014 encrypted format — the app should show a one-time
	 *  migration prompt instead of the normal shell until this resolves. */
	needsMigration = $state(false);
	entries = $state<SidebarEntryDto[]>([]);
	/** Manual full hide/show (v1.4 "Sidebar show/hide toggle") — layered on
	 *  top of, not replacing, the automatic breakpoint icon-rail collapse
	 *  that Sidebar.svelte's own CSS still handles independently. */
	sidebarHidden = $state(false);
	sidebarDrag = $state<SidebarDragSource | null>(null);
	/** v2.8: the project search query. Lives here (not local to a single
	 *  component) because the Title Bar owns the search `Input` while
	 *  `Sidebar` owns the filtered list it drives — the same
	 *  shared-cross-pane-state role `sidebarHidden` already plays. */
	search = $state("");

	/** Every project regardless of folder membership — see `flattenProjects`. */
	get allProjects(): ProjectDto[] {
		return flattenProjects(this.entries);
	}

	/** The FR-01 seeded "Home" entry, found by name like any other project
	 *  lookup — it isn't protected or specially tracked (FR-01 edge cases:
	 *  editable, deletable, renamable like any entry). `null` once the user
	 *  has deleted or renamed it, which is a normal, non-error state for
	 *  callers (e.g. launch auto-open) to just no-op on. */
	get homeProject(): ProjectDto | null {
		return this.allProjects.find((p) => p.name === "Home") ?? null;
	}

	toggleSidebar() {
		this.sidebarHidden = !this.sidebarHidden;
	}

	/** ADR-0014: called after either `initStore` or `migrateAndLoad`
	 *  resolves — same end state either way, so one method covers both. */
	finishLoading(entries: SidebarEntryDto[]) {
		this.entries = entries;
		this.ready = true;
		this.needsMigration = false;
	}

	setNeedsMigration() {
		this.needsMigration = true;
	}

	setEntries(entries: SidebarEntryDto[]) {
		this.entries = entries;
	}

	upsertProject(project: ProjectDto) {
		this.entries = upsertProjectEntries(this.entries, project);
	}

	removeProject(id: string) {
		this.entries = removeProjectEntry(this.entries, id);
	}

	/** FR-11: the same physical sidebar-row drag that may also be feeding
	 *  `terminalStore.dragSource` for drag-to-split — see this field's own
	 *  doc comment for why the two stay separate. */
	startDraggingSidebarEntry(kind: SidebarDragKind, id: string) {
		this.sidebarDrag = { kind, id };
	}

	stopDraggingSidebarEntry() {
		this.sidebarDrag = null;
	}
}

export const appStore = new AppStore();
