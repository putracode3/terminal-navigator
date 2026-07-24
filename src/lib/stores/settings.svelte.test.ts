import { describe, it, expect, vi, beforeEach } from "vitest";

const getSettingsMock = vi.fn();
const saveSettingsMock = vi.fn();
vi.mock("$lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/api")>();
	return {
		...actual,
		getSettings: (...args: unknown[]) => getSettingsMock(...args),
		saveSettings: (...args: unknown[]) => saveSettingsMock(...args),
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
		glassIntensity: 0,
		windowTransparency: 0,
		themeMode: "dark",
		...overrides,
	};
}

beforeEach(() => {
	getSettingsMock.mockReset();
	saveSettingsMock.mockReset();
	saveSettingsMock.mockResolvedValue(undefined);
	// Reset the singleton back to its as-constructed defaults — load()'s own
	// job is exactly to move it away from these, so tests must start here.
	settingsStore.themePreset = "app-default";
	settingsStore.keybindings = { ...DEFAULT_KEYBINDINGS };
	settingsStore.sidebarPosition = "left";
	settingsStore.glassIntensity = 0;
	settingsStore.windowTransparency = 0;
	settingsStore.themeMode = "dark";
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

describe("settingsStore.setGlassIntensity() — FR-14", () => {
	it("clamps out-of-range values into 0..1 rather than passing them through", async () => {
		await settingsStore.setGlassIntensity(1.7);
		expect(settingsStore.glassIntensity).toBe(1);

		await settingsStore.setGlassIntensity(-0.4);
		expect(settingsStore.glassIntensity).toBe(0);

		// The clamped value — not the caller's raw one — is what gets persisted.
		expect(saveSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ glassIntensity: 0 }));
	});

	it("rolls the value back when the save fails, so the UI never shows an unpersisted setting", async () => {
		await settingsStore.setGlassIntensity(0.5);
		saveSettingsMock.mockRejectedValueOnce(new Error("disk full"));

		await expect(settingsStore.setGlassIntensity(0.9)).rejects.toThrow("disk full");

		expect(settingsStore.glassIntensity).toBe(0.5);
	});

	it("round-trips through load() like every other field", async () => {
		getSettingsMock.mockResolvedValue(dto({ glassIntensity: 0.35 }));

		await settingsStore.load();

		expect(settingsStore.glassIntensity).toBe(0.35);
	});
});

describe("settingsStore.setThemeMode() — design.md §4.1a, v2.5", () => {
	it("applies immediately and persists", async () => {
		await settingsStore.setThemeMode("light");

		expect(settingsStore.themeMode).toBe("light");
		expect(saveSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ themeMode: "light" }));
	});

	it("rolls back when the save fails, same as every other autosaving setter", async () => {
		await settingsStore.setThemeMode("light");
		saveSettingsMock.mockRejectedValueOnce(new Error("disk full"));

		await expect(settingsStore.setThemeMode("system")).rejects.toThrow("disk full");

		expect(settingsStore.themeMode).toBe("light");
	});

	it("round-trips through load() like every other field", async () => {
		getSettingsMock.mockResolvedValue(dto({ themeMode: "system" }));

		await settingsStore.load();

		expect(settingsStore.themeMode).toBe("system");
	});
});

describe("settingsStore.setWindowTransparency() — FR-15", () => {
	it("clamps out-of-range values into 0..1", async () => {
		await settingsStore.setWindowTransparency(2.5);
		expect(settingsStore.windowTransparency).toBe(1);

		await settingsStore.setWindowTransparency(-1);
		expect(settingsStore.windowTransparency).toBe(0);
		expect(saveSettingsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ windowTransparency: 0 }),
		);
	});

	it("rolls back when the save fails", async () => {
		await settingsStore.setWindowTransparency(0.4);
		saveSettingsMock.mockRejectedValueOnce(new Error("disk full"));

		await expect(settingsStore.setWindowTransparency(0.8)).rejects.toThrow("disk full");

		expect(settingsStore.windowTransparency).toBe(0.4);
	});

	it("is independent of glass intensity — ADR-0012 keeps the two effects separate", async () => {
		await settingsStore.setGlassIntensity(0.9);
		await settingsStore.setWindowTransparency(0.3);

		expect(settingsStore.glassIntensity).toBe(0.9);
		expect(settingsStore.windowTransparency).toBe(0.3);
		expect(saveSettingsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ glassIntensity: 0.9, windowTransparency: 0.3 }),
		);
	});
});
