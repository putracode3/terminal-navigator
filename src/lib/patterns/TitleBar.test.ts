import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
// imported as JSON (tsconfig `resolveJsonModule`) rather than read via node:fs
// — this repo has no @types/node, so fs/path/url builtins fail `npm run check`
import capabilities from "../../../src-tauri/capabilities/default.json";

const minimizeMock = vi.fn();
const toggleMaximizeMock = vi.fn();
const closeMock = vi.fn();
const isMaximizedMock = vi.fn();
const onResizedMock = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		minimize: (...args: unknown[]) => minimizeMock(...args),
		toggleMaximize: (...args: unknown[]) => toggleMaximizeMock(...args),
		close: (...args: unknown[]) => closeMock(...args),
		isMaximized: (...args: unknown[]) => isMaximizedMock(...args),
		onResized: (...args: unknown[]) => onResizedMock(...args),
	}),
}));

// TitleBar renders ProjectFormModal/SettingsModal (both closed by default) —
// their own Tauri-facing imports still resolve at module load, same reason
// Sidebar.test.ts (pre-v2.8) had to mock this for the same transitively
// rendered ProjectFormModal.
vi.mock("@tauri-apps/plugin-dialog", () => ({
	save: vi.fn(),
	open: vi.fn(),
}));

import TitleBar from "./TitleBar.svelte";
import { appStore } from "$lib/stores/app.svelte";

beforeEach(() => {
	minimizeMock.mockReset();
	toggleMaximizeMock.mockReset();
	closeMock.mockReset();
	isMaximizedMock.mockReset();
	onResizedMock.mockReset();
	isMaximizedMock.mockResolvedValue(false);
	onResizedMock.mockResolvedValue(() => {});
	appStore.ready = true;
	appStore.search = "";
	appStore.sidebarHidden = false;
});

describe("TitleBar — window controls", () => {
	it("clicking Minimize calls the window's minimize command", async () => {
		render(TitleBar);

		await fireEvent.click(screen.getByRole("button", { name: "Minimize" }));

		expect(minimizeMock).toHaveBeenCalled();
	});

	it("clicking Close calls the window's close command", async () => {
		render(TitleBar);

		await fireEvent.click(screen.getByRole("button", { name: "Close" }));

		expect(closeMock).toHaveBeenCalled();
	});

	it("clicking Maximize toggles the window's maximize state", async () => {
		render(TitleBar);

		await fireEvent.click(screen.getByRole("button", { name: "Maximize" }));

		expect(toggleMaximizeMock).toHaveBeenCalled();
	});

	it("shows Restore instead of Maximize once the window reports maximized", async () => {
		isMaximizedMock.mockResolvedValue(true);
		render(TitleBar);

		expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
	});
});

describe("TitleBar — sidebar toggle (relocated from Sidebar.svelte, v2.8)", () => {
	it("clicking 'Hide sidebar' sets appStore.sidebarHidden", async () => {
		render(TitleBar);

		await fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

		expect(appStore.sidebarHidden).toBe(true);
	});
});

describe("TitleBar — Settings trigger (relocated from Sidebar.svelte, v2.8)", () => {
	it("does not render the Settings modal until opened", () => {
		render(TitleBar);

		expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
	});

	it("clicking the Settings button opens the Settings modal", async () => {
		render(TitleBar);

		await fireEvent.click(screen.getByRole("button", { name: "Settings" }));

		expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
	});
});

describe("TitleBar — Add project trigger", () => {
	it("clicking '+ Add project' opens the project form modal", async () => {
		render(TitleBar);

		await fireEvent.click(screen.getByRole("button", { name: "+ Add project" }));

		expect(screen.getByRole("dialog", { name: "Add project" })).toBeInTheDocument();
	});
});

describe("TitleBar — not-ready state", () => {
	it("hides search, sidebar-toggle, settings and add-project before the store is ready, but keeps window controls", () => {
		appStore.ready = false;
		render(TitleBar);

		expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
		expect(screen.queryByRole("button", { name: "+ Add project" })).toBeNull();
		expect(screen.queryByRole("button", { name: /Hide sidebar|Show sidebar/ })).toBeNull();
		expect(screen.queryByPlaceholderText("Search projects…")).toBeNull();

		expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
	});
});

// Regression: with `decorations: false` (ADR-0013) the window was completely
// unmovable — dragging the Title Bar did nothing, while double-clicking it
// still toggled maximize. Root cause was NOT the markup below the DOM but this
// capability file: ADR-0013 originally withheld `core:window:allow-start-dragging`
// on the (false) premise that `data-tauri-drag-region` is handled by wry at the
// webview level and so bypasses the permission pipeline.
//
// Tauri's injected drag script (tauri/src/window/scripts/drag.js) actually does:
//     const cmd = e.detail === 2 ? 'internal_toggle_maximize' : 'start_dragging'
//     window.__TAURI_INTERNALS__.invoke('plugin:window|' + cmd)
// — the attribute only decides *whether* to invoke; the invoke is an ordinary
// IPC command subject to capabilities. Double-click masked the bug because
// `internal_toggle_maximize` is the one state-changing command already inside
// `core:window:default`.
//
// This asserts on the capability file itself rather than the component: the
// gesture (`data-tauri-drag-region` → wry → GTK) is below the DOM and cannot be
// exercised in jsdom (docs/qa/test-plan.md §5.1 step 6 owns the manual half).
// The *permission contract* it depends on is plain JSON and fully testable —
// which is the half that actually broke.
describe("Window chrome capabilities (ADR-0013) — regression: window unmovable", () => {
	it("grants start-dragging, without which data-tauri-drag-region silently cannot move the window", () => {
		expect(capabilities.permissions).toContain("core:window:allow-start-dragging");
	});

	it("grants every window-control command the Title Bar and resize handles invoke", () => {
		expect(capabilities.permissions).toEqual(
			expect.arrayContaining([
				"core:window:allow-minimize",
				"core:window:allow-toggle-maximize",
				"core:window:allow-close",
				"core:window:allow-start-resize-dragging",
			]),
		);
	});
});
