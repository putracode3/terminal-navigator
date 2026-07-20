import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import KeybindingRow from "./KeybindingRow.svelte";

function keydownOn(target: Window | Element, overrides: Partial<KeyboardEvent> & { key: string }) {
	return fireEvent.keyDown(target, { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...overrides });
}

describe("KeybindingRow", () => {
	it("renders the label and current combo", () => {
		render(KeybindingRow, { label: "Copy selection", combo: "Ctrl+Shift+C", onRebind: vi.fn(), checkConflict: vi.fn(() => null) });

		expect(screen.getByText("Copy selection")).toBeInTheDocument();
		expect(screen.getByText("Ctrl+Shift+C")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Rebind" })).toBeInTheDocument();
	});

	it("clicking Rebind enters recording mode", async () => {
		render(KeybindingRow, { label: "Copy selection", combo: "Ctrl+Shift+C", onRebind: vi.fn(), checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));

		expect(screen.getByText("Press a key combination…")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
		expect(screen.getByText("Recording — press a key combination")).toBeInTheDocument();
	});

	it("capturing a valid modified combo calls onRebind and shows Saved", async () => {
		const onRebind = vi.fn().mockResolvedValue(undefined);
		render(KeybindingRow, { label: "Split pane down", combo: "Alt+Shift+D", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await keydownOn(window, { key: "e", code: "KeyE", ctrlKey: true, shiftKey: true });

		await waitFor(() => expect(onRebind).toHaveBeenCalledWith("Ctrl+Shift+E"));
		expect(screen.getByText("Saved")).toBeInTheDocument();
	});

	it("rejects a combo with no Ctrl/Alt/Cmd modifier and stays recording", async () => {
		const onRebind = vi.fn();
		render(KeybindingRow, { label: "Split pane down", combo: "Alt+Shift+D", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await keydownOn(window, { key: "e", code: "KeyE", shiftKey: true }); // Shift alone — not enough

		expect(screen.getByText("Must include Ctrl, Alt, or Cmd")).toBeInTheDocument();
		expect(onRebind).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument(); // still recording
	});

	it("shows the conflicting action's label and stays recording, without calling onRebind", async () => {
		const onRebind = vi.fn();
		const checkConflict = vi.fn((combo: string) => (combo === "Ctrl+Shift+V" ? "Paste" : null));
		render(KeybindingRow, { label: "Copy selection", combo: "Ctrl+Shift+C", onRebind, checkConflict });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await keydownOn(window, { key: "v", code: "KeyV", ctrlKey: true, shiftKey: true });

		expect(screen.getByText("Already used by Paste")).toBeInTheDocument();
		expect(onRebind).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
	});

	it("can retry immediately after a rejection, within the same recording session", async () => {
		const onRebind = vi.fn().mockResolvedValue(undefined);
		render(KeybindingRow, { label: "Split pane down", combo: "Alt+Shift+D", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await keydownOn(window, { key: "e", code: "KeyE", shiftKey: true }); // rejected: no modifier
		await keydownOn(window, { key: "e", code: "KeyE", altKey: true }); // now valid

		await waitFor(() => expect(onRebind).toHaveBeenCalledWith("Alt+E"));
	});

	it("Escape cancels recording and reverts to the previous combo, without calling onRebind", async () => {
		const onRebind = vi.fn();
		render(KeybindingRow, { label: "Copy selection", combo: "Ctrl+Shift+C", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await keydownOn(window, { key: "Escape" });

		expect(onRebind).not.toHaveBeenCalled();
		expect(screen.getByText("Ctrl+Shift+C")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Rebind" })).toBeInTheDocument(); // back to idle
	});

	it("clicking Cancel exits recording without calling onRebind", async () => {
		const onRebind = vi.fn();
		render(KeybindingRow, { label: "Copy selection", combo: "Ctrl+Shift+C", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(onRebind).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Rebind" })).toBeInTheDocument();
	});

	it("Tab cancels recording (but does not preventDefault, so focus can still move on)", async () => {
		const onRebind = vi.fn();
		render(KeybindingRow, { label: "Copy selection", combo: "Ctrl+Shift+C", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
		window.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
		expect(onRebind).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.getByRole("button", { name: "Rebind" })).toBeInTheDocument());
	});

	// Fixed regression (was a documented KNOWN GAP as of architecture.md
	// v1.2/v1.3): `e.key === "Tab"` used to cancel recording unconditionally,
	// regardless of held modifiers, so Ctrl+Tab/Ctrl+Shift+Tab could never be
	// captured through this UI. Now only *bare* Tab (or Shift+Tab — Shift
	// alone isn't a "required modifier") cancels; a modified Tab is captured
	// like any other combo.
	it("allows capturing a Ctrl+Tab combo", async () => {
		const onRebind = vi.fn().mockResolvedValue(undefined);
		render(KeybindingRow, { label: "Next tab", combo: "Ctrl+Tab", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await fireEvent.keyDown(window, { key: "Tab", code: "Tab", ctrlKey: true });

		await waitFor(() => expect(onRebind).toHaveBeenCalledWith("Ctrl+Tab"));
	});

	it("allows capturing a Ctrl+Shift+Tab combo", async () => {
		const onRebind = vi.fn().mockResolvedValue(undefined);
		render(KeybindingRow, { label: "Previous tab", combo: "Ctrl+Shift+Tab", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await fireEvent.keyDown(window, { key: "Tab", code: "Tab", ctrlKey: true, shiftKey: true });

		await waitFor(() => expect(onRebind).toHaveBeenCalledWith("Ctrl+Shift+Tab"));
	});

	it("bare Shift+Tab (no Ctrl/Alt/Cmd) still cancels recording — Shift alone isn't a required modifier", async () => {
		const onRebind = vi.fn();
		render(KeybindingRow, { label: "Copy selection", combo: "Ctrl+Shift+C", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await fireEvent.keyDown(window, { key: "Tab", code: "Tab", shiftKey: true });

		expect(onRebind).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Rebind" })).toBeInTheDocument(); // back to idle, not still recording
	});

	it("a bare modifier keydown (e.g. Ctrl alone) does not resolve the capture — waits for the completing key", async () => {
		const onRebind = vi.fn().mockResolvedValue(undefined);
		render(KeybindingRow, { label: "Copy selection", combo: "Ctrl+Shift+C", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await keydownOn(window, { key: "Control", ctrlKey: true });
		expect(onRebind).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument(); // still recording

		await keydownOn(window, { key: "e", code: "KeyE", ctrlKey: true });
		await waitFor(() => expect(onRebind).toHaveBeenCalledWith("Ctrl+E"));
	});

	it("falls back to showing the backend's error message if onRebind rejects unexpectedly (defense-in-depth)", async () => {
		const onRebind = vi.fn().mockRejectedValue(new Error("failed to read/write settings file"));
		render(KeybindingRow, { label: "Copy selection", combo: "Ctrl+Shift+C", onRebind, checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		await keydownOn(window, { key: "e", code: "KeyE", ctrlKey: true });

		await waitFor(() => expect(screen.getByText("failed to read/write settings file")).toBeInTheDocument());
	});

	it("removes its window keydown listener on unmount (no leak across rows)", async () => {
		const addSpy = vi.spyOn(window, "addEventListener");
		const removeSpy = vi.spyOn(window, "removeEventListener");
		const { unmount } = render(KeybindingRow, { label: "Copy selection", combo: "Ctrl+Shift+C", onRebind: vi.fn(), checkConflict: vi.fn(() => null) });

		await fireEvent.click(screen.getByRole("button", { name: "Rebind" }));
		const [, handler] = addSpy.mock.calls.find(([type]) => type === "keydown")!;

		unmount();

		expect(removeSpy).toHaveBeenCalledWith("keydown", handler, true);
		addSpy.mockRestore();
		removeSpy.mockRestore();
	});
});
