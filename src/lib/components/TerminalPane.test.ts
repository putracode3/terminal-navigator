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
let wheelEventHandler: ((event: WheelEvent) => boolean) | undefined;
let resizeObserverCallback: (() => void) | undefined;
const getSelectionMock = vi.fn();
const pasteMock = vi.fn();
const refreshMock = vi.fn();
const termInstance = {
	loadAddon: vi.fn(),
	open: openMock,
	onData: vi.fn((cb: (data: string) => void) => {
		onDataCallback = cb;
	}),
	dispose: disposeMock,
	focus: vi.fn(),
	refresh: refreshMock,
	write: vi.fn(),
	attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
		keyEventHandler = handler;
	}),
	attachCustomWheelEventHandler: vi.fn((handler: (event: WheelEvent) => boolean) => {
		wheelEventHandler = handler;
	}),
	getSelection: getSelectionMock,
	paste: pasteMock,
	rows: 24,
	cols: 80,
	options: {} as { theme?: unknown; fontSize?: number },
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
import { Terminal } from "@xterm/xterm";
import { settingsStore } from "$lib/stores/settings.svelte";
import { DEFAULT_KEYBINDINGS } from "$lib/keybindings";
import { __resetTerminalRegistryForTests } from "$lib/terminal-registry";

beforeEach(() => {
	// This suite reuses the literal sessionId "s1" across almost every test —
	// the registry is a module-level singleton (by design, see
	// terminal-registry.ts), so without this reset, test #2 would silently
	// "reuse" test #1's mock handle instead of creating a fresh one.
	__resetTerminalRegistryForTests();
	settingsStore.themePreset = "app-default";
	settingsStore.keybindings = { ...DEFAULT_KEYBINDINGS };
	termInstance.options = {};
	(Terminal as unknown as ReturnType<typeof vi.fn>).mockClear();
	termInstance.loadAddon.mockClear();
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
	refreshMock.mockClear();
	listenMock.mockClear();
	onDataCallback = undefined;
	keyEventHandler = undefined;
	wheelEventHandler = undefined;
	resizeObserverCallback = undefined;
	// Reduce requestAnimationFrame to a fake-timer-controllable primitive
	// rather than relying on sinon's rAF-specific fake-timer support.
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
	// jsdom has no ResizeObserver; TerminalPane only needs .observe()/.disconnect() to exist.
	// The callback is captured (not just a no-op) so tests can simulate the
	// browser firing a real resize notification, e.g. the display:none <->
	// flex flip TerminalArea.svelte does when backgrounding/foregrounding a
	// tab (see the "background/foreground gating" describe block below).
	vi.stubGlobal(
		"ResizeObserver",
		vi.fn(function ResizeObserver(callback: () => void) {
			resizeObserverCallback = callback;
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
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		expect(openMock).toHaveBeenCalledOnce();
	});

	it("loads only the fit addon, never @xterm/addon-webgl (ADR-0006 revisit: WebGL creates a healthy context but never actually paints — debugger session 2026-07-21, see docs/qa/test-plan.md §5.1)", () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		expect(termInstance.loadAddon).toHaveBeenCalledOnce();
	});

	it("does NOT call fit() synchronously on mount", () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		expect(fitMock).not.toHaveBeenCalled();
	});

	it("calls fit() and reports the resulting size to the backend once layout has had a chance to settle", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
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

		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
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

		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
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
		return {
			type: "keydown",
			ctrlKey: true,
			shiftKey: true,
			code,
			preventDefault: vi.fn(),
			...overrides,
		} as unknown as KeyboardEvent;
	}

	it("Ctrl+Shift+C copies the current selection and swallows the keystroke", async () => {
		getSelectionMock.mockReturnValue("selected text");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		expect(keyEventHandler).toBeDefined();

		const handled = keyEventHandler!(keydown("KeyC"));

		expect(handled).toBe(false);
		expect(writeTextMock).toHaveBeenCalledWith("selected text");
	});

	it("Ctrl+Shift+C with no selection does not touch the clipboard", () => {
		getSelectionMock.mockReturnValue("");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });

		keyEventHandler!(keydown("KeyC"));

		expect(writeTextMock).not.toHaveBeenCalled();
	});

	it("Ctrl+Shift+V reads the clipboard and hands it to term.paste() (not a raw write) so bracketed-paste mode applies", async () => {
		readTextMock.mockResolvedValue("pasted text");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync(); // let the initial resize resolve so the write queue opens

		const handled = keyEventHandler!(keydown("KeyV"));
		await vi.runAllTimersAsync();

		expect(handled).toBe(false);
		expect(pasteMock).toHaveBeenCalledWith("pasted text");
	});

	it("Ctrl+Shift+V with an empty clipboard does not call term.paste()", async () => {
		readTextMock.mockResolvedValue("");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		keyEventHandler!(keydown("KeyV"));
		await vi.runAllTimersAsync();

		expect(pasteMock).not.toHaveBeenCalled();
	});

	it("regression: Ctrl+Shift+V calls preventDefault so the webview's own native paste action can't ALSO fire and insert the clipboard text a second time (xterm.js registers its own built-in `paste` listener on the hidden textarea, independent of this custom key handler)", async () => {
		readTextMock.mockResolvedValue("pasted text");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		const event = keydown("KeyV");
		keyEventHandler!(event);
		await vi.runAllTimersAsync();

		expect(event.preventDefault).toHaveBeenCalled();
	});

	it("regression: Ctrl+Shift+C also calls preventDefault, for the same reason (own the keydown fully once handled)", () => {
		getSelectionMock.mockReturnValue("selected text");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });

		const event = keydown("KeyC");
		keyEventHandler!(event);

		expect(event.preventDefault).toHaveBeenCalled();
	});

	it("does not intercept a plain Ctrl+C (SIGINT stays untouched)", () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });

		const handled = keyEventHandler!(keydown("KeyC", { shiftKey: false }));

		expect(handled).toBe(true);
		expect(writeTextMock).not.toHaveBeenCalled();
	});
});

describe("TerminalPane — FR-13 theme presets", () => {
	it("constructs the terminal with the currently-selected preset's full Theme", () => {
		settingsStore.themePreset = "dracula";
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });

		expect(Terminal).toHaveBeenCalledWith(expect.objectContaining({ theme: expect.objectContaining({ background: "#282A36" }) }));
	});

	it("applies a newly-selected preset to an already-open pane immediately (no remount)", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();
		expect(Terminal).toHaveBeenCalledTimes(1);

		settingsStore.themePreset = "nord";
		await vi.runAllTimersAsync();

		expect(termInstance.options.theme).toMatchObject({ background: "#2E3440" });
		expect(Terminal).toHaveBeenCalledTimes(1); // still the same instance — not recreated
	});
});

describe("TerminalPane — FR-13 rebindable clipboard shortcuts", () => {
	it("uses the currently-bound combo, not a hardcoded Ctrl+Shift+C/V, once the user has rebound it", async () => {
		settingsStore.keybindings = { ...settingsStore.keybindings, "clipboard.paste": "Alt+Shift+P" };
		readTextMock.mockResolvedValue("pasted text");
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		// The old default no longer triggers paste...
		const oldDefaultEvent = {
			type: "keydown",
			ctrlKey: true,
			shiftKey: true,
			code: "KeyV",
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent;
		const oldHandled = keyEventHandler!(oldDefaultEvent);
		expect(oldHandled).toBe(true);
		expect(pasteMock).not.toHaveBeenCalled();

		// ...but the newly-bound combo does.
		const event = { type: "keydown", altKey: true, shiftKey: true, code: "KeyP", preventDefault: vi.fn() } as unknown as KeyboardEvent;
		const handled = keyEventHandler!(event);
		await vi.runAllTimersAsync();

		expect(handled).toBe(false);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(pasteMock).toHaveBeenCalledWith("pasted text");
	});
});

describe("TerminalPane — FR-13 follow-up: zoom in/out (terminal.zoomIn/zoomOut)", () => {
	function ctrlKey(code: string): KeyboardEvent {
		return { type: "keydown", ctrlKey: true, code, preventDefault: vi.fn() } as unknown as KeyboardEvent;
	}

	it("Ctrl+= increases the font size, re-fits, and reports the new size to the backend", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();
		fitMock.mockClear();
		resizeTerminalMock.mockClear();

		const event = ctrlKey("Equal");
		const handled = keyEventHandler!(event);

		expect(handled).toBe(false);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(termInstance.options.fontSize).toBe(14);
		expect(fitMock).toHaveBeenCalledOnce();
		expect(resizeTerminalMock).toHaveBeenCalledWith("s1", 24, 80);
	});

	it("Ctrl+- decreases the font size", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		keyEventHandler!(ctrlKey("Minus"));

		expect(termInstance.options.fontSize).toBe(12);
	});

	it("clamps at the maximum font size instead of growing indefinitely", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		for (let i = 0; i < 30; i++) keyEventHandler!(ctrlKey("Equal"));

		expect(termInstance.options.fontSize).toBe(32);
	});

	it("clamps at the minimum font size instead of shrinking to zero/negative", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		for (let i = 0; i < 30; i++) keyEventHandler!(ctrlKey("Minus"));

		expect(termInstance.options.fontSize).toBe(8);
	});

	it("does not re-fit once already clamped (no-op past the limit)", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();
		for (let i = 0; i < 19; i++) keyEventHandler!(ctrlKey("Equal")); // reach the max (13 -> 32)
		fitMock.mockClear();

		keyEventHandler!(ctrlKey("Equal")); // one more, already at max

		expect(fitMock).not.toHaveBeenCalled();
	});

	// Regression (code review B1): must go through xterm's own
	// attachCustomWheelEventHandler hook, not a separate DOM `wheel` listener
	// on an ancestor element — an ancestor's bubble-phase handler runs too
	// late to stop xterm's own default wheel handling (buffer scroll, or —
	// with no scrollback — literal arrow-key sequences sent to the shell).
	it("registers via term.attachCustomWheelEventHandler, not a template DOM listener", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		expect(wheelEventHandler).toBeDefined();
	});

	it("Ctrl+Scroll up (deltaY < 0) zooms in, prevents default, and skips xterm's own wheel handling", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		const event = new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, cancelable: true });
		const handled = wheelEventHandler!(event);

		expect(termInstance.options.fontSize).toBe(14);
		expect(event.defaultPrevented).toBe(true);
		expect(handled).toBe(false); // false = xterm must NOT also process this wheel event
	});

	it("Ctrl+Scroll down (deltaY > 0) zooms out", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		wheelEventHandler!(new WheelEvent("wheel", { ctrlKey: true, deltaY: 100, cancelable: true }));

		expect(termInstance.options.fontSize).toBe(12);
	});

	it("a plain scroll (no Ctrl) does not zoom, does not preventDefault, and lets xterm handle it normally", async () => {
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		const event = new WheelEvent("wheel", { ctrlKey: false, deltaY: -100, cancelable: true });
		const handled = wheelEventHandler!(event);

		expect(termInstance.options.fontSize).toBeUndefined();
		expect(event.defaultPrevented).toBe(false);
		expect(handled).toBe(true); // true = xterm proceeds with its own default (scrollback/arrow-key) handling
	});
});

describe("TerminalPane — background/foreground resize gating (regression: switching tabs quickly flashed a mis-sized/blank terminal, because backgrounding a tab collapsed its container to 0x0 and the ResizeObserver fired for that collapse just like any other resize, shrinking the xterm.js buffer and the backend PTY toward 0 before it had to be resized straight back up when the tab was reactivated)", () => {
	it("does not refit or resize the backend when a resize notification fires while the pane is inactive (backgrounded)", async () => {
		render(TerminalPane, { sessionId: "s1", focused: false, active: false, onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();
		fitMock.mockClear();
		resizeTerminalMock.mockClear();

		// Simulates TerminalArea.svelte's container collapsing to 0x0 when its
		// tab is backgrounded (`.tab-tree { display: none }`) — the browser's
		// ResizeObserver fires for that collapse exactly like any other size
		// change.
		expect(resizeObserverCallback).toBeDefined();
		resizeObserverCallback!();

		expect(fitMock).not.toHaveBeenCalled();
		expect(resizeTerminalMock).not.toHaveBeenCalled();
	});

	it("refits and resizes the backend once the pane becomes active again", async () => {
		const { rerender } = render(TerminalPane, {
			sessionId: "s1",
			focused: false,
			active: false,
			onFocus: vi.fn(),
			onExit: vi.fn(),
		});
		await vi.runAllTimersAsync();
		fitMock.mockClear();
		resizeTerminalMock.mockClear();

		await rerender({ sessionId: "s1", focused: false, active: true, onFocus: vi.fn(), onExit: vi.fn() });

		// The real display:none -> flex flip fires a genuine ResizeObserver
		// notification (0x0 -> real size) right as the tab is foregrounded —
		// simulated here since jsdom has no layout engine to produce it itself.
		resizeObserverCallback!();

		expect(fitMock).toHaveBeenCalledOnce();
		expect(resizeTerminalMock).toHaveBeenCalledWith("s1", 24, 80);
	});
});

describe("TerminalPane — repaint on reactivation (regression: switching tabs away and back left a backgrounded split's non-focused pane blank, only repainting once clicked — reportResize's fit() is a no-op when the container's size didn't actually change, which is the common case for a tab regaining visibility, so the only thing that happened to repaint the *focused* pane was term.focus() incidentally forcing a fresh render frame; a pane that wasn't focused never got that side effect)", () => {
	it("forces a full repaint when a backgrounded pane's tab becomes active again, even though this pane isn't the focused one", async () => {
		const { rerender } = render(TerminalPane, {
			sessionId: "s1",
			focused: false,
			active: false,
			onFocus: vi.fn(),
			onExit: vi.fn(),
		});
		await vi.runAllTimersAsync();
		refreshMock.mockClear();

		await rerender({ sessionId: "s1", focused: false, active: true, onFocus: vi.fn(), onExit: vi.fn() });

		expect(refreshMock).toHaveBeenCalledWith(0, termInstance.rows - 1);
	});

	it("does not force a repaint just from being backgrounded (active stays false)", async () => {
		render(TerminalPane, { sessionId: "s1", focused: false, active: false, onFocus: vi.fn(), onExit: vi.fn() });
		await vi.runAllTimersAsync();

		expect(refreshMock).not.toHaveBeenCalled();
	});
});

describe("TerminalPane — shell exit (regression: the pane used to stay open forever after the shell process exited on its own, e.g. the user typing `exit`, since nothing ever told the frontend it had happened)", () => {
	function exitCallback(): () => void {
		const call = listenMock.mock.calls.find(([name]) => name === "pty://exit/s1");
		if (!call) throw new Error("expected a listen() call for pty://exit/s1");
		return call[1] as () => void;
	}

	it("calls onExit when the backend's pty://exit event for this session fires", () => {
		const onExit = vi.fn();
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit });

		exitCallback()();

		expect(onExit).toHaveBeenCalledOnce();
	});

	it("does not call onExit just from mounting (only the real event triggers it)", () => {
		const onExit = vi.fn();
		render(TerminalPane, { sessionId: "s1", onFocus: vi.fn(), onExit });

		expect(onExit).not.toHaveBeenCalled();
	});
});
