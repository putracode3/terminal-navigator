// App-wide reactive state: lock status + the decrypted project list.
// Svelte 5 runes store — a single shared instance (module singleton).
import type { ProjectDto } from "$lib/api";

class AppStore {
	locked = $state(true);
	projects = $state<ProjectDto[]>([]);
	/** Held only in memory for the lifetime of the unlocked session, to
	 *  re-validate on import (ADR-0008); never persisted, never sent anywhere
	 *  except back to the same `unlock`/`import_config` IPC calls. */
	password = $state("");
	/** Manual full hide/show (v1.4 "Sidebar show/hide toggle") — layered on
	 *  top of, not replacing, the automatic breakpoint icon-rail collapse
	 *  that Sidebar.svelte's own CSS still handles independently. */
	sidebarHidden = $state(false);

	toggleSidebar() {
		this.sidebarHidden = !this.sidebarHidden;
	}

	unlockWith(password: string, projects: ProjectDto[]) {
		this.password = password;
		this.projects = projects;
		this.locked = false;
	}

	setProjects(projects: ProjectDto[]) {
		this.projects = projects;
	}

	upsertProject(project: ProjectDto) {
		const idx = this.projects.findIndex((p) => p.id === project.id);
		if (idx === -1) {
			this.projects = [...this.projects, project];
		} else {
			this.projects = this.projects.map((p, i) => (i === idx ? project : p));
		}
	}

	removeProject(id: string) {
		this.projects = this.projects.filter((p) => p.id !== id);
	}
}

export const appStore = new AppStore();
