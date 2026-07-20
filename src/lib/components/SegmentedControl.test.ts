import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SegmentedControl from "./SegmentedControl.svelte";

const options = [
	{ value: "left", label: "Left" },
	{ value: "right", label: "Right" },
];

describe("SegmentedControl", () => {
	it("renders a radiogroup with one radio per option", () => {
		render(SegmentedControl, { options, value: "left", onChange: vi.fn(), ariaLabel: "Sidebar position" });

		expect(screen.getByRole("radiogroup", { name: "Sidebar position" })).toBeInTheDocument();
		expect(screen.getAllByRole("radio")).toHaveLength(2);
	});

	it("marks the current value's segment as checked, and only that one", () => {
		render(SegmentedControl, { options, value: "right", onChange: vi.fn(), ariaLabel: "Sidebar position" });

		expect(screen.getByRole("radio", { name: "Left" })).toHaveAttribute("aria-checked", "false");
		expect(screen.getByRole("radio", { name: "Right" })).toHaveAttribute("aria-checked", "true");
	});

	it("calls onChange with the clicked segment's value", async () => {
		const onChange = vi.fn();
		render(SegmentedControl, { options, value: "left", onChange, ariaLabel: "Sidebar position" });

		await fireEvent.click(screen.getByRole("radio", { name: "Right" }));

		expect(onChange).toHaveBeenCalledWith("right");
	});

	it("ArrowRight/ArrowLeft move selection, wrapping at the ends", async () => {
		const onChange = vi.fn();
		const { rerender } = render(SegmentedControl, { options, value: "left", onChange, ariaLabel: "Sidebar position" });

		await fireEvent.keyDown(screen.getByRole("radio", { name: "Left" }), { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalledWith("right");

		// Simulate the parent (a controlled component) applying the change
		// before the next keypress — value only ever moves via this prop.
		onChange.mockClear();
		await rerender({ options, value: "right", onChange, ariaLabel: "Sidebar position" });
		await fireEvent.keyDown(screen.getByRole("radio", { name: "Right" }), { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalledWith("left"); // wraps
	});

	it("only the selected segment is in the natural tab order", () => {
		render(SegmentedControl, { options, value: "left", onChange: vi.fn(), ariaLabel: "Sidebar position" });

		expect(screen.getByRole("radio", { name: "Left" })).toHaveAttribute("tabindex", "0");
		expect(screen.getByRole("radio", { name: "Right" })).toHaveAttribute("tabindex", "-1");
	});
});
