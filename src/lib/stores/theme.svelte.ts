// design.md §4.1a / §9 rule 10 — resolves the user's Dark/Light/System
// preference into a concrete theme.
//
// This lives in its own module rather than inside +layout.svelte because two
// unrelated consumers need the *resolved* value, not the raw preference:
// the layout (which writes `data-theme` on <html>) and the terminal preset
// resolver (design.md §9 rule 11, App Default's theme-aware variant). Having
// the matchMedia subscription in one place is what keeps those two from
// disagreeing — the exact failure mode §8's "never a CSS media query" rule
// exists to prevent, one layer up.
import { settingsStore } from "./settings.svelte";

export type ResolvedTheme = "dark" | "light";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

class ThemeStore {
	// Seeded from the query's current value, not `false`, so the very first
	// read is already correct rather than only the eventual one (there is no
	// `change` event for the state the app starts in).
	systemPrefersLight = $state(false);

	constructor() {
		// Guarded: this module is imported by unit tests and by the SSR-less
		// SvelteKit build, neither of which is guaranteed a real matchMedia.
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		const query = window.matchMedia(LIGHT_QUERY);
		this.systemPrefersLight = query.matches;
		// Never removed on purpose — this is an app-lifetime singleton, same
		// as settingsStore; there is no unmount at which it would be wrong.
		query.addEventListener("change", (e) => {
			this.systemPrefersLight = e.matches;
		});
	}

	/** The concrete theme in effect right now. "system" is the only mode that
	 *  depends on the OS; "dark"/"light" are already concrete. */
	get resolved(): ResolvedTheme {
		const mode = settingsStore.themeMode;
		if (mode === "system") return this.systemPrefersLight ? "light" : "dark";
		return mode;
	}
}

export const themeStore = new ThemeStore();
