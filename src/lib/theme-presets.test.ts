import { describe, it, expect } from "vitest";
import { THEME_PRESETS, getThemePreset, withWindowTransparency } from "./theme-presets";

const REQUIRED_ANSI_SLOTS = [
	"black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
	"brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

describe("THEME_PRESETS (design.md §4.5)", () => {
	it("has exactly the 4 presets design.md resolves PRD Q6 with", () => {
		expect(THEME_PRESETS.map((p) => p.id)).toEqual(["app-default", "dracula", "nord", "solarized-dark"]);
	});

	it("every preset defines background/foreground/cursor/cursorAccent plus all 16 ANSI colors", () => {
		for (const preset of THEME_PRESETS) {
			expect(preset.theme.background, `${preset.id}.background`).toBeTruthy();
			expect(preset.theme.foreground, `${preset.id}.foreground`).toBeTruthy();
			expect(preset.theme.cursor, `${preset.id}.cursor`).toBeTruthy();
			expect(preset.theme.cursorAccent, `${preset.id}.cursorAccent`).toBeTruthy();
			for (const slot of REQUIRED_ANSI_SLOTS) {
				expect((preset.theme as Record<string, unknown>)[slot], `${preset.id}.${slot}`).toBeTruthy();
			}
		}
	});

	it("every color value is a valid hex string", () => {
		const hexPattern = /^#[0-9A-Fa-f]{6}$/;
		for (const preset of THEME_PRESETS) {
			for (const value of Object.values(preset.theme)) {
				expect(value, `${preset.id} color`).toMatch(hexPattern);
			}
		}
	});
});

describe("getThemePreset", () => {
	it("returns the matching preset by id", () => {
		expect(getThemePreset("dracula").name).toBe("Dracula");
	});

	it("falls back to App Default for an unknown id", () => {
		expect(getThemePreset("not-a-real-preset").id).toBe("app-default");
	});
});

describe("withWindowTransparency() — FR-15", () => {
	it("returns the theme untouched at transparency 0, so the opaque default path is unchanged", () => {
		const theme = getThemePreset("app-default").theme;
		expect(withWindowTransparency(theme, 0)).toBe(theme);
	});

	it("applies the same scrim floor as --window-scrim-alpha (1 - 0.36 * t)", () => {
		// At full transparency the alpha must be exactly 0.64 — the floor
		// design.md §4.7 computed against a white wallpaper. If this drifts,
		// primary-text contrast is no longer guaranteed.
		const result = withWindowTransparency({ background: "#0D0F14" }, 1);
		expect(result.background).toBe("rgba(13, 15, 20, 0.64)");
	});

	it("never mutates the preset — PRD Q9 keeps palettes opaque", () => {
		const preset = getThemePreset("dracula");
		const before = preset.theme.background;
		withWindowTransparency(preset.theme, 1);
		expect(preset.theme.background).toBe(before);
	});

	it("clamps out-of-range input rather than producing an alpha past the floor", () => {
		expect(withWindowTransparency({ background: "#0D0F14" }, 5).background).toBe(
			"rgba(13, 15, 20, 0.64)",
		);
	});
});
