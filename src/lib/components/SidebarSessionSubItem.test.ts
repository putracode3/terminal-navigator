import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SidebarSessionSubItem from "./SidebarSessionSubItem.svelte";
import type { TabState } from "$lib/stores/terminal.svelte";

function makeSession(overrides: Partial<TabState> = {}): TabState {
	return {
		id: "tab-1",
		projectId: "proj-1",
		projectName: "my-project",
		root: { type: "leaf", sessionId: "pane-1", cwd: "/home/user/my-project", status: "ready" },
		focusedPaneId: "pane-1",
		sessionOrdinal: 2,
		...overrides,
	};
}

function baseProps(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		session: makeSession(),
		onSelect: vi.fn(),
		onClose: vi.fn(),
		onDragStart: vi.fn(),
		onDragEnd: vi.fn(),
		...overrides,
	};
}

describe("SidebarSessionSubItem", () => {
	it("labels itself by the session's stable ordinal, not array position", () => {
		render(SidebarSessionSubItem, baseProps({ session: makeSession({ sessionOrdinal: 2 }) }));
		expect(screen.getByText("Session 2")).toBeInTheDocument();
	});

	it("click calls onSelect", async () => {
		const onSelect = vi.fn();
		render(SidebarSessionSubItem, baseProps({ onSelect }));

		await fireEvent.click(screen.getByText("Session 2"));

		expect(onSelect).toHaveBeenCalledOnce();
	});

	it("Enter key calls onSelect", async () => {
		const onSelect = vi.fn();
		render(SidebarSessionSubItem, baseProps({ onSelect }));

		await fireEvent.keyDown(screen.getByText("Session 2"), { key: "Enter" });

		expect(onSelect).toHaveBeenCalledOnce();
	});

	it("the close button calls onClose, not onSelect", async () => {
		const onSelect = vi.fn();
		const onClose = vi.fn();
		render(SidebarSessionSubItem, baseProps({ onSelect, onClose }));

		await fireEvent.click(screen.getByRole("button", { name: "Close Session 2" }));

		expect(onClose).toHaveBeenCalledOnce();
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("applies the active class when active is true", () => {
		const { container } = render(SidebarSessionSubItem, baseProps({ active: true }));
		expect(container.querySelector(".sub-item")).toHaveClass("active");
	});

	it("does not apply the active class by default", () => {
		const { container } = render(SidebarSessionSubItem, baseProps());
		expect(container.querySelector(".sub-item")).not.toHaveClass("active");
	});

	it("is draggable, and dragstart calls onDragStart", async () => {
		const onDragStart = vi.fn();
		const { container } = render(SidebarSessionSubItem, baseProps({ onDragStart }));
		const el = container.querySelector(".sub-item")!;

		expect(el).toHaveAttribute("draggable", "true");
		// jsdom has no DataTransfer constructor — a minimal stub is enough,
		// since handleDragStart only calls setData()/reads effectAllowed.
		await fireEvent.dragStart(el, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });

		expect(onDragStart).toHaveBeenCalledOnce();
	});

	it("reflects the tab's aggregate status as a status dot class", () => {
		const errored = makeSession({
			root: { type: "leaf", sessionId: "pane-1", cwd: "/x", status: "error", errorMessage: "boom" },
		});
		const { container } = render(SidebarSessionSubItem, baseProps({ session: errored }));

		expect(container.querySelector(".status-dot")).toHaveClass("status-error");
	});
});
