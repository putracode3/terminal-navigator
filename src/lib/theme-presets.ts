// FR-13 terminal theme presets (design.md §4.5, ADR-0009). Frontend-only
// data — the backend only ever persists a preset id (string); it never sees
// these color values. Do not add these to tokens.css/tokens.json: they
// govern terminal content only, never app chrome (design.md §4.5).
import type { ITheme } from "@xterm/xterm";

export interface ThemePresetDef {
	id: string;
	name: string;
	theme: ITheme;
}

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
];

const DEFAULT_PRESET = THEME_PRESETS[0];

export function getThemePreset(id: string): ThemePresetDef {
	return THEME_PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET;
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
export function paneBackground(theme: ITheme, transparency: number): string {
	const hex = theme.background ?? "#0D0F14";
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
