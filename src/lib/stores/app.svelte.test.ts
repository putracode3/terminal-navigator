import { describe, it, expect, beforeEach } from "vitest";
import { appStore } from "./app.svelte";
import type { ProjectDto } from "$lib/api";

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

// appStore is a module-level singleton — reset it before every test so
// tests never depend on execution order (qa-tester principle 5).
beforeEach(() => {
	appStore.locked = true;
	appStore.projects = [];
	appStore.password = "";
	appStore.sidebarHidden = false;
});

describe("appStore", () => {
	it("starts locked with no projects", () => {
		expect(appStore.locked).toBe(true);
		expect(appStore.projects).toEqual([]);
	});

	it("unlockWith() unlocks, stores the password, and sets the project list", () => {
		const projects = [project({ id: "a" }), project({ id: "b" })];
		appStore.unlockWith("hunter2", projects);

		expect(appStore.locked).toBe(false);
		expect(appStore.password).toBe("hunter2");
		expect(appStore.projects).toEqual(projects);
	});

	it("setProjects() replaces the list wholesale", () => {
		appStore.setProjects([project({ id: "a" })]);
		appStore.setProjects([project({ id: "b" })]);
		expect(appStore.projects.map((p) => p.id)).toEqual(["b"]);
	});

	it("upsertProject() appends a new project not already in the list", () => {
		appStore.setProjects([project({ id: "a" })]);
		appStore.upsertProject(project({ id: "b", name: "new one" }));

		expect(appStore.projects.map((p) => p.id)).toEqual(["a", "b"]);
	});

	it("upsertProject() replaces an existing project in place, preserving order", () => {
		appStore.setProjects([project({ id: "a" }), project({ id: "b" }), project({ id: "c" })]);
		appStore.upsertProject(project({ id: "b", name: "renamed" }));

		expect(appStore.projects.map((p) => p.id)).toEqual(["a", "b", "c"]);
		expect(appStore.projects[1].name).toBe("renamed");
	});

	it("removeProject() removes exactly the matching project", () => {
		appStore.setProjects([project({ id: "a" }), project({ id: "b" })]);
		appStore.removeProject("a");

		expect(appStore.projects.map((p) => p.id)).toEqual(["b"]);
	});

	it("removeProject() with an unknown id is a no-op", () => {
		appStore.setProjects([project({ id: "a" })]);
		appStore.removeProject("does-not-exist");

		expect(appStore.projects.map((p) => p.id)).toEqual(["a"]);
	});

	it("toggleSidebar() flips sidebarHidden each call", () => {
		expect(appStore.sidebarHidden).toBe(false);
		appStore.toggleSidebar();
		expect(appStore.sidebarHidden).toBe(true);
		appStore.toggleSidebar();
		expect(appStore.sidebarHidden).toBe(false);
	});
});
