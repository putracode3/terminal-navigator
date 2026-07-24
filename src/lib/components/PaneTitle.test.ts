import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/svelte";

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
	it("shows the (possibly truncated) cwd as the title attribute", () => {
		getGitBranchMock.mockResolvedValue(null);
		render(PaneTitle, { cwd: "/home/user/proj" });

		expect(screen.getByTitle("/home/user/proj")).toBeInTheDocument();
	});

	it("appends the detected branch after the cwd once resolved", async () => {
		getGitBranchMock.mockResolvedValue("main");
		render(PaneTitle, { cwd: "/home/user/proj" });

		await waitFor(() => expect(screen.getByTitle("/home/user/proj")).toHaveTextContent("main"));
		expect(getGitBranchMock).toHaveBeenCalledWith("/home/user/proj");
	});

	it("shows nothing extra when the path is not a git repository (null result)", async () => {
		getGitBranchMock.mockResolvedValue(null);
		render(PaneTitle, { cwd: "/home/user/proj" });

		await waitFor(() => expect(getGitBranchMock).toHaveBeenCalled());
		expect(screen.getByTitle("/home/user/proj").textContent?.trim()).toBe("/home/user/proj");
	});

	it("shows nothing extra (does not throw) when the branch lookup rejects", async () => {
		getGitBranchMock.mockRejectedValue(new Error("ipc failed"));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		render(PaneTitle, { cwd: "/home/user/proj" });

		await waitFor(() => expect(consoleError).toHaveBeenCalled());
		expect(screen.getByTitle("/home/user/proj").textContent?.trim()).toBe("/home/user/proj");
		consoleError.mockRestore();
	});

	it("truncates a long path in the middle, same as the pre-FR-17 pane header", () => {
		getGitBranchMock.mockResolvedValue(null);
		const longPath = "/home/user/" + "a".repeat(60) + "/proj";
		render(PaneTitle, { cwd: longPath });

		const el = screen.getByTitle(longPath);
		expect(el.textContent).toContain("…");
		expect(el.textContent!.length).toBeLessThan(longPath.length);
	});

	// Regression (code review, Minor finding): a forced leaf remount — the
	// same class of pane-tree restructuring $lib/terminal-registry exists to
	// survive for TerminalPane — used to re-fire this component's onMount
	// and repeat the getGitBranch round-trip for a cwd already resolved.
	it("only calls getGitBranch once for a given cwd across multiple mounts (memoized via $lib/git-branch-cache)", async () => {
		getGitBranchMock.mockResolvedValue("main");

		const first = render(PaneTitle, { cwd: "/home/user/proj" });
		await waitFor(() => expect(screen.getByTitle("/home/user/proj")).toHaveTextContent("main"));
		first.unmount();

		render(PaneTitle, { cwd: "/home/user/proj" });
		await waitFor(() => expect(screen.getByTitle("/home/user/proj")).toHaveTextContent("main"));

		expect(getGitBranchMock).toHaveBeenCalledOnce();
	});
});
