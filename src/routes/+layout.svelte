<script lang="ts">
	import "../../docs/design/tokens.css";
	import "$lib/styles/base.css";
	import { settingsStore } from "$lib/stores/settings.svelte";
	import { themeStore } from "$lib/stores/theme.svelte";

	let { children } = $props();

	// FR-14 (design.md §4.6): publish the single intensity value to :root;
	// every glass surface derives its own alpha from it inside tokens.css.
	//
	// `data-glass` is the NFR-9 gate, and it is not redundant with the
	// number: `backdrop-filter: blur(0px)` still promotes the element to
	// its own compositing layer and pays that cost for no visual result, so
	// at intensity 0 the property must be absent rather than zero. Every
	// glass rule is therefore nested under [data-glass="on"].
	//
	// Applied in the layout (not the page) so it is live at the migration
	// prompt too — settings load independently of the project store.
	$effect(() => {
		const root = document.documentElement;
		const intensity = settingsStore.glassIntensity;
		root.style.setProperty("--glass-intensity", String(intensity));
		root.dataset.glass = intensity > 0 ? "on" : "off";
	});

	// FR-15 (design.md §4.7, ADR-0012). Separate from glass on purpose: the
	// window flag itself is fixed at creation and never varies, so this
	// value drives only the alpha of the app's own background layers.
	// Also applied here rather than in the page so it is live at the
	// migration prompt too.
	$effect(() => {
		document.documentElement.style.setProperty(
			"--window-transparency",
			String(settingsStore.windowTransparency),
		);
	});

	// design.md §4.1a (v2.5) — app-chrome light/dark/system. The resolution
	// itself (including the live `matchMedia` subscription that makes
	// "system" follow OS theme changes without a reload) lives in
	// themeStore, because the terminal preset resolver needs the same
	// resolved value (§9 rule 11). Two independent matchMedia subscriptions
	// could drift out of step; one store cannot.
	//
	// The attribute is written here, never via a CSS `prefers-color-scheme`
	// query (design.md §8) — a parallel CSS-only path would let CSS and JS
	// disagree about which theme is active.
	//
	// Applied in the layout, not the page, so it's live at the migration
	// prompt too — same reasoning as the glass/window-transparency effects
	// above. `color-scheme` is set alongside `data-theme` so native form
	// controls (e.g. Input's password variant) render for the right theme,
	// not just app-chrome tokens.
	$effect(() => {
		const resolved = themeStore.resolved;
		document.documentElement.dataset.theme = resolved;
		document.documentElement.style.colorScheme = resolved;
	});
</script>

{@render children()}
