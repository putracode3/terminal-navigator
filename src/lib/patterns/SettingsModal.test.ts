import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/svelte";

const saveSettingsMock = vi.fn();
const changeMasterPasswordMock = vi.fn();
vi.mock("$lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/api")>();
	return {
		...actual,
		saveSettings: (...args: unknown[]) => saveSettingsMock(...args),
		changeMasterPassword: (...args: unknown[]) => changeMasterPasswordMock(...args),
	};
});

import SettingsModal from "./SettingsModal.svelte";
import { settingsStore } from "$lib/stores/settings.svelte";
import { DEFAULT_KEYBINDINGS } from "$lib/keybindings";

beforeEach(() => {
	saveSettingsMock.mockReset();
	changeMasterPasswordMock.mockReset();
	saveSettingsMock.mockImplementation(async (s) => s);
	settingsStore.themePreset = "app-default";
	settingsStore.keybindings = { ...DEFAULT_KEYBINDINGS };
	settingsStore.sidebarPosition = "left";
});

describe("SettingsModal — structure", () => {
	it("renders all four section headings when open", () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		expect(screen.getByRole("heading", { name: "Theme" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Master password" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Keybindings" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Sidebar position" })).toBeInTheDocument();
	});

	it("renders one Theme Preset Card per preset, and a row per registry action", () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		expect(screen.getAllByRole("radio", { name: /App Default|Dracula|Nord|Solarized Dark/ })).toHaveLength(4);
		expect(screen.getByText("Copy selection")).toBeInTheDocument();
		expect(screen.getByText("Move focus down")).toBeInTheDocument();
	});

	it("footer has exactly one Done button, not a Save/primary submit", () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
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

describe("SettingsModal — master password change", () => {
	function fillPasswordForm(current: string, next: string, confirm: string) {
		fireEvent.input(screen.getByLabelText("Current password"), { target: { value: current } });
		fireEvent.input(screen.getByLabelText("New password"), { target: { value: next } });
		fireEvent.input(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
	}

	it("shows a client-side error when new/confirm don't match, without calling the backend", async () => {
		render(SettingsModal, { open: true, onClose: vi.fn() });

		fillPasswordForm("old-pw", "new-pw", "typo-pw");
		await fireEvent.click(screen.getByRole("button", { name: "Change password" }));

		expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
		expect(changeMasterPasswordMock).not.toHaveBeenCalled();
	});

	it("calls changeMasterPassword and shows success, clearing the fields", async () => {
		changeMasterPasswordMock.mockResolvedValue(undefined);
		render(SettingsModal, { open: true, onClose: vi.fn() });

		fillPasswordForm("old-pw", "new-pw", "new-pw");
		await fireEvent.click(screen.getByRole("button", { name: "Change password" }));

		await waitFor(() => expect(changeMasterPasswordMock).toHaveBeenCalledWith("old-pw", "new-pw"));
		expect(await screen.findByText("Password changed")).toBeInTheDocument();
		expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
	});

	it("shows 'Current password is incorrect' on the Current password field when the backend rejects it", async () => {
		changeMasterPasswordMock.mockRejectedValue({ kind: "wrong_password", message: "current password is incorrect" });
		render(SettingsModal, { open: true, onClose: vi.fn() });

		fillPasswordForm("wrong-old-pw", "new-pw", "new-pw");
		await fireEvent.click(screen.getByRole("button", { name: "Change password" }));

		expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
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

describe("SettingsModal — regression (code review m2): password fields reset when reopened", () => {
	it("clears typed password text and errors when the modal is closed and reopened without submitting", async () => {
		const { rerender } = render(SettingsModal, { open: true, onClose: vi.fn() });

		await fireEvent.input(screen.getByLabelText("Current password"), { target: { value: "typed-but-not-submitted" } });
		expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("typed-but-not-submitted");

		await rerender({ open: false, onClose: vi.fn() });
		await rerender({ open: true, onClose: vi.fn() });

		expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
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
