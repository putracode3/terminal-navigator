import { describe, it, expect, beforeEach } from "vitest";
import { appStore } from "./app.svelte";
import type { ProjectDto, SidebarEntryDto, FolderDto } from "$lib/api";

function project(overrides: Partial<ProjectDto> = {}): ProjectDto {
	return {
		id: "id-1",
		name: "demo",
		path: "/tmp/demo",
		setupCommands: [],
		notes: "",
		...overrides,
	};
}

function projectEntry(overrides: Partial<ProjectDto> = {}): SidebarEntryDto {
	return { type: "project", ...project(overrides) };
}

function folderEntry(overrides: Partial<FolderDto> = {}): SidebarEntryDto {
	return { type: "folder", id: "folder-1", name: "My Folder", members: [], ...overrides };
}

// appStore is a module-level singleton — reset it before every test so
// tests never depend on execution order (qa-tester principle 5).
beforeEach(() => {
	appStore.ready = false;
	appStore.needsMigration = false;
	appStore.entries = [];
	appStore.sidebarHidden = false;
	appStore.sidebarDrag = null;
});

describe("appStore", () => {
	it("starts not ready with no entries", () => {
		expect(appStore.ready).toBe(false);
		expect(appStore.needsMigration).toBe(false);
		expect(appStore.entries).toEqual([]);
		expect(appStore.allProjects).toEqual([]);
	});

	it("finishLoading() marks ready, clears needsMigration, and sets the sidebar tree", () => {
		appStore.needsMigration = true;
		const entries = [projectEntry({ id: "a" }), projectEntry({ id: "b" })];
		appStore.finishLoading(entries);

		expect(appStore.ready).toBe(true);
		expect(appStore.needsMigration).toBe(false);
		expect(appStore.entries).toEqual(entries);
	});

	it("setNeedsMigration() flags migration without touching entries/ready", () => {
		appStore.setNeedsMigration();
		expect(appStore.needsMigration).toBe(true);
		expect(appStore.ready).toBe(false);
	});

	it("setEntries() replaces the tree wholesale", () => {
		appStore.setEntries([projectEntry({ id: "a" })]);
		appStore.setEntries([projectEntry({ id: "b" })]);
		expect(appStore.entries.map((e) => e.id)).toEqual(["b"]);
	});

	describe("allProjects — flattens top-level projects and every folder's members", () => {
		it("returns only top-level projects when there are no folders", () => {
			appStore.setEntries([projectEntry({ id: "a" }), projectEntry({ id: "b" })]);
			expect(appStore.allProjects.map((p) => p.id)).toEqual(["a", "b"]);
		});

		it("includes projects nested inside folders alongside top-level ones", () => {
			appStore.setEntries([
				projectEntry({ id: "a" }),
				folderEntry({ id: "f1", members: [project({ id: "b" }), project({ id: "c" })] }),
			]);
			expect(appStore.allProjects.map((p) => p.id)).toEqual(["a", "b", "c"]);
		});
	});

	describe("homeProject — FR-01 seeded entry lookup for launch auto-open", () => {
		it("returns null when there are no entries yet", () => {
			expect(appStore.homeProject).toBeNull();
		});

		it("finds a top-level project named 'Home'", () => {
			appStore.setEntries([projectEntry({ id: "a", name: "not-home" }), projectEntry({ id: "b", name: "Home" })]);
			expect(appStore.homeProject?.id).toBe("b");
		});

		it("finds a 'Home' project nested inside a folder", () => {
			appStore.setEntries([folderEntry({ members: [project({ id: "b", name: "Home" })] })]);
			expect(appStore.homeProject?.id).toBe("b");
		});

		it("returns null once the seeded entry has been deleted (FR-01: not protected afterward)", () => {
			appStore.setEntries([projectEntry({ id: "a", name: "not-home" })]);
			expect(appStore.homeProject).toBeNull();
		});

		it("returns null once the seeded entry has been renamed (FR-01: not specially tracked)", () => {
			appStore.setEntries([projectEntry({ id: "a", name: "renamed" })]);
			expect(appStore.homeProject).toBeNull();
		});
	});

	describe("upsertProject()", () => {
		it("appends a brand-new project at top level", () => {
			appStore.setEntries([projectEntry({ id: "a" })]);
			appStore.upsertProject(project({ id: "b", name: "new one" }));

			expect(appStore.entries.map((e) => e.id)).toEqual(["a", "b"]);
			expect(appStore.entries[1]).toEqual(projectEntry({ id: "b", name: "new one" }));
		});

		it("replaces an existing top-level project in place, preserving order", () => {
			appStore.setEntries([projectEntry({ id: "a" }), projectEntry({ id: "b" }), projectEntry({ id: "c" })]);
			appStore.upsertProject(project({ id: "b", name: "renamed" }));

			expect(appStore.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
			expect((appStore.entries[1] as { name: string }).name).toBe("renamed");
		});

		it("replaces a project nested inside a folder in place, without touching its siblings", () => {
			appStore.setEntries([
				folderEntry({ id: "f1", members: [project({ id: "a" }), project({ id: "b" })] }),
			]);
			appStore.upsertProject(project({ id: "a", name: "renamed" }));

			const folder = appStore.entries[0] as FolderDto & { type: "folder" };
			expect(folder.members.map((m) => m.name)).toEqual(["renamed", "demo"]);
		});
	});

	describe("removeProject()", () => {
		it("removes exactly the matching top-level project", () => {
			appStore.setEntries([projectEntry({ id: "a" }), projectEntry({ id: "b" })]);
			appStore.removeProject("a");

			expect(appStore.entries.map((e) => e.id)).toEqual(["b"]);
		});

		it("with an unknown id is a no-op", () => {
			appStore.setEntries([projectEntry({ id: "a" })]);
			appStore.removeProject("does-not-exist");

			expect(appStore.entries.map((e) => e.id)).toEqual(["a"]);
		});

		it("removes a project nested inside a folder, leaving the folder intact if members remain", () => {
			appStore.setEntries([
				folderEntry({ id: "f1", members: [project({ id: "a" }), project({ id: "b" })] }),
			]);
			appStore.removeProject("a");

			const folder = appStore.entries[0] as FolderDto & { type: "folder" };
			expect(folder.members.map((m) => m.id)).toEqual(["b"]);
		});

		it("prunes a folder client-side the instant its last member is removed (mirrors the backend invariant)", () => {
			appStore.setEntries([
				projectEntry({ id: "outside" }),
				folderEntry({ id: "f1", members: [project({ id: "a" })] }),
			]);
			appStore.removeProject("a");

			expect(appStore.entries.map((e) => e.id)).toEqual(["outside"]);
		});
	});

	describe("sidebar drag tracking (FR-11)", () => {
		it("starts null", () => {
			expect(appStore.sidebarDrag).toBeNull();
		});

		it("startDraggingSidebarEntry() records the kind and id", () => {
			appStore.startDraggingSidebarEntry("project", "proj-1");
			expect(appStore.sidebarDrag).toEqual({ kind: "project", id: "proj-1" });
		});

		it("stopDraggingSidebarEntry() clears it", () => {
			appStore.startDraggingSidebarEntry("folder", "folder-1");
			appStore.stopDraggingSidebarEntry();
			expect(appStore.sidebarDrag).toBeNull();
		});
	});

	it("toggleSidebar() flips sidebarHidden each call", () => {
		expect(appStore.sidebarHidden).toBe(false);
		appStore.toggleSidebar();
		expect(appStore.sidebarHidden).toBe(true);
		appStore.toggleSidebar();
		expect(appStore.sidebarHidden).toBe(false);
	});
});
