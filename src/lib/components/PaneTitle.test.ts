import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/svelte";

const getGitBranchMock = vi.fn();
vi.mock("$lib/api", () => ({
	getGitBranch: (...args: unknown[]) => getGitBranchMock(...args),
}));

import PaneTitle from "./PaneTitle.svelte";
import { __resetGitBranchCacheForTests } from "$lib/git-branch-cache";

beforeEach(() => {
	getGitBranchMock.mockReset();
	// The cache is a module-level singleton (by design — see its own doc
	// comment) so, without this, a later test reusing the same cwd string
	// (several tests below all use "/home/user/proj") would silently reuse
	// whatever an earlier test's mock resolved instead of exercising its
	// own mock.
	__resetGitBranchCacheForTests();
});

describe("PaneTitle — FR-17 git branch detection", () => {
	it("shows the (possibly truncated) cwd as the tooltip", () => {
		getGitBranchMock.mockResolvedValue(null);
		render(PaneTitle, { cwd: "/home/user/proj" });

		expect(screen.getByTitle("/home/user/proj")).toBeInTheDocument();
	});

	it("appends the detected branch after the cwd once resolved", async () => {
		getGitBranchMock.mockResolvedValue("main");
		const { container } = render(PaneTitle, { cwd: "/home/user/proj" });

		await waitFor(() => expect(container.querySelector(".branch")).toHaveTextContent("main"));
		expect(getGitBranchMock).toHaveBeenCalledWith("/home/user/proj");
	});

	it("shows no branch element when the path is not a git repository (null result)", async () => {
		getGitBranchMock.mockResolvedValue(null);
		const { container } = render(PaneTitle, { cwd: "/home/user/proj" });

		await waitFor(() => expect(getGitBranchMock).toHaveBeenCalled());
		expect(container.querySelector(".branch")).toBeNull();
	});

	it("shows no branch element (does not throw) when the branch lookup rejects", async () => {
		getGitBranchMock.mockRejectedValue(new Error("ipc failed"));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const { container } = render(PaneTitle, { cwd: "/home/user/proj" });

		await waitFor(() => expect(consoleError).toHaveBeenCalled());
		expect(container.querySelector(".branch")).toBeNull();
		consoleError.mockRestore();
	});

	it("truncates a long path in the middle, same as the pre-FR-17 pane header", () => {
		getGitBranchMock.mockResolvedValue(null);
		const longPath = "/home/user/" + "a".repeat(60) + "/proj";
		const { container } = render(PaneTitle, { cwd: longPath });

		const cwdEl = container.querySelector(".cwd")!;
		expect(cwdEl.textContent).toContain("…");
		expect(cwdEl.textContent!.length).toBeLessThan(longPath.length);
	});

	// Regression (code review, Minor finding): a forced leaf remount — the
	// same class of pane-tree restructuring $lib/terminal-registry exists to
	// survive for TerminalPane — used to re-fire this component's initial
	// load and repeat the getGitBranch round-trip for a cwd already
	// resolved.
	it("only calls getGitBranch once for a given cwd across multiple unfocused mounts (memoized via $lib/git-branch-cache)", async () => {
		getGitBranchMock.mockResolvedValue("main");

		const first = render(PaneTitle, { cwd: "/home/user/proj" });
		await waitFor(() => expect(first.container.querySelector(".branch")).toHaveTextContent("main"));
		first.unmount();

		const second = render(PaneTitle, { cwd: "/home/user/proj" });
		await waitFor(() => expect(second.container.querySelector(".branch")).toHaveTextContent("main"));

		expect(getGitBranchMock).toHaveBeenCalledOnce();
	});
});

describe("PaneTitle — focus-refresh follow-up (updates after a git checkout run inside the pane)", () => {
	it("refreshes, bypassing the cache, when the pane transitions to focused", async () => {
		getGitBranchMock.mockResolvedValueOnce("main").mockResolvedValueOnce("feature/foo");
		const { container, rerender } = render(PaneTitle, { cwd: "/home/user/proj", focused: false });
		await waitFor(() => expect(container.querySelector(".branch")).toHaveTextContent("main"));
		expect(getGitBranchMock).toHaveBeenCalledOnce();

		await rerender({ cwd: "/home/user/proj", focused: true });

		await waitFor(() => expect(container.querySelector(".branch")).toHaveTextContent("feature/foo"));
		expect(getGitBranchMock).toHaveBeenCalledTimes(2);
	});

	it("does not refetch just because it loses focus (only a focus GAIN triggers a refresh)", async () => {
		getGitBranchMock.mockResolvedValue("main");
		const { container, rerender } = render(PaneTitle, { cwd: "/home/user/proj", focused: true });
		await waitFor(() => expect(container.querySelector(".branch")).toHaveTextContent("main"));
		expect(getGitBranchMock).toHaveBeenCalledOnce();

		await rerender({ cwd: "/home/user/proj", focused: false });
		await Promise.resolve();

		expect(getGitBranchMock).toHaveBeenCalledOnce();
	});

	it("does not double-fetch when the pane is already focused on its very first mount", async () => {
		getGitBranchMock.mockResolvedValue("main");
		const { container } = render(PaneTitle, { cwd: "/home/user/proj", focused: true });

		await waitFor(() => expect(container.querySelector(".branch")).toHaveTextContent("main"));
		expect(getGitBranchMock).toHaveBeenCalledOnce();
	});
});

describe("PaneTitle — manual refresh button", () => {
	it("is labeled for assistive tech and re-fetches (bypassing the cache) when clicked", async () => {
		getGitBranchMock.mockResolvedValueOnce("main").mockResolvedValueOnce("main");
		const { container } = render(PaneTitle, { cwd: "/home/user/proj", focused: false });
		await waitFor(() => expect(container.querySelector(".branch")).toHaveTextContent("main"));
		expect(getGitBranchMock).toHaveBeenCalledOnce();

		await fireEvent.click(screen.getByRole("button", { name: "Refresh git branch" }));

		await waitFor(() => expect(getGitBranchMock).toHaveBeenCalledTimes(2));
	});

	it("updates the displayed branch after the refresh resolves", async () => {
		getGitBranchMock.mockResolvedValueOnce("main").mockResolvedValueOnce("feature/foo");
		const { container } = render(PaneTitle, { cwd: "/home/user/proj", focused: false });
		await waitFor(() => expect(container.querySelector(".branch")).toHaveTextContent("main"));

		await fireEvent.click(screen.getByRole("button", { name: "Refresh git branch" }));

		await waitFor(() => expect(container.querySelector(".branch")).toHaveTextContent("feature/foo"));
	});
});
