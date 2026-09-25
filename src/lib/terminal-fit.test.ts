import { describe, it, expect, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { columnsThatFit, fitTerminal, measureFullWidth } from "./terminal-fit";

// Debugger session 2026-09-25 ("margin space beside a TUI"): FitAddon holds
// back 14px for a scrollbar even on the alternate screen buffer, where a
// full-screen TUI has none. jsdom has no layout engine, so the DOM
// measurement is stubbed here; the real-layout effect was measured
// separately in headless Chrome (see docs/qa/test-plan.md v1.20).

function fakeTerm(bufferType: "normal" | "alternate", cols = 100, rows = 30) {
	return {
		cols,
		rows,
		buffer: { active: { type: bufferType } },
		resize: vi.fn(),
	} as unknown as Terminal & { resize: ReturnType<typeof vi.fn> };
}

function fakeFit(proposed: { cols: number; rows: number } | undefined) {
	return { fit: vi.fn(), proposeDimensions: vi.fn(() => proposed) } as unknown as FitAddon & {
		fit: ReturnType<typeof vi.fn>;
		proposeDimensions: ReturnType<typeof vi.fn>;
	};
}

describe("columnsThatFit", () => {
	it("floors to whole cells (whole device pixels in)", () => {
		expect(columnsThatFit(874, 7.8)).toBe(112);
		expect(columnsThatFit(100, 10)).toBe(10);
		expect(columnsThatFit(99, 10)).toBe(9);
	});

	// Debugger session 2026-09-25, second round (user screenshot: opencode in a
	// split pane still showed a margin — 104 columns where 105 fit). xterm sets
	// `.xterm-screen`'s width to `round(cols * deviceCellWidth)`, so a column
	// fits when that ROUNDED width is within the available width — not when
	// `cols * cell <= available`. Values below are the real ones measured in
	// the WebKitGTK app: device cell 7.8000030517578125 at DPR 1, and a pane
	// whose content box is 819px wide (819.5 fractional).
	describe("uses xterm's own rounding of the screen width (real values from the app)", () => {
		const DEVICE_CELL = 7.8000030517578125;

		it("fits 105 columns in 819px — 105 * 7.8000031 = 819.003 rounds to 819, which fits (a plain floor gave 104)", () => {
			expect(columnsThatFit(819, DEVICE_CELL)).toBe(105);
		});

		it("fits 145 columns in 1131px (145 * 7.8000031 = 1131.0004 rounds to 1131)", () => {
			expect(columnsThatFit(1131, DEVICE_CELL)).toBe(145);
		});

		it("still refuses a column whose rounded width would exceed the space", () => {
			// 106 * 7.8000031 = 826.8 -> 827 > 826 ; 105 columns is the most.
			expect(columnsThatFit(826, DEVICE_CELL)).toBe(105);
			expect(columnsThatFit(1130, DEVICE_CELL)).toBe(144);
		});

		it("gives the largest column count whose rounded width fits, across the pane widths tried in the app", () => {
			// Widths are the content boxes of the un-maximized window resized to
			// 1500, 1401, 1234, 1111, 1650, 1280 and 1003px. 733 -> 94 is the case
			// the previous formula got wrong (it gave 93: 94 * 7.8000031 = 733.20,
			// which xterm renders as a 733px screen).
			const expected: Array<[number, number]> = [
				[1650, 211],
				[1230, 157],
				[1010, 129],
				[964, 123],
				[841, 107],
				[733, 94],
				[1380, 176],
			];
			for (const [available, cols] of expected) {
				expect(columnsThatFit(available, DEVICE_CELL)).toBe(cols);
				// ...and it really is the maximum: one more column would not fit.
				expect(Math.round((cols + 1) * DEVICE_CELL)).toBeGreaterThan(available);
				expect(Math.round(cols * DEVICE_CELL)).toBeLessThanOrEqual(available);
			}
		});
	});

	it("never returns fewer than 1", () => {
		expect(columnsThatFit(0, 8)).toBe(1);
		expect(columnsThatFit(3, 8)).toBe(1);
	});
});

describe("fitTerminal", () => {
	it("on the normal buffer just delegates to the addon's fit() — scrollbar strip stays reserved", () => {
		const term = fakeTerm("normal");
		const fit = fakeFit({ cols: 110, rows: 30 });
		const measure = vi.fn();

		fitTerminal(term, fit, measure);

		expect(fit.fit).toHaveBeenCalledOnce();
		expect(term.resize).not.toHaveBeenCalled();
		expect(measure).not.toHaveBeenCalled();
	});

	it("on the alternate buffer gives the grid the strip the addon held back for a scrollbar", () => {
		// The addon proposes 110 cols (it subtracted 14px ≈ 1-2 cells); the
		// full width holds 112 — that is the fix.
		const term = fakeTerm("alternate", 110, 28);
		const fit = fakeFit({ cols: 110, rows: 28 });

		fitTerminal(term, fit, () => ({ availableWidth: 890, cellWidth: 7.8 }));

		expect(fit.fit).not.toHaveBeenCalled();
		expect(term.resize).toHaveBeenCalledWith(114, 28);
	});

	it("keeps the addon's own row count on the alternate buffer", () => {
		const term = fakeTerm("alternate", 100, 20);
		const fit = fakeFit({ cols: 100, rows: 28 });

		fitTerminal(term, fit, () => ({ availableWidth: 800, cellWidth: 8 }));

		expect(term.resize).toHaveBeenCalledWith(100, 28);
	});

	it("does not resize when the grid already matches (no needless SIGWINCH)", () => {
		const term = fakeTerm("alternate", 114, 28);
		const fit = fakeFit({ cols: 110, rows: 28 });

		fitTerminal(term, fit, () => ({ availableWidth: 890, cellWidth: 7.8 }));

		expect(term.resize).not.toHaveBeenCalled();
	});

	it("never picks fewer columns than the addon proposed", () => {
		const term = fakeTerm("alternate", 90, 28);
		const fit = fakeFit({ cols: 110, rows: 28 });

		fitTerminal(term, fit, () => ({ availableWidth: 100, cellWidth: 8 }));

		expect(term.resize).toHaveBeenCalledWith(110, 28);
	});

	it("falls back to the addon's fit() when the terminal isn't laid out yet", () => {
		const term = fakeTerm("alternate");
		const fit = fakeFit({ cols: 110, rows: 30 });

		fitTerminal(term, fit, () => null);

		expect(fit.fit).toHaveBeenCalledOnce();
		expect(term.resize).not.toHaveBeenCalled();
	});

	it("falls back to the addon's fit() when it has no proposal", () => {
		const term = fakeTerm("alternate");
		const fit = fakeFit(undefined);

		fitTerminal(term, fit, () => ({ availableWidth: 800, cellWidth: 8 }));

		expect(fit.fit).toHaveBeenCalledOnce();
	});
});

// A terminal whose DOM/render-service shape is just enough for measureFullWidth.
// jsdom has no layout, so the width comes from an inline style (which
// getComputedStyle reports) and the cell metrics from a hand-built
// `_core._renderService.dimensions` — the same private field the addon reads.
function laidOutTerm(opts: { parentWidth: string; deviceCellWidth?: number; paddingPx?: number }): Terminal {
	const parent = document.createElement("div");
	parent.style.width = opts.parentWidth;
	const element = document.createElement("div");
	element.style.paddingLeft = `${opts.paddingPx ?? 0}px`;
	element.style.paddingRight = `${opts.paddingPx ?? 0}px`;
	parent.appendChild(element);
	document.body.appendChild(parent);
	return {
		element,
		cols: 80,
		_core: { _renderService: { dimensions: { device: { cell: { width: opts.deviceCellWidth } } } } },
	} as unknown as Terminal;
}

describe("measureFullWidth — units (xterm rounds the screen width in CSS px: Math.round(device.canvas.width / dpr))", () => {
	const setDpr = (dpr: number) => vi.stubGlobal("devicePixelRatio", dpr);

	it("reports whole CSS px of space and the cell width in CSS px, at DPR 1", () => {
		setDpr(1);
		const term = laidOutTerm({ parentWidth: "819.5px", deviceCellWidth: 7.8000030517578125 });
		expect(measureFullWidth(term)).toEqual({ availableWidth: 819, cellWidth: 7.8000030517578125 });
		vi.unstubAllGlobals();
	});

	it("at a fractional DPR converts the device cell to CSS px instead of rounding in device px (real case from a brute-force check against xterm: 831.5px, 10.8px cell, DPR 1.75 -> 76 columns; rounding in device px gave 77)", () => {
		setDpr(1.75);
		const term = laidOutTerm({ parentWidth: "831.5px", deviceCellWidth: 10.8 * 1.75 });
		const m = measureFullWidth(term)!;
		expect(m.availableWidth).toBe(831);
		expect(m.cellWidth).toBeCloseTo(10.8, 10);
		expect(columnsThatFit(m.availableWidth, m.cellWidth)).toBe(76);
		vi.unstubAllGlobals();
	});

	it("subtracts the terminal element's own horizontal padding", () => {
		setDpr(1);
		const term = laidOutTerm({ parentWidth: "830px", deviceCellWidth: 8, paddingPx: 5 });
		expect(measureFullWidth(term)!.availableWidth).toBe(820);
		vi.unstubAllGlobals();
	});

	it("is null — so the caller falls back to the addon's own fit — when xterm's private cell metrics are missing or zero", () => {
		setDpr(1);
		expect(measureFullWidth(laidOutTerm({ parentWidth: "800px" }))).toBeNull();
		expect(measureFullWidth(laidOutTerm({ parentWidth: "800px", deviceCellWidth: 0 }))).toBeNull();
		const noCore = { element: document.createElement("div"), cols: 80 } as unknown as Terminal;
		document.body.appendChild(document.createElement("div")).appendChild(noCore.element!);
		expect(measureFullWidth(noCore)).toBeNull();
		vi.unstubAllGlobals();
	});
});

describe("measureFullWidth", () => {
	it("returns null when the terminal has no DOM yet", () => {
		expect(measureFullWidth({ element: undefined, cols: 80 } as unknown as Terminal)).toBeNull();
	});

	it("returns null in jsdom-style zero layout instead of a bogus size", () => {
		const parent = document.createElement("div");
		const element = document.createElement("div");
		const screen = document.createElement("div");
		screen.className = "xterm-screen";
		element.appendChild(screen);
		parent.appendChild(element);
		document.body.appendChild(parent);

		expect(measureFullWidth({ element, cols: 80 } as unknown as Terminal)).toBeNull();
		parent.remove();
	});
});
