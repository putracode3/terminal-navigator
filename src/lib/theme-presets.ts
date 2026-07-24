// FR-13 terminal theme presets (design.md §4.5, ADR-0009). Frontend-only
// data — the backend only ever persists a preset id (string); it never sees
// these color values. Do not add these to tokens.css/tokens.json: they
// govern terminal content only, never app chrome (design.md §4.5).
//
// v2.6 (design.md §4.5a): six presets, of which exactly ONE is theme-aware.
// App Default has a dark and a light variant selected by the resolved chrome
// theme, because that preset is *defined* as "derived from the app's own
// tokens" and v2.5 made those tokens two-valued. Every other preset is a
// fixed palette chosen by name — do not make them follow the theme (§8).
import type { ITheme } from "@xterm/xterm";
import type { ResolvedTheme } from "$lib/stores/theme.svelte";

export interface ThemePresetDef {
	id: string;
	name: string;
	theme: ITheme;
}

/** design.md §9 rule 11: App Default's light variant is NOT a separate preset
 *  id. It is the same `"app-default"` id rendered against the light tokens —
 *  persisting a distinct id would make the stored setting theme-dependent and
 *  break the round-trip the moment the user switches chrome themes.
 *
 *  Its background must equal light-mode `--color-background` (#F3F4F7). That
 *  identity is what keeps design.md §4.6 Finding 2 true (terminal-pane
 *  translucency is inert on the default preset, because the preset composites
 *  over itself) — see `appDefaultTheme` below. */
const APP_DEFAULT_LIGHT: ITheme = {
	background: "#F3F4F7",
	foreground: "#14161B",
	cursor: "#16741C",
	cursorAccent: "#F3F4F7",
	// Systematic inversion of the dark variant, including bright*: on a light
	// background the emphatic direction is DARKER, so bright* sits below its
	// normal counterpart rather than above it (design.md §4.5a). `black` takes
	// the text color and `white` the surface color — the mirror of the dark
	// variant's ink-900/white-90 mapping.
	black: "#14161B",
	red: "#DB0A0A",
	green: "#16741C",
	yellow: "#8D6703",
	// blue/magenta/cyan are re-derived, not reused: the dark variant's
	// #3B82F6/#C084FC/#36B4E2 measure 3.34/2.40/2.17 against #F3F4F7 and fail
	// AA there. These clear 4.5:1 (design.md §7).
	blue: "#1D63D2",
	magenta: "#8B3FD9",
	cyan: "#0E6E8C",
	white: "#F9FAFB",
	brightBlack: "#565D6B",
	brightRed: "#A80808",
	brightGreen: "#0C4010",
	brightYellow: "#6B4E02",
	brightBlue: "#0F52A8",
	brightMagenta: "#6D28B4",
	brightCyan: "#0B5F79",
	brightWhite: "#FFFFFF",
};

export const THEME_PRESETS: ThemePresetDef[] = [
	{
		id: "app-default",
		name: "App Default",
		theme: {
			background: "#0D0F14",
			foreground: "#E4E7EC",
			cursor: "#16741C",
			cursorAccent: "#0D0F14",
			black: "#15181F",
			red: "#F87171",
			green: "#16741C",
			yellow: "#FBBF24",
			blue: "#3B82F6",
			magenta: "#C084FC",
			cyan: "#36B4E2",
			white: "#E4E7EC",
			brightBlack: "#5A6272",
			brightRed: "#FCA5A5",
			brightGreen: "#3EDA49",
			brightYellow: "#FDE68A",
			brightBlue: "#60A5FA",
			brightMagenta: "#D8B4FE",
			brightCyan: "#7DD3FC",
			brightWhite: "#FFFFFF",
		},
	},
	{
		id: "dracula",
		name: "Dracula",
		theme: {
			background: "#282A36",
			foreground: "#F8F8F2",
			cursor: "#F8F8F2",
			cursorAccent: "#282A36",
			black: "#21222C",
			red: "#FF5555",
			green: "#50FA7B",
			yellow: "#F1FA8C",
			blue: "#BD93F9",
			magenta: "#FF79C6",
			cyan: "#8BE9FD",
			white: "#F8F8F2",
			brightBlack: "#6272A4",
			brightRed: "#FF6E6E",
			brightGreen: "#69FF94",
			brightYellow: "#FFFFA5",
			brightBlue: "#D6ACFF",
			brightMagenta: "#FF92DF",
			brightCyan: "#A4FFFF",
			brightWhite: "#FFFFFF",
		},
	},
	{
		id: "nord",
		name: "Nord",
		theme: {
			background: "#2E3440",
			foreground: "#D8DEE9",
			cursor: "#D8DEE9",
			cursorAccent: "#2E3440",
			black: "#3B4252",
			red: "#BF616A",
			green: "#A3BE8C",
			yellow: "#EBCB8B",
			blue: "#81A1C1",
			magenta: "#B48EAD",
			cyan: "#88C0D0",
			white: "#E5E9F0",
			// Nord's normal/bright rows are intentionally near-identical for
			// colors other than black/white — this is Nord's actual documented
			// palette (low bright/normal differentiation by design, design.md
			// §4.5), not an omission to "fix" with more contrast.
			brightBlack: "#4C566A",
			brightRed: "#BF616A",
			brightGreen: "#A3BE8C",
			brightYellow: "#EBCB8B",
			brightBlue: "#81A1C1",
			brightMagenta: "#B48EAD",
			brightCyan: "#88C0D0",
			brightWhite: "#ECEFF4",
		},
	},
	{
		id: "solarized-dark",
		name: "Solarized Dark",
		theme: {
			background: "#002B36",
			foreground: "#839496",
			cursor: "#93A1A1",
			cursorAccent: "#002B36",
			black: "#073642",
			red: "#DC322F",
			green: "#859900",
			yellow: "#B58900",
			blue: "#268BD2",
			magenta: "#D33682",
			cyan: "#2AA198",
			white: "#EEE8D5",
			brightBlack: "#002B36",
			brightRed: "#CB4B16",
			brightGreen: "#586E75",
			brightYellow: "#657B83",
			brightBlue: "#839496",
			brightMagenta: "#6C71C4",
			brightCyan: "#93A1A1",
			brightWhite: "#FDF6E3",
		},
	},
	// The two light palettes below are reproduced verbatim from upstream and
	// are deliberately NOT contrast-adjusted — same stance as Dracula/Nord/
	// Solarized Dark above. Their recognizability is the feature; an altered
	// Solarized Light is not Solarized Light (design.md §4.5a, §8).
	{
		id: "solarized-light",
		name: "Solarized Light",
		theme: {
			background: "#FDF6E3",
			foreground: "#657B83",
			cursor: "#586E75",
			cursorAccent: "#FDF6E3",
			black: "#073642",
			red: "#DC322F",
			green: "#859900",
			yellow: "#B58900",
			blue: "#268BD2",
			magenta: "#D33682",
			cyan: "#2AA198",
			white: "#EEE8D5",
			brightBlack: "#002B36",
			brightRed: "#CB4B16",
			brightGreen: "#586E75",
			brightYellow: "#657B83",
			brightBlue: "#839496",
			brightMagenta: "#6C71C4",
			brightCyan: "#93A1A1",
			brightWhite: "#FDF6E3",
		},
	},
	{
		id: "github-light",
		name: "GitHub Light",
		theme: {
			background: "#FFFFFF",
			foreground: "#24292F",
			cursor: "#24292F",
			cursorAccent: "#FFFFFF",
			black: "#24292F",
			red: "#CF222E",
			green: "#116329",
			yellow: "#4D2D00",
			blue: "#0969DA",
			magenta: "#8250DF",
			cyan: "#1B7C83",
			white: "#6E7781",
			brightBlack: "#57606A",
			brightRed: "#A40E26",
			brightGreen: "#1A7F37",
			brightYellow: "#633C01",
			brightBlue: "#218BFF",
			brightMagenta: "#A475F9",
			brightCyan: "#3192AA",
			brightWhite: "#8C959F",
		},
	},
];

const DEFAULT_PRESET = THEME_PRESETS[0];

/** design.md §4.6 Finding 2's invariant, in one place: App Default's
 *  background is whatever the active `--color-background` is. */
function appDefaultTheme(resolved: ResolvedTheme): ITheme {
	return resolved === "light" ? APP_DEFAULT_LIGHT : DEFAULT_PRESET.theme;
}

/** Resolves a persisted preset id to the theme actually rendered.
 *
 *  `resolved` only ever changes the result for `"app-default"` (design.md
 *  §4.5a) — every other preset is a fixed palette and ignores it. Callers
 *  pass `themeStore.resolved`; the default keeps pre-v2.6 behaviour for any
 *  caller that genuinely has no theme context.
 *
 *  The returned object's `id` is always the persisted id, never a
 *  variant-specific one (§9 rule 11) — the light variant of App Default is
 *  still `"app-default"`. */
export function getThemePreset(id: string, resolved: ResolvedTheme = "dark"): ThemePresetDef {
	const preset = THEME_PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET;
	if (preset.id !== DEFAULT_PRESET.id) return preset;
	return { ...preset, theme: appDefaultTheme(resolved) };
}

/** FR-15 (design.md §4.7): makes the terminal's own background paint nothing,
 *  so whatever sits behind the pane shows through.
 *
 *  **Why the background is emptied rather than given an alpha.** Passing a
 *  translucent `rgba(...)` here does not work: xterm.js 6.0.0 flattens a
 *  translucent theme background against black and paints the result
 *  *opaquely*. Measured with two terminals identical except for
 *  `allowTransparency`, over a striped backdrop — both rendered a uniform
 *  colour (stdev 0.00) equal to `alpha x background`, while the same
 *  backdrop read stdev 127.49 where it was not covered. `allowTransparency`
 *  changed nothing; it appears in xterm 6.0.0 only as a default value and is
 *  never read, despite still being declared in the public typings.
 *
 *  So the alpha cannot live in the xterm theme. It lives on the pane element
 *  behind the terminal instead — see `paneBackground()`. This function's job
 *  is only to stop xterm painting over it. The companion CSS override in
 *  TerminalPane.svelte is required too: emptying the theme is not sufficient
 *  on its own, because xterm still sets a background on its own elements.
 *
 *  Returns the theme unchanged at transparency 0, so the opaque default path
 *  is byte-identical to pre-FR-15 behaviour. */
export function withWindowTransparency(theme: ITheme, transparency: number): ITheme {
	if (transparency <= 0) return theme;
	return { ...theme, background: "rgba(0, 0, 0, 0)" };
}

/** FR-15: the colour the pane paints behind a transparent terminal — the
 *  preset's own background at the window scrim alpha, so the FR-13 theme
 *  still reads as itself while the desktop shows through.
 *
 *  The 0.36 coefficient mirrors `--window-scrim-alpha` in tokens.css; if that
 *  floor is re-derived (design.md §4.7), both must move together. */
export function paneBackground(
	theme: ITheme,
	transparency: number,
	resolved: ResolvedTheme = "dark",
): string {
	// The fallback follows the active theme rather than being pinned to the
	// dark background: under light chrome an unpainted pane would otherwise
	// flash near-black, and — with FR-15's transparent window — a wrong-theme
	// fallback is not "one shade off" but a visibly wrong surface.
	const hex = theme.background ?? (appDefaultTheme(resolved).background as string);
	if (transparency <= 0) return hex;
	const alpha = 1 - 0.36 * Math.min(1, Math.max(0, transparency));
	return hexToRgba(hex, alpha);
}

function hexToRgba(hex: string, alpha: number): string {
	const h = hex.replace("#", "");
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
