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

/** How many whole cells fit in `availableWidth` (never fewer than 1). */
export function columnsThatFit(availableWidth: number, cellWidth: number): number {
	return Math.max(1, Math.floor(availableWidth / cellWidth));
}

export interface FullWidthMeasurement {
	/** Content width of the element the terminal sits in, minus the
	 *  terminal element's own horizontal padding — i.e. what the addon uses
	 *  *before* it subtracts its scrollbar reserve. */
	availableWidth: number;
	cellWidth: number;
}

/** Measures the real DOM. `null` if the terminal isn't laid out yet (no
 *  parent, zero-sized, or unparsable widths) — callers fall back to the
 *  addon's own fit rather than guess. */
export function measureFullWidth(term: Terminal): FullWidthMeasurement | null {
	const element = term.element;
	const parent = element?.parentElement;
	const screen = element?.querySelector(".xterm-screen");
	if (!element || !parent || !screen || term.cols === 0) return null;

	const cellWidth = screen.getBoundingClientRect().width / term.cols;
	// parseInt, not parseFloat: same truncation `@xterm/addon-fit` applies to the
	// parent's width, so the two never disagree about the space available.
	const parentWidth = parseInt(getComputedStyle(parent).width, 10);
	const style = getComputedStyle(element);
	const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
	if (!(cellWidth > 0) || !Number.isFinite(parentWidth)) return null;

	return { availableWidth: Math.max(0, parentWidth - padding), cellWidth };
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
