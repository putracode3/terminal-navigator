import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Textarea from "./Textarea.svelte";

describe("Textarea — autosave (components.md: no manual Save button)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not call onSave immediately on input", async () => {
		const onSave = vi.fn();
		render(Textarea, { id: "t1", label: "Notes", value: "", onSave });
		await fireEvent.input(screen.getByLabelText("Notes"), { target: { value: "hello" } });
		expect(onSave).not.toHaveBeenCalled();
	});

	it("calls onSave after the debounce interval elapses", async () => {
		const onSave = vi.fn();
		render(Textarea, { id: "t1", label: "Notes", value: "", onSave });
		await fireEvent.input(screen.getByLabelText("Notes"), { target: { value: "hello" } });
		await vi.advanceTimersByTimeAsync(1000);
		expect(onSave).toHaveBeenCalledWith("hello");
	});

	it("calls onSave immediately on blur, without waiting for the debounce", async () => {
		const onSave = vi.fn();
		render(Textarea, { id: "t1", label: "Notes", value: "", onSave });
		const el = screen.getByLabelText("Notes");
		await fireEvent.input(el, { target: { value: "hello" } });
		await fireEvent.blur(el);
		expect(onSave).toHaveBeenCalledWith("hello");
	});

	it("resets the debounce on each keystroke — saves once, only after typing stops", async () => {
		const onSave = vi.fn();
		render(Textarea, { id: "t1", label: "Notes", value: "", onSave });
		const el = screen.getByLabelText("Notes");

		await fireEvent.input(el, { target: { value: "h" } });
		await vi.advanceTimersByTimeAsync(600);
		await fireEvent.input(el, { target: { value: "he" } });
		await vi.advanceTimersByTimeAsync(600);
		expect(onSave).not.toHaveBeenCalled(); // <1000ms since the last keystroke

		await vi.advanceTimersByTimeAsync(500);
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave).toHaveBeenCalledWith("he");
	});

	it("shows 'Saving…' then 'Saved' status text around the save", async () => {
		let resolveSave!: () => void;
		const onSave = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSave = resolve;
				}),
		);
		render(Textarea, { id: "t1", label: "Notes", value: "", onSave });
		const el = screen.getByLabelText("Notes");
		await fireEvent.input(el, { target: { value: "x" } });
		await fireEvent.blur(el);

		expect(screen.getByText("Saving…")).toBeInTheDocument();
		resolveSave();
		await vi.advanceTimersByTimeAsync(0);
		expect(screen.getByText("Saved")).toBeInTheDocument();
	});

	it("is a no-op when no onSave is provided (e.g. used inside a form with its own Save button)", async () => {
		render(Textarea, { id: "t1", label: "Setup commands" });
		const el = screen.getByLabelText("Setup commands");
		await fireEvent.input(el, { target: { value: "echo hi" } });
		await fireEvent.blur(el);
		await vi.advanceTimersByTimeAsync(2000);
		expect(screen.queryByText("Saving…")).toBeNull();
	});
});
