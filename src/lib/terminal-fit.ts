// Sizing the terminal grid to its pane.
//
// Why this exists (debugger session 2026-09-25, "margin space beside a TUI"):
// `@xterm/addon-fit` always subtracts 14px from the width it hands the grid
// for a scrollbar (`options.overviewRuler?.width || 14`, whenever
// `scrollback !== 0` — and a `width` of 0 is falsy, so it can't be turned
// off). A full-screen TUI (opencode, vim, htop…) runs on the *alternate*
// screen buffer, which has no scrollback and therefore no scrollbar, yet the
// 14px stayed reserved: the TUI paints every cell in its own background, and
// the reserved strip showed up as a wide band of the pane's colour on the
// right — measured 21px right vs 5px left (pane padding + border) around a
// full-grid fill, before the fix. In the normal buffer that strip is where
// the scrollbar lives, so it stays reserved there.

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/** How many columns fit in `availableWidth` (never fewer than 1), both in CSS
 *  pixels. xterm sets `.xterm-screen`'s width to
 *  `Math.round(cols * deviceCell / dpr)` CSS px, so a column fits when that
 *  ROUNDED width is within the space — `cols * cellWidth < availableWidth +
 *  0.5` — not when the unrounded product is. A plain `floor(available /
 *  cell)` lost a column exactly when the product overshoots by a fraction of
 *  a pixel (measured in the app: 105 columns = 819.003px in an 819px pane
 *  rendered fine as 819px, yet floor gave 104). `availableWidth` must be a
 *  whole number of CSS pixels (the measurement floors it: a whole-pixel
 *  screen can't use the fractional remainder anyway). Checked by brute force
 *  against xterm's real rounding over 1.4M random width/cell/DPR combinations
 *  (DPR 1 to 3): no mismatch. */
export function columnsThatFit(availableWidth: number, cellWidth: number): number {
	return Math.max(1, Math.ceil((availableWidth + 0.5) / cellWidth) - 1);
}

export interface FullWidthMeasurement {
	/** Whole CSS pixels available to the grid: the content width of the
	 *  element the terminal sits in, minus the terminal element's own
	 *  horizontal padding — i.e. what the addon uses *before* it subtracts its
	 *  scrollbar reserve. */
	availableWidth: number;
	/** xterm's fixed cell width in CSS px: `dimensions.device.cell.width /
	 *  devicePixelRatio`. Deliberately NOT `.xterm-screen`'s width / cols or
	 *  `dimensions.css.cell.width`: both are derived from a width xterm has
	 *  already rounded to whole pixels, so they drift with the current column
	 *  count (7.796–7.802 for a true 7.8) and made the result depend on how
	 *  many columns there happened to be before. */
	cellWidth: number;
}

// The addon reads the same private render-service dimensions; the shape is
// declared here so a change in xterm surfaces as a `null` measurement (and
// the safe fallback to the addon's own fit) rather than a thrown error.
interface RenderDimensions {
	device?: { cell?: { width?: number } };
}

/** Measures the real DOM. `null` if the terminal isn't laid out yet (no
 *  parent, no cell metrics, or unparsable widths) — callers fall back to the
 *  addon's own fit rather than guess. */
export function measureFullWidth(term: Terminal): FullWidthMeasurement | null {
	const element = term.element;
	const parent = element?.parentElement;
	if (!element || !parent) return null;

	const dimensions = (term as unknown as { _core?: { _renderService?: { dimensions?: RenderDimensions } } })._core
		?._renderService?.dimensions;
	const cellWidth = dimensions?.device?.cell?.width;
	// Fractional on purpose (a split pane can be 819.5px wide) — flooring to
	// whole CSS pixels happens once, below, not here.
	const parentWidth = parseFloat(getComputedStyle(parent).width);
	const style = getComputedStyle(element);
	const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
	if (!cellWidth || !(cellWidth > 0) || !Number.isFinite(parentWidth)) return null;

	const dpr = window.devicePixelRatio || 1;
	return { availableWidth: Math.floor(Math.max(0, parentWidth - padding)), cellWidth: cellWidth / dpr };
}

/** Fits `term` to its container. Identical to `fitAddon.fit()` on the normal
 *  buffer; on the alternate buffer (a full-screen TUI) it also gives the grid
 *  the scrollbar strip the addon would otherwise hold back for a scrollbar
 *  that isn't there. Rows are always the addon's own calculation. */
export function fitTerminal(
	term: Terminal,
	fitAddon: FitAddon,
	measure: (term: Terminal) => FullWidthMeasurement | null = measureFullWidth,
): void {
	if (term.buffer.active.type !== "alternate") {
		fitAddon.fit();
		return;
	}

	const proposed = fitAddon.proposeDimensions();
	const full = measure(term);
	if (!proposed || !full || Number.isNaN(proposed.cols) || Number.isNaN(proposed.rows)) {
		fitAddon.fit();
		return;
	}

	// Never narrower than the addon's own answer.
	const cols = Math.max(proposed.cols, columnsThatFit(full.availableWidth, full.cellWidth));
	if (term.cols !== cols || term.rows !== proposed.rows) term.resize(cols, proposed.rows);
}
