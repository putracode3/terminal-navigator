import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const addProjectMock = vi.fn();
const updateProjectMock = vi.fn();
vi.mock("$lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/api")>();
	return {
		...actual,
		addProject: (...args: unknown[]) => addProjectMock(...args),
		updateProject: (...args: unknown[]) => updateProjectMock(...args),
	};
});

import ProjectFormModal from "./ProjectFormModal.svelte";
import { appStore } from "$lib/stores/app.svelte";
import type { ProjectDto } from "$lib/api";

const existingProject: ProjectDto = {
	id: "proj-1",
	name: "existing-project",
	path: "/home/user/existing-project",
	setupCommands: ["nvm use", "docker-compose up"],
	notes: "some notes",
};

beforeEach(() => {
	addProjectMock.mockReset();
	updateProjectMock.mockReset();
	appStore.projects = [];
});

describe("ProjectFormModal — add mode", () => {
	it("saves with the entered fields, splitting setup commands one-per-line and trimming blanks", async () => {
		const onClose = vi.fn();
		const saved: ProjectDto = { ...existingProject, id: "new-id", name: "new-project" };
		addProjectMock.mockResolvedValue(saved);

		render(ProjectFormModal, { open: true, onClose });

		await fireEvent.input(screen.getByLabelText("Name"), { target: { value: "new-project" } });
		await fireEvent.input(screen.getByLabelText("Path"), { target: { value: "/tmp/new-project" } });
		await fireEvent.input(screen.getByLabelText("Setup commands (one per line)"), {
			target: { value: "nvm use\n\n  \ndocker-compose up\n" },
		});
		await fireEvent.input(screen.getByLabelText("Notes"), { target: { value: "n" } });

		await fireEvent.click(screen.getByRole("button", { name: "Save project" }));

		expect(addProjectMock).toHaveBeenCalledWith({
			name: "new-project",
			path: "/tmp/new-project",
			setupCommands: ["nvm use", "docker-compose up"],
			notes: "n",
		});
		expect(updateProjectMock).not.toHaveBeenCalled();
	});

	it("adds the saved project to appStore and closes on success", async () => {
		const onClose = vi.fn();
		const saved: ProjectDto = { ...existingProject, id: "new-id" };
		addProjectMock.mockResolvedValue(saved);

		render(ProjectFormModal, { open: true, onClose });
		await fireEvent.input(screen.getByLabelText("Name"), { target: { value: "x" } });
		await fireEvent.click(screen.getByRole("button", { name: "Save project" }));

		expect(appStore.projects.map((p) => p.id)).toContain("new-id");
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("shows the backend error and does not close when save fails", async () => {
		const onClose = vi.fn();
		addProjectMock.mockRejectedValue({ kind: "invalid_input", message: "This path doesn't exist." });

		render(ProjectFormModal, { open: true, onClose });
		await fireEvent.click(screen.getByRole("button", { name: "Save project" }));

		expect(await screen.findByText("This path doesn't exist.")).toBeInTheDocument();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("backdrop click closes the modal before any field has been edited (pristine)", async () => {
		const onClose = vi.fn();
		const { container } = render(ProjectFormModal, { open: true, onClose });

		await fireEvent.click(container.querySelector(".backdrop")!);

		expect(onClose).toHaveBeenCalledOnce();
	});

	it("backdrop click does NOT close the modal once a field has been edited (dirty)", async () => {
		const onClose = vi.fn();
		const { container } = render(ProjectFormModal, { open: true, onClose });

		await fireEvent.input(screen.getByLabelText("Name"), { target: { value: "something" } });
		await fireEvent.click(container.querySelector(".backdrop")!);

		expect(onClose).not.toHaveBeenCalled();
	});
});

describe("ProjectFormModal — edit mode", () => {
	it("prefills fields from the given project, joining setup commands with newlines", () => {
		render(ProjectFormModal, { open: true, onClose: vi.fn(), project: existingProject });

		expect(screen.getByLabelText("Name")).toHaveValue("existing-project");
		expect(screen.getByLabelText("Path")).toHaveValue("/home/user/existing-project");
		expect(screen.getByLabelText("Setup commands (one per line)")).toHaveValue(
			"nvm use\ndocker-compose up",
		);
		expect(screen.getByLabelText("Notes")).toHaveValue("some notes");
	});

	it("calls updateProject with the project's id, not addProject", async () => {
		const saved = { ...existingProject, name: "renamed" };
		updateProjectMock.mockResolvedValue(saved);

		render(ProjectFormModal, { open: true, onClose: vi.fn(), project: existingProject });
		await fireEvent.input(screen.getByLabelText("Name"), { target: { value: "renamed" } });
		await fireEvent.click(screen.getByRole("button", { name: "Save project" }));

		expect(updateProjectMock).toHaveBeenCalledWith(
			"proj-1",
			expect.objectContaining({ name: "renamed" }),
		);
		expect(addProjectMock).not.toHaveBeenCalled();
	});

	it("shows the dialog title 'Edit project'", () => {
		render(ProjectFormModal, { open: true, onClose: vi.fn(), project: existingProject });
		expect(screen.getByText("Edit project")).toBeInTheDocument();
	});
});
