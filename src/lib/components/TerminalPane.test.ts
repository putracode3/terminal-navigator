import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/svelte";

// This suite covers what jsdom *can* verify: that the initial fit() is
// deferred rather than synchronous. It cannot reproduce the real browser
// layout race that motivated the fix (jsdom has no real layout engine —
// getBoundingClientRect always returns zeros), so it is not a substitute for
// manually verifying the actual rendered terminal fills its pane.

const fitMock = vi.fn();
const openMock = vi.fn();
const disposeMock = vi.fn();
const termInstance = {
	loadAddon: vi.fn(),
	open: openMock,
	onData: vi.fn(),
	dispose: disposeMock,
	focus: vi.fn(),
	write: vi.fn(),
	rows: 24,
	cols: 80,
};

vi.mock("@xterm/xterm", () => ({
	Terminal: vi.fn(function Terminal() {
		return termInstance;
	}),
}));

vi.mock("@xterm/addon-fit", () => ({
	FitAddon: vi.fn(function FitAddon() {
		return { fit: fitMock };
	}),
}));

vi.mock("@xterm/addon-webgl", () => ({
	WebglAddon: vi.fn(function WebglAddon() {
		return {};
	}),
}));

const listenMock = vi.fn().mockResolvedValue(() => {});
vi.mock("@tauri-apps/api/event", () => ({
	listen: (...args: unknown[]) => listenMock(...args),
}));

const resizeTerminalMock = vi.fn();
const writeTerminalMock = vi.fn();
vi.mock("$lib/api", () => ({
	resizeTerminal: (...args: unknown[]) => resizeTerminalMock(...args),
	writeTerminal: (...args: unknown[]) => writeTerminalMock(...args),
}));

import TerminalPane from "./TerminalPane.svelte";

beforeEach(() => {
	fitMock.mockClear();
	openMock.mockClear();
	resizeTerminalMock.mockClear();
	// Reduce requestAnimationFrame to a fake-timer-controllable primitive
	// rather than relying on sinon's rAF-specific fake-timer support.
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
	// jsdom has no ResizeObserver; TerminalPane only needs .observe()/.disconnect() to exist.
	vi.stubGlobal(
		"ResizeObserver",
		vi.fn(function ResizeObserver() {
			return { observe: vi.fn(), disconnect: vi.fn() };
		}),
	);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("TerminalPane — initial fit timing (see the code comment above the fix for the full rationale)", () => {
	it("opens the terminal into its container on mount", () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn() });
		expect(openMock).toHaveBeenCalledOnce();
	});

	it("does NOT call fit() synchronously on mount", () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn() });
		expect(fitMock).not.toHaveBeenCalled();
	});

	it("calls fit() and reports the resulting size to the backend once layout has had a chance to settle", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn() });
		await vi.runAllTimersAsync();
		expect(fitMock).toHaveBeenCalledOnce();
		expect(resizeTerminalMock).toHaveBeenCalledWith("s1", 24, 80);
	});
});
