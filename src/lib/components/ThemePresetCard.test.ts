import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ThemePresetCard from "./ThemePresetCard.svelte";
import { getThemePreset } from "$lib/theme-presets";

const preset = getThemePreset("dracula");

// jsdom's CSSOM normalizes a hex color set via the `background`/`color`
// shorthand to rgb() on readback — this converts the preset's hex so the
// test compares like-for-like instead of asserting a literal "#282A36".
function hexToRgb(hex: string): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

describe("ThemePresetCard", () => {
	it("renders as a radio with the preset name", () => {
		render(ThemePresetCard, { preset, selected: false, onSelect: vi.fn() });

		expect(screen.getByRole("radio", { name: /Dracula/ })).toBeInTheDocument();
	});

	it("reflects selected state via aria-checked", () => {
		const { rerender } = render(ThemePresetCard, { preset, selected: false, onSelect: vi.fn() });
		expect(screen.getByRole("radio")).toHaveAttribute("aria-checked", "false");

		rerender({ preset, selected: true, onSelect: vi.fn() });
		expect(screen.getByRole("radio")).toHaveAttribute("aria-checked", "true");
	});

	it("shows a checkmark only when selected", () => {
		const { rerender, container } = render(ThemePresetCard, { preset, selected: false, onSelect: vi.fn() });
		expect(container.querySelector(".check")).toBeNull();

		rerender({ preset, selected: true, onSelect: vi.fn() });
		expect(container.querySelector(".check")).not.toBeNull();
	});

	it("calls onSelect when clicked", async () => {
		const onSelect = vi.fn();
		render(ThemePresetCard, { preset, selected: false, onSelect });

		await fireEvent.click(screen.getByRole("radio"));

		expect(onSelect).toHaveBeenCalledOnce();
	});

	it("renders the preview using the preset's own actual colors, not a stylized abstraction", () => {
		const { container } = render(ThemePresetCard, { preset, selected: false, onSelect: vi.fn() });
		const preview = container.querySelector(".preview") as HTMLElement;

		expect(preview.style.background).toBe(hexToRgb(preset.theme.background!));
		expect(preview.style.color).toBe(hexToRgb(preset.theme.foreground!));
	});
});
