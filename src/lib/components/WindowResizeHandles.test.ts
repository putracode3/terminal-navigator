import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

const startResizeDraggingMock = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		startResizeDragging: (...args: unknown[]) => startResizeDraggingMock(...args),
	}),
}));

import WindowResizeHandles from "./WindowResizeHandles.svelte";

beforeEach(() => {
	startResizeDraggingMock.mockReset();
});

// code review M3 fix round: this file previously shipped with zero test
// coverage — a swapped direction on any of the 8 handles (e.g. the two top
// corners) would have shipped silently. One assertion per handle, matching
// TitleBar.test.ts's existing convention for Tauri-command-triggering
// components.
describe("WindowResizeHandles — each handle drags in its own direction", () => {
	const cases: { selector: string; direction: string }[] = [
		{ selector: ".edge-n", direction: "North" },
		{ selector: ".edge-s", direction: "South" },
		{ selector: ".edge-e", direction: "East" },
		{ selector: ".edge-w", direction: "West" },
		{ selector: ".corner-ne", direction: "NorthEast" },
		{ selector: ".corner-nw", direction: "NorthWest" },
		{ selector: ".corner-se", direction: "SouthEast" },
		{ selector: ".corner-sw", direction: "SouthWest" },
	];

	for (const { selector, direction } of cases) {
		it(`mousedown on ${selector} calls startResizeDragging("${direction}")`, async () => {
			const { container } = render(WindowResizeHandles);

			const handle = container.querySelector(selector);
			expect(handle).not.toBeNull();
			await fireEvent.mouseDown(handle!);

			expect(startResizeDraggingMock).toHaveBeenCalledExactlyOnceWith(direction);
		});
	}

	it("renders exactly 8 handles — 4 edges + 4 corners, no duplicates", () => {
		const { container } = render(WindowResizeHandles);

		expect(container.querySelectorAll(".handle")).toHaveLength(8);
	});
});
