import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/svelte";

const saveDialogMock = vi.fn();
const openDialogMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
	save: (...args: unknown[]) => saveDialogMock(...args),
	open: (...args: unknown[]) => openDialogMock(...args),
}));

const saveSettingsMock = vi.fn();
const exportConfigMock = vi.fn();
const importConfigMock = vi.fn();
vi.mock("$lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/api")>();
	return {
		...actual,
		saveSettings: (...args: unknown[]) => saveSettingsMock(...args),
		exportConfig: (...args: unknown[]) => exportConfigMock(...args),
		importConfig: (...args: unknown[]) => importConfigMock(...args),
	};
});

import SettingsModal from "./SettingsModal.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import { appStore } from "$lib/stores/app.svelte";
import { DEFAULT_KEYBINDINGS } from "$lib/keybindings";
import type { ProjectDto, SidebarEntryDto } from "$lib/api";

function projectEntry(overrides: Partial<ProjectDto> = {}): SidebarEntryDto {
	return { type: "project", id: "a", name: "demo", path: "/tmp/demo", setupCommands: [], notes: "", ...overrides };
}

beforeEach(() => {
	saveSettingsMock.mockReset();
	saveDialogMock.mockReset();
	openDialogMock.mockReset();
	exportConfigMock.mockReset();
	importConfigMock.mockReset();
	saveSettingsMock.mockImplementation(async (s) => s);
	settingsStore.themePreset = "app-default";
	settingsStore.keybindings = { ...DEFAULT_KEYBINDINGS };
	settingsStore.sidebarPosition = "left";
	settingsStore.themeMode = "dark";
	appStore.entries = [];
});

describe("SettingsModal — structure", () => {
	it("renders all five named section headings when open", () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Theme" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Keybindings" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Sidebar position" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Data" })).toBeInTheDocument();
	});

	it("renders one Theme Preset Card per preset, and a row per registry action", () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		expect(
			screen.getAllByRole("radio", {
				name: /App Default|Dracula|Nord|Solarized Dark|Solarized Light|GitHub Light/,
			}),
		).toHaveLength(6);
		expect(screen.getByText("Copy selection")).toBeInTheDocument();
		expect(screen.getByText("Move focus down")).toBeInTheDocument();
	});

	it("footer has exactly one Done button, not a Save/primary submit", () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
	});
});

describe("SettingsModal — appearance (autosaves immediately)", () => {
	it("selecting Light autosaves without a separate Save step", async () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("radio", { name: "Light" }));

		await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ themeMode: "light" })));
		expect(settingsStore.themeMode).toBe("light");
	});

	it("shows an error and reverts the selection when the save fails", async () => {
		saveSettingsMock.mockRejectedValueOnce(new Error("failed to read/write settings file"));
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("radio", { name: "System" }));

		expect(await screen.findByText("failed to read/write settings file")).toBeInTheDocument();
		await waitFor(() => expect(settingsStore.themeMode).toBe("dark")); // rolled back
	});
});

describe("SettingsModal — theme (autosaves immediately)", () => {
	it("selecting a preset autosaves without a separate Save step", async () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("radio", { name: /Dracula/ }));

		await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ themePreset: "dracula" })));
		expect(settingsStore.themePreset).toBe("dracula");
	});
});

describe("SettingsModal — App Default preset card is theme-aware (design.md §4.5a, §9 rule 11)", () => {
	it("renders App Default as ONE card in light chrome, never a second 'App Default Light' entry", () => {
		settingsStore.themeMode = "light";
		render(SettingsModal, { open: true, onClose: vi.fn() });

		expect(screen.getAllByRole("radio", { name: /App Default/ })).toHaveLength(1);
		expect(screen.queryByRole("radio", { name: /App Default Light/ })).toBeNull();
	});

	/** Invariant 1 at the UI level: whichever variant is previewed, selecting
	 *  the card must persist the plain "app-default" id — a theme-dependent id
	 *  would not round-trip when the user switches chrome themes. */
	it("persists the id 'app-default' when selected under light chrome", async () => {
		settingsStore.themeMode = "light";
		settingsStore.themePreset = "dracula";
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("radio", { name: /App Default/ }));

		await waitFor(() =>
			expect(saveSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ themePreset: "app-default" })),
		);
		expect(settingsStore.themePreset).toBe("app-default");
	});

	it("keeps App Default selected across a chrome-theme switch — the stored id never changed", async () => {
		settingsStore.themePreset = "app-default";
		settingsStore.themeMode = "dark";
		const { rerender } = render(SettingsModal, { open: true, onClose: vi.fn() });
		expect(screen.getByRole("radio", { name: /App Default/ })).toBeChecked();

		settingsStore.themeMode = "light";
		await rerender({ open: true, onClose: vi.fn() });

		expect(screen.getByRole("radio", { name: /App Default/ })).toBeChecked();
		expect(settingsStore.themePreset).toBe("app-default");
	});
});

describe("SettingsModal — sidebar position (autosaves immediately)", () => {
	it("toggling to Right autosaves", async () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("radio", { name: "Right" }));

		await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ sidebarPosition: "right" })));
		expect(settingsStore.sidebarPosition).toBe("right");
	});
});

describe("SettingsModal — keybinding conflict detection wiring", () => {
	it("rebinding an action to a combo already used elsewhere shows the OTHER action's real label", async () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		// Rebind "Copy selection" to Paste's own default combo (Ctrl+Shift+V) —
		// checkConflict should find "clipboard.paste" and report its real label,
		// not a generic "conflict" message.
		const copyRow = screen.getByText("Copy selection").closest("div")!;
		await fireEvent.click(within(copyRow).getByRole("button", { name: "Rebind" }));
		await fireEvent.keyDown(window, { key: "v", code: "KeyV", ctrlKey: true, shiftKey: true });

		expect(await screen.findByText("Already used by Paste")).toBeInTheDocument();
		expect(saveSettingsMock).not.toHaveBeenCalled();
	});

	it("rebinding to a free combo succeeds and the other action's binding is untouched", async () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		const copyRow = screen.getByText("Copy selection").closest("div")!;
		await fireEvent.click(within(copyRow).getByRole("button", { name: "Rebind" }));
		await fireEvent.keyDown(window, { key: "e", code: "KeyE", ctrlKey: true, shiftKey: true });

		await waitFor(() => expect(settingsStore.keybindings["clipboard.copy"]).toBe("Ctrl+Shift+E"));
		expect(settingsStore.keybindings["clipboard.paste"]).toBe("Ctrl+Shift+V");
	});
});

describe("SettingsModal — footer/close behavior", () => {
	it("Done button calls onClose", async () => {
		const onClose = vi.fn();
		render(SettingsModal, { open: true, onClose });

		await fireEvent.click(screen.getByRole("button", { name: "Done" }));

		expect(onClose).toHaveBeenCalledOnce();
	});
});

describe("SettingsModal — regression (code review m1): at most one Keybinding Row records at a time", () => {
	it("disables every other row's Rebind button while one row is recording", async () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		const copyRow = screen.getByText("Copy selection").closest("div")!;
		const pasteRow = screen.getByText("Paste").closest("div")!;
		await fireEvent.click(within(copyRow).getByRole("button", { name: "Rebind" }));

		expect(within(pasteRow).getByRole("button", { name: "Rebind" })).toBeDisabled();
	});

	it("re-enables other rows once recording ends (Cancel)", async () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		const copyRow = screen.getByText("Copy selection").closest("div")!;
		const pasteRow = screen.getByText("Paste").closest("div")!;
		await fireEvent.click(within(copyRow).getByRole("button", { name: "Rebind" }));
		await fireEvent.click(within(copyRow).getByRole("button", { name: "Cancel" }));

		expect(within(pasteRow).getByRole("button", { name: "Rebind" })).not.toBeDisabled();
	});
});

describe("SettingsModal — regression (code review m3): theme/sidebar save failures are surfaced", () => {
	it("shows an error and reverts the selection when a theme save fails", async () => {
		saveSettingsMock.mockRejectedValueOnce(new Error("failed to read/write settings file"));
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("radio", { name: /Dracula/ }));

		expect(await screen.findByText("failed to read/write settings file")).toBeInTheDocument();
		await waitFor(() => expect(settingsStore.themePreset).toBe("app-default")); // rolled back
	});

	it("shows an error when a sidebar-position save fails", async () => {
		saveSettingsMock.mockRejectedValueOnce(new Error("failed to read/write settings file"));
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("radio", { name: "Right" }));

		expect(await screen.findByText("failed to read/write settings file")).toBeInTheDocument();
	});
});

// v2.8: relocated from Sidebar.test.ts along with the Data group itself
// (components.md, Settings Panel).
describe("SettingsModal — Data group — export (FR-07)", () => {
	it("does nothing if the user cancels the save dialog", async () => {
		saveDialogMock.mockResolvedValue(null);
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Export" }));

		expect(exportConfigMock).not.toHaveBeenCalled();
	});

	it("exports to the chosen destination and shows a confirmation", async () => {
		saveDialogMock.mockResolvedValue("/tmp/backup.enc");
		exportConfigMock.mockResolvedValue(undefined);
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Export" }));

		expect(exportConfigMock).toHaveBeenCalledWith("/tmp/backup.enc");
		expect(await screen.findByText("Exported")).toBeInTheDocument();
	});

	it("shows the backend error when export fails", async () => {
		saveDialogMock.mockResolvedValue("/tmp/backup.enc");
		exportConfigMock.mockRejectedValue({ kind: "invalid_input", message: "Nothing to export yet." });
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Export" }));

		expect(await screen.findByText("Nothing to export yet.")).toBeInTheDocument();
	});
});

describe("SettingsModal — Data group — import (FR-07, ADR-0008 replace-only)", () => {
	it("does nothing if the user cancels the file picker", async () => {
		openDialogMock.mockResolvedValue(null);
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Import" }));

		expect(screen.queryByRole("dialog", { name: "Import project data" })).toBeNull();
	});

	it("shows a replace-data confirmation before importing", async () => {
		openDialogMock.mockResolvedValue("/tmp/incoming.enc");
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Import" }));

		expect(await screen.findByText(/This cannot be undone/i)).toBeInTheDocument();
		expect(importConfigMock).not.toHaveBeenCalled();
	});

	it("cancelling the confirmation does not call importConfig", async () => {
		openDialogMock.mockResolvedValue("/tmp/incoming.enc");
		render(SettingsModal, { open: true, onClose: vi.fn() });
		await fireEvent.click(screen.getByRole("button", { name: "Import" }));
		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(importConfigMock).not.toHaveBeenCalled();
	});

	it("confirming imports the chosen file and replaces the project list", async () => {
		openDialogMock.mockResolvedValue("/tmp/incoming.enc");
		const imported: SidebarEntryDto[] = [projectEntry({ id: "x", name: "imported-project", path: "/tmp/x" })];
		importConfigMock.mockResolvedValue(imported);
		appStore.entries = [projectEntry({ id: "old", name: "old-project", path: "/tmp/old" })];

		render(SettingsModal, { open: true, onClose: vi.fn() });
		await fireEvent.click(screen.getByRole("button", { name: "Import" }));
		await fireEvent.click(screen.getByRole("button", { name: "Replace and import" }));

		expect(importConfigMock).toHaveBeenCalledWith("/tmp/incoming.enc");
		expect(appStore.entries).toEqual(imported);
	});

	it("shows the backend error when import validation fails (malformed file)", async () => {
		openDialogMock.mockResolvedValue("/tmp/incoming.enc");
		importConfigMock.mockRejectedValue({
			kind: "invalid_input",
			message: "Import file could not be decrypted.",
		});

		render(SettingsModal, { open: true, onClose: vi.fn() });
		await fireEvent.click(screen.getByRole("button", { name: "Import" }));
		await fireEvent.click(screen.getByRole("button", { name: "Replace and import" }));

		expect(await screen.findByText("Import file could not be decrypted.")).toBeInTheDocument();
	});
});

describe("SettingsModal — Data group — transient error banner lifecycle", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("auto-dismisses a sync error after its display window elapses", async () => {
		saveDialogMock.mockResolvedValue("/tmp/backup.enc");
		exportConfigMock.mockRejectedValue({ kind: "invalid_input", message: "Nothing to export yet." });
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Export" }));
		await vi.advanceTimersByTimeAsync(0);
		expect(screen.getByText("Nothing to export yet.")).toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(8000);

		expect(screen.queryByText("Nothing to export yet.")).toBeNull();
	});

	it("can be dismissed immediately, without waiting out the timeout", async () => {
		saveDialogMock.mockResolvedValue("/tmp/backup.enc");
		exportConfigMock.mockRejectedValue({ kind: "invalid_input", message: "Nothing to export yet." });
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Export" }));
		await vi.advanceTimersByTimeAsync(0);

		await fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));

		expect(screen.queryByText("Nothing to export yet.")).toBeNull();
	});

	it("a later successful operation clears a still-visible error rather than leaving it stacked under a success message", async () => {
		saveDialogMock.mockResolvedValue("/tmp/backup.enc");
		exportConfigMock.mockRejectedValueOnce({ kind: "invalid_input", message: "Nothing to export yet." });
		render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Export" }));
		await vi.advanceTimersByTimeAsync(0);
		expect(screen.getByText("Nothing to export yet.")).toBeInTheDocument();

		exportConfigMock.mockResolvedValueOnce(undefined);
		await fireEvent.click(screen.getByRole("button", { name: "Export" }));
		await vi.advanceTimersByTimeAsync(0);

		expect(screen.queryByText("Nothing to export yet.")).toBeNull();
		expect(screen.getByText("Exported")).toBeInTheDocument();
	});
});

describe("SettingsModal — Data group resets when the modal is reopened (v2.8)", () => {
	it("does not carry a stale success flash or error into the next time the modal opens", async () => {
		saveDialogMock.mockResolvedValue("/tmp/backup.enc");
		exportConfigMock.mockResolvedValue(undefined);
		const { rerender } = render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.click(screen.getByRole("button", { name: "Export" }));
		expect(await screen.findByText("Exported")).toBeInTheDocument();

		await rerender({ open: false, onClose: vi.fn() });
		await rerender({ open: true, onClose: vi.fn() });

		expect(screen.queryByText("Exported")).toBeNull();
	});
});
