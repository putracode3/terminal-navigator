<script lang="ts">
	import "../../docs/design/tokens.css";
	import "$lib/styles/base.css";
	import { settingsStore } from "$lib/stores/settings.svelte";

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
	// Applied in the layout (not the page) so it is live at the unlock
	// screen too — settings load without the master password per NFR-8.
	$effect(() => {
		const root = document.documentElement;
		const intensity = settingsStore.glassIntensity;
		root.style.setProperty("--glass-intensity", String(intensity));
		root.dataset.glass = intensity > 0 ? "on" : "off";
	});

	// FR-15 (design.md §4.7, ADR-0012). Separate from glass on purpose: the
	// window flag itself is fixed at creation and never varies, so this
	// value drives only the alpha of the app's own background layers.
	// Also applied here rather than in the page so it is live at the unlock
	// screen (NFR-8).
	$effect(() => {
		document.documentElement.style.setProperty(
			"--window-transparency",
			String(settingsStore.windowTransparency),
		);
	});
</script>

{@render children()}
