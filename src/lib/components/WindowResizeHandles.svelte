<script lang="ts">
	// design.md §5 (v2.8, ADR-0013): with native decorations off, the OS no
	// longer supplies edge/corner resize for free — these 8 invisible regions
	// replace it. Hit-area size reuses --pane-divider-hit-area's existing
	// "invisible extra hit area for resize drag" precedent rather than a new
	// token (components.md Title Bar Do/Don't).
	import { getCurrentWindow } from "@tauri-apps/api/window";

	const EDGES = [
		{ class: "edge-n", direction: "North" as const },
		{ class: "edge-s", direction: "South" as const },
		{ class: "edge-e", direction: "East" as const },
		{ class: "edge-w", direction: "West" as const },
		{ class: "corner-ne", direction: "NorthEast" as const },
		{ class: "corner-nw", direction: "NorthWest" as const },
		{ class: "corner-se", direction: "SouthEast" as const },
		{ class: "corner-sw", direction: "SouthWest" as const },
	];

	function handleMousedown(direction: (typeof EDGES)[number]["direction"]) {
		getCurrentWindow().startResizeDragging(direction);
	}
</script>

{#each EDGES as { class: handleClass, direction } (handleClass)}
	<!-- svelte-ignore a11y_no_static_element_interactions -- window edge/corner resize has no keyboard equivalent even with native OS decorations (design.md §5, components.md Title Bar Accessibility); OS-level window-management shortcuts remain the accessible path, unaffected by decorations: false. -->
	<div class="handle {handleClass}" onmousedown={() => handleMousedown(direction)}></div>
{/each}

<style>
	.handle {
		position: fixed;
		/* Deliberately below TitleBar's own z-index (see .titlebar) — the top
		   edge/corner handles geometrically overlap the bar's row (both start
		   at the true window top). Losing that stacking fight is correct: a
		   click that lands on a real button/input must never be swallowed by
		   a resize-drag attempt. The handle stays reachable in whatever part
		   of the top strip the bar leaves empty (its own drag region). */
		z-index: 1;
	}

	.edge-n,
	.edge-s {
		left: var(--pane-divider-hit-area);
		right: var(--pane-divider-hit-area);
		height: var(--pane-divider-hit-area);
		cursor: ns-resize;
	}
	.edge-n {
		top: 0;
	}
	.edge-s {
		bottom: 0;
	}

	.edge-e,
	.edge-w {
		top: var(--pane-divider-hit-area);
		bottom: var(--pane-divider-hit-area);
		width: var(--pane-divider-hit-area);
		cursor: ew-resize;
	}
	.edge-e {
		right: 0;
	}
	.edge-w {
		left: 0;
	}

	.corner-ne,
	.corner-nw,
	.corner-se,
	.corner-sw {
		width: calc(var(--pane-divider-hit-area) * 2);
		height: calc(var(--pane-divider-hit-area) * 2);
	}
	.corner-ne {
		top: 0;
		right: 0;
		cursor: nesw-resize;
	}
	.corner-nw {
		top: 0;
		left: 0;
		cursor: nwse-resize;
	}
	.corner-se {
		bottom: 0;
		right: 0;
		cursor: nwse-resize;
	}
	.corner-sw {
		bottom: 0;
		left: 0;
		cursor: nesw-resize;
	}
</style>
