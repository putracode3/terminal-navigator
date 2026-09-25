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
	it("floors to whole cells", () => {
		expect(columnsThatFit(874, 7.8)).toBe(112);
		expect(columnsThatFit(100, 10)).toBe(10);
		expect(columnsThatFit(99.9, 10)).toBe(9);
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
