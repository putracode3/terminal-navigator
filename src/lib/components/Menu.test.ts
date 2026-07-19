import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Menu from "./Menu.svelte";

function items(overrides: Partial<{ onOpen: () => void; onEdit: () => void; onDelete: () => void }> = {}) {
	return [
		{ label: "Open in new tab", onSelect: overrides.onOpen ?? vi.fn() },
		{ label: "Edit", onSelect: overrides.onEdit ?? vi.fn() },
		{ label: "Delete", onSelect: overrides.onDelete ?? vi.fn(), danger: true },
	];
}

const flush = () => new Promise((r) => setTimeout(r, 10));

describe("Menu — anchored + context variants (components.md: identical content either way)", () => {
	it("renders nothing when closed", () => {
		render(Menu, { open: false, items: items(), onClose: vi.fn() });
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("renders every item when open", () => {
		render(Menu, { open: true, items: items(), onClose: vi.fn() });
		expect(screen.getByRole("menuitem", { name: "Open in new tab" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
	});

	it("selecting an item calls its onSelect and then onClose", async () => {
		const onOpen = vi.fn();
		const onClose = vi.fn();
		render(Menu, { open: true, items: items({ onOpen }), onClose });

		await fireEvent.click(screen.getByRole("menuitem", { name: "Open in new tab" }));

		expect(onOpen).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("Escape closes the menu", async () => {
		const onClose = vi.fn();
		const { container } = render(Menu, { open: true, items: items(), onClose });
		await flush();

		await fireEvent.keyDown(container, { key: "Escape" });
		// The listener is on window, not the container — dispatch there directly too.
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

		expect(onClose).toHaveBeenCalled();
	});

	it("clicking outside the menu closes it", async () => {
		const onClose = vi.fn();
		render(Menu, { open: true, items: items(), onClose });
		await flush();

		const outside = document.createElement("div");
		document.body.appendChild(outside);
		await fireEvent.click(outside);

		expect(onClose).toHaveBeenCalledOnce();
		document.body.removeChild(outside);
	});

	it("clicking inside the menu (e.g. on an item) does not trigger the outside-click close twice", async () => {
		const onClose = vi.fn();
		render(Menu, { open: true, items: items(), onClose });
		await flush();

		await fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

		expect(onClose).toHaveBeenCalledOnce();
	});

	it("ArrowDown/ArrowUp moves focus between items, wrapping at the ends", async () => {
		render(Menu, { open: true, items: items(), onClose: vi.fn() });
		await flush();

		const menuItemEls = screen.getAllByRole("menuitem");
		menuItemEls[0].focus();

		await fireEvent.keyDown(window, { key: "ArrowDown" });
		expect(menuItemEls[1]).toHaveFocus();

		await fireEvent.keyDown(window, { key: "ArrowUp" });
		expect(menuItemEls[0]).toHaveFocus();

		// wraps from the first item backward to the last
		await fireEvent.keyDown(window, { key: "ArrowUp" });
		expect(menuItemEls[2]).toHaveFocus();
	});

	it("context variant (anchorPosition set) renders with fixed positioning at the given coordinates", () => {
		render(Menu, { open: true, items: items(), anchorPosition: { x: 50, y: 80 }, onClose: vi.fn() });
		const menu = screen.getByRole("menu");
		expect(menu.style.left).toBe("50px");
		expect(menu.style.top).toBe("80px");
	});

	it("anchored variant (no anchorPosition) renders with no inline position style", () => {
		render(Menu, { open: true, items: items(), onClose: vi.fn() });
		const menu = screen.getByRole("menu");
		expect(menu.getAttribute("style")).toBe("");
	});
});
