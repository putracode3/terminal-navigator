import { describe, it, expect } from "vitest";
import { THEME_PRESETS, getThemePreset, withWindowTransparency, paneBackground } from "./theme-presets";

const REQUIRED_ANSI_SLOTS = [
	"black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
	"brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

describe("THEME_PRESETS (design.md §4.5)", () => {
	it("has exactly the 6 presets design.md §4.5/§4.5a specifies", () => {
		expect(THEME_PRESETS.map((p) => p.id)).toEqual([
			"app-default",
			"dracula",
			"nord",
			"solarized-dark",
			"solarized-light",
			"github-light",
		]);
	});

	/** design.md §9 rule 11: the light variant of App Default is NOT a preset
	 *  id. A second id would make the persisted setting theme-dependent and
	 *  break the round-trip when the user switches chrome themes. */
	it("exposes no variant-specific id for App Default's light form", () => {
		expect(THEME_PRESETS.map((p) => p.id)).not.toContain("app-default-light");
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

describe("getThemePreset — App Default is theme-aware (design.md §4.5a, §9 rule 11)", () => {
	/** Invariant 1: the persisted id never varies by theme. This is what keeps
	 *  the stored setting round-trippable across a chrome-theme switch. */
	it("keeps the id 'app-default' in BOTH themes — never a variant-specific id", () => {
		expect(getThemePreset("app-default", "dark").id).toBe("app-default");
		expect(getThemePreset("app-default", "light").id).toBe("app-default");
	});

	it("keeps the name 'App Default' in both themes — the preview shows the variant, the label doesn't", () => {
		expect(getThemePreset("app-default", "light").name).toBe("App Default");
	});

	/** Invariant 2: App Default's background IS the active --color-background.
	 *  design.md §4.6 Finding 2 (terminal-pane translucency is inert on the
	 *  default preset, because it composites over itself) is true only while
	 *  this holds — if it drifts, FR-14 silently ships a setting that does
	 *  something it documents as doing nothing. */
	it("resolves its background to the active --color-background in each theme", () => {
		expect(getThemePreset("app-default", "dark").theme.background).toBe("#0D0F14");
		expect(getThemePreset("app-default", "light").theme.background).toBe("#F3F4F7");
	});

	it("swaps the whole palette, not just the background — light foreground is dark ink", () => {
		const light = getThemePreset("app-default", "light").theme;
		expect(light.foreground).toBe("#14161B");
		// bright* is DARKER than normal in light mode — the light-mode
		// direction of "brighter" (design.md §4.5a), not a copy of the dark row.
		expect(light.brightGreen).toBe("#0C4010");
		expect(light.green).toBe("#16741C");
	});

	it("defaults to the dark variant when no theme is passed, preserving pre-v2.6 behaviour", () => {
		expect(getThemePreset("app-default").theme.background).toBe("#0D0F14");
	});

	/** design.md §8: only App Default follows the chrome theme. A named palette
	 *  is chosen by name — silently swapping Dracula for something else when
	 *  the theme flips would select a palette the user never picked. */
	it("does NOT vary any other preset by theme", () => {
		for (const id of ["dracula", "nord", "solarized-dark", "solarized-light", "github-light"]) {
			expect(getThemePreset(id, "light").theme, id).toEqual(getThemePreset(id, "dark").theme);
		}
	});

	it("never mutates the shared preset data when resolving a variant", () => {
		getThemePreset("app-default", "light");
		expect(THEME_PRESETS[0].theme.background).toBe("#0D0F14");
	});
});

describe("withWindowTransparency() — FR-15", () => {
	it("returns the theme untouched at transparency 0, so the opaque default path is unchanged", () => {
		const theme = getThemePreset("app-default").theme;
		expect(withWindowTransparency(theme, 0)).toBe(theme);
	});

	/** Regression: FR-15 originally put the scrim alpha INTO the xterm theme
	 *  background as rgba(...). xterm 6.0.0 flattens a translucent theme
	 *  background against black and paints it opaque, so the terminal stayed
	 *  solid while every other surface went translucent. The theme background
	 *  must now be fully transparent — the alpha belongs on the pane. */
	it("empties the terminal background entirely — a translucent one is flattened opaque by xterm", () => {
		const result = withWindowTransparency(getThemePreset("app-default").theme, 1);
		expect(result.background).toBe("rgba(0, 0, 0, 0)");
	});

	it("never mutates the preset — PRD Q9 keeps palettes opaque", () => {
		const preset = getThemePreset("dracula");
		const before = preset.theme.background;
		withWindowTransparency(preset.theme, 1);
		expect(preset.theme.background).toBe(before);
	});
});

describe("paneBackground() — FR-15", () => {
	it("returns the preset's opaque hex at transparency 0", () => {
		expect(paneBackground(getThemePreset("dracula").theme, 0)).toBe("#282A36");
	});

	it("applies the same scrim floor as --window-scrim-alpha (1 - 0.36 * t)", () => {
		expect(paneBackground({ background: "#0D0F14" }, 1)).toBe("rgba(13, 15, 20, 0.64)");
	});

	it("keeps each preset's own colour rather than collapsing them to one — FR-13 must survive FR-15", () => {
		expect(paneBackground(getThemePreset("nord").theme, 1)).toBe("rgba(46, 52, 64, 0.64)");
		expect(paneBackground(getThemePreset("dracula").theme, 1)).toBe("rgba(40, 42, 54, 0.64)");
	});

	it("clamps out-of-range input rather than producing an alpha past the floor", () => {
		expect(paneBackground({ background: "#0D0F14" }, 5)).toBe("rgba(13, 15, 20, 0.64)");
	});

	it("carries App Default's light background through the scrim, not the dark one", () => {
		const light = getThemePreset("app-default", "light").theme;
		expect(paneBackground(light, 1, "light")).toBe("rgba(243, 244, 247, 0.64)");
	});

	/** The fallback used to be pinned to the dark background. Under light
	 *  chrome that would paint a near-black pane — and with FR-15's transparent
	 *  window an unpainted/wrong-theme box is not "one shade off", it is a
	 *  visibly wrong surface (design.md §8's padding/background rule). */
	it("falls back to the active theme's background when a theme has none", () => {
		expect(paneBackground({}, 0, "light")).toBe("#F3F4F7");
		expect(paneBackground({}, 0, "dark")).toBe("#0D0F14");
	});
});
