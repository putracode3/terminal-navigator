import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ModalTestHarness from "./ModalTestHarness.svelte";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Modal", () => {
	it("renders nothing when closed", () => {
		render(ModalTestHarness, { open: false, onClose: vi.fn() });
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("renders the dialog with title and content when open", () => {
		render(ModalTestHarness, { open: true, onClose: vi.fn() });
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByText("Test modal")).toBeInTheDocument();
		expect(screen.getByText("Modal body content")).toBeInTheDocument();
	});

	it("calls onClose when Escape is pressed", async () => {
		const onClose = vi.fn();
		render(ModalTestHarness, { open: true, onClose });
		await fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("calls onClose when the close button is clicked", async () => {
		const onClose = vi.fn();
		render(ModalTestHarness, { open: true, onClose });
		await fireEvent.click(screen.getByRole("button", { name: /close dialog/i }));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("calls onClose on backdrop click when closeOnBackdropClick is true", async () => {
		const onClose = vi.fn();
		const { container } = render(ModalTestHarness, {
			open: true,
			onClose,
			closeOnBackdropClick: true,
		});
		await fireEvent.click(container.querySelector(".backdrop")!);
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("does NOT call onClose on backdrop click when closeOnBackdropClick is false", async () => {
		const onClose = vi.fn();
		const { container } = render(ModalTestHarness, {
			open: true,
			onClose,
			closeOnBackdropClick: false,
		});
		await fireEvent.click(container.querySelector(".backdrop")!);
		expect(onClose).not.toHaveBeenCalled();
	});

	it("clicking inside the dialog does not trigger a backdrop close", async () => {
		const onClose = vi.fn();
		render(ModalTestHarness, { open: true, onClose });
		await fireEvent.click(screen.getByText("Modal body content"));
		expect(onClose).not.toHaveBeenCalled();
	});

	it("moves focus into the dialog when opened", async () => {
		const { rerender } = render(ModalTestHarness, { open: false, onClose: vi.fn() });
		await rerender({ open: true, onClose: vi.fn() });
		await flush();
		expect(document.activeElement?.tagName).not.toBe("BODY");
		expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
	});

	it("traps Tab focus within the dialog, wrapping from the last element to the first", async () => {
		const onClose = vi.fn();
		render(ModalTestHarness, { open: true, onClose });
		await flush();

		const dialog = screen.getByRole("dialog");
		const confirmBtn = screen.getByRole("button", { name: "Confirm" });
		confirmBtn.focus();

		await fireEvent.keyDown(dialog, { key: "Tab" });

		expect(document.activeElement).toBe(screen.getByRole("button", { name: /close dialog/i }));
	});

	it("shift+Tab from the first element wraps to the last", async () => {
		const onClose = vi.fn();
		render(ModalTestHarness, { open: true, onClose });
		await flush();

		const dialog = screen.getByRole("dialog");
		const closeBtn = screen.getByRole("button", { name: /close dialog/i });
		closeBtn.focus();

		await fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm" }));
	});
});
