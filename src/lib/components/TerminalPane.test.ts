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
let onDataCallback: ((data: string) => void) | undefined;
let keyEventHandler: ((event: KeyboardEvent) => boolean) | undefined;
const getSelectionMock = vi.fn();
const pasteMock = vi.fn();
const termInstance = {
	loadAddon: vi.fn(),
	open: openMock,
	onData: vi.fn((cb: (data: string) => void) => {
		onDataCallback = cb;
	}),
	dispose: disposeMock,
	focus: vi.fn(),
	write: vi.fn(),
	attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
		keyEventHandler = handler;
	}),
	getSelection: getSelectionMock,
	paste: pasteMock,
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

const writeTextMock = vi.fn().mockResolvedValue(undefined);
const readTextMock = vi.fn().mockResolvedValue("");
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	writeText: (...args: unknown[]) => writeTextMock(...args),
	readText: (...args: unknown[]) => readTextMock(...args),
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
	resizeTerminalMock.mockReset();
	resizeTerminalMock.mockResolvedValue(undefined);
	writeTerminalMock.mockClear();
	writeTerminalMock.mockReset();
	writeTerminalMock.mockResolvedValue(undefined);
	writeTextMock.mockClear();
	writeTextMock.mockReset();
	writeTextMock.mockResolvedValue(undefined);
	readTextMock.mockClear();
	readTextMock.mockReset();
	readTextMock.mockResolvedValue("");
	getSelectionMock.mockReset();
	pasteMock.mockClear();
	onDataCallback = undefined;
	keyEventHandler = undefined;
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

describe("TerminalPane — keystroke write ordering (regression: typed characters arrived at the PTY out of order, showing up as scrambled/garbled input)", () => {
	// Each keystroke's writeTerminal() call is an independent Tauri IPC
	// round-trip with no ordering guarantee relative to other in-flight
	// calls (sync commands are dispatched onto a thread pool on the Rust
	// side). Firing one call per keystroke without sequencing let fast
	// typing reach the PTY in whatever order the backend happened to
	// schedule them, not the order the user typed them.
	it("does not send the next keystroke's write until the previous one has resolved", async () => {
		let resolveFirst: () => void = () => {};
		writeTerminalMock.mockImplementation((_sessionId: string, data: string) => {
			if (data === "a") return new Promise<void>((res) => { resolveFirst = res; });
			return Promise.resolve();
		});

		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn() });
		await vi.runAllTimersAsync(); // let the initial resize resolve so the write queue opens
		expect(onDataCallback).toBeDefined();

		onDataCallback!("a");
		onDataCallback!("b");
		await Promise.resolve();
		await Promise.resolve();

		// "b" must still be queued behind "a" — sending it early is exactly
		// what let the backend interleave/reorder the two writes.
		expect(writeTerminalMock).toHaveBeenCalledTimes(1);
		expect(writeTerminalMock).toHaveBeenNthCalledWith(1, "s1", "a");

		resolveFirst();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(writeTerminalMock).toHaveBeenCalledTimes(2);
		expect(writeTerminalMock).toHaveBeenNthCalledWith(2, "s1", "b");
	});
});

describe("TerminalPane — initial-resize gating (regression: keystrokes typed right after mount, in a fast/release build, reached the PTY before it was resized from its hardcoded 80x24 default, desyncing the shell's own cursor math)", () => {
	it("does not relay a keystroke to the backend until the first resize has been confirmed applied", async () => {
		let resolveResize: () => void = () => {};
		resizeTerminalMock.mockImplementation(
			() => new Promise<void>((res) => { resolveResize = res; }),
		);

		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn() });
		await vi.runAllTimersAsync(); // let the double-rAF fire, triggering the initial resize call
		expect(resizeTerminalMock).toHaveBeenCalledWith("s1", 24, 80);
		expect(onDataCallback).toBeDefined();

		// User types immediately, before the resize round-trip has resolved —
		// exactly what a snappy release build makes possible.
		onDataCallback!("t");
		await Promise.resolve();
		await Promise.resolve();

		expect(writeTerminalMock).not.toHaveBeenCalled();

		resolveResize();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(writeTerminalMock).toHaveBeenCalledWith("s1", "t");
	});
});

describe("TerminalPane — Ctrl+Shift+C/V clipboard shortcuts", () => {
	function keydown(code: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
		return { type: "keydown", ctrlKey: true, shiftKey: true, code, ...overrides } as KeyboardEvent;
	}

	it("Ctrl+Shift+C copies the current selection and swallows the keystroke", async () => {
		getSelectionMock.mockReturnValue("selected text");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn() });
		expect(keyEventHandler).toBeDefined();

		const handled = keyEventHandler!(keydown("KeyC"));

		expect(handled).toBe(false);
		expect(writeTextMock).toHaveBeenCalledWith("selected text");
	});

	it("Ctrl+Shift+C with no selection does not touch the clipboard", () => {
		getSelectionMock.mockReturnValue("");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn() });

		keyEventHandler!(keydown("KeyC"));

		expect(writeTextMock).not.toHaveBeenCalled();
	});

	it("Ctrl+Shift+V reads the clipboard and hands it to term.paste() (not a raw write) so bracketed-paste mode applies", async () => {
		readTextMock.mockResolvedValue("pasted text");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn() });
		await vi.runAllTimersAsync(); // let the initial resize resolve so the write queue opens

		const handled = keyEventHandler!(keydown("KeyV"));
		await vi.runAllTimersAsync();

		expect(handled).toBe(false);
		expect(pasteMock).toHaveBeenCalledWith("pasted text");
	});

	it("Ctrl+Shift+V with an empty clipboard does not call term.paste()", async () => {
		readTextMock.mockResolvedValue("");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn() });
		await vi.runAllTimersAsync();

		keyEventHandler!(keydown("KeyV"));
		await vi.runAllTimersAsync();

		expect(pasteMock).not.toHaveBeenCalled();
	});

	it("does not intercept a plain Ctrl+C (SIGINT stays untouched)", () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn() });

		const handled = keyEventHandler!(keydown("KeyC", { shiftKey: false }));

		expect(handled).toBe(true);
		expect(writeTextMock).not.toHaveBeenCalled();
	});
});
