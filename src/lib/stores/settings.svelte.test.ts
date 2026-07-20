import { describe, it, expect, vi, beforeEach } from "vitest";

const getSettingsMock = vi.fn();
vi.mock("$lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/api")>();
	return {
		...actual,
		getSettings: (...args: unknown[]) => getSettingsMock(...args),
	};
});

import { settingsStore } from "./settings.svelte";
import { DEFAULT_KEYBINDINGS } from "$lib/keybindings";
import type { SettingsDto } from "$lib/api";

function dto(overrides: Partial<SettingsDto> = {}): SettingsDto {
	return {
		themePreset: "app-default",
		keybindings: { ...DEFAULT_KEYBINDINGS },
		sidebarPosition: "left",
		...overrides,
	};
}

beforeEach(() => {
	getSettingsMock.mockReset();
	// Reset the singleton back to its as-constructed defaults — load()'s own
	// job is exactly to move it away from these, so tests must start here.
	settingsStore.themePreset = "app-default";
	settingsStore.keybindings = { ...DEFAULT_KEYBINDINGS };
	settingsStore.sidebarPosition = "left";
	settingsStore.loaded = false;
});

describe("settingsStore — construction (before load() ever runs)", () => {
	it("starts with real defaults, not empty placeholders, so e.g. clipboard shortcuts work before load() resolves", () => {
		expect(settingsStore.themePreset).toBe("app-default");
		expect(settingsStore.keybindings).toEqual(DEFAULT_KEYBINDINGS);
		expect(settingsStore.sidebarPosition).toBe("left");
		expect(settingsStore.loaded).toBe(false);
	});
});

describe("settingsStore.load()", () => {
	it("applies every field from getSettings() and flips loaded to true", async () => {
		getSettingsMock.mockResolvedValue(
			dto({ themePreset: "dracula", sidebarPosition: "right", keybindings: { ...DEFAULT_KEYBINDINGS, "clipboard.copy": "Ctrl+Alt+C" } }),
		);

		await settingsStore.load();

		expect(settingsStore.themePreset).toBe("dracula");
		expect(settingsStore.sidebarPosition).toBe("right");
		expect(settingsStore.keybindings["clipboard.copy"]).toBe("Ctrl+Alt+C");
		expect(settingsStore.loaded).toBe(true);
	});

	it("overwrites whatever was already in the store, not just fills gaps (replace, not merge)", async () => {
		settingsStore.themePreset = "nord";
		settingsStore.sidebarPosition = "right";
		getSettingsMock.mockResolvedValue(dto({ themePreset: "solarized-dark", sidebarPosition: "left" }));

		await settingsStore.load();

		expect(settingsStore.themePreset).toBe("solarized-dark");
		expect(settingsStore.sidebarPosition).toBe("left");
	});

	it("calls getSettings() with no arguments (load() takes none itself, per NFR-8 — callable before unlock)", async () => {
		getSettingsMock.mockResolvedValue(dto());

		await settingsStore.load();

		expect(getSettingsMock).toHaveBeenCalledWith();
	});

	it("leaves loaded false and the previous values untouched if getSettings() rejects", async () => {
		settingsStore.themePreset = "nord";
		getSettingsMock.mockRejectedValue(new Error("IPC failure"));

		await expect(settingsStore.load()).rejects.toThrow("IPC failure");

		expect(settingsStore.loaded).toBe(false);
		expect(settingsStore.themePreset).toBe("nord");
	});
});
