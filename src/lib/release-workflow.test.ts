import { describe, it, expect } from "vitest";
import workflow from "../../.github/workflows/release.yml?raw";

// Debugger session 2026-09-29: the Linux installer built by CI needed
// GLIBC_2.39 and would not start on Debian 12 (glibc 2.36). A binary needs
// the glibc of the machine that BUILT it, and `ubuntu-latest` had moved to
// Ubuntu 24.04. The Linux leg must build on a runner whose glibc is not
// newer than the oldest distro the app is installed on (Debian 12: 2.36).
// This file is text-level on purpose: it guards the one line that broke.
// glibc shipped by each pinned runner image we may use, newest allowed last.
const RUNNER_GLIBC: Record<string, number> = { "ubuntu-20.04": 2.31, "ubuntu-22.04": 2.35 };
const OLDEST_TARGET_GLIBC = 2.36; // Debian 12, the author's machine

describe("release workflow: the Linux build runs on an old-enough glibc", () => {
	const platforms = [...workflow.matchAll(/^\s*-\s*platform:\s*(\S+)/gm)].map((m) => m[1]);
	const linux = platforms.filter((p) => p.startsWith("ubuntu"));

	it("has exactly one Linux build leg", () => {
		expect(linux).toHaveLength(1);
	});

	it("does not build the Linux installer on the moving ubuntu-latest image", () => {
		expect(linux[0]).not.toBe("ubuntu-latest");
	});

	it("uses a pinned runner whose glibc is not newer than Debian 12's", () => {
		const glibc = RUNNER_GLIBC[linux[0]];
		expect(glibc, `unknown runner ${linux[0]}: add its glibc to RUNNER_GLIBC`).toBeDefined();
		expect(glibc).toBeLessThanOrEqual(OLDEST_TARGET_GLIBC);
	});

	it("installs the Linux system dependencies on that same runner", () => {
		const cond = workflow.match(/if:\s*matrix\.platform\s*==\s*'([^']+)'/);
		expect(cond?.[1]).toBe(linux[0]);
	});
});
