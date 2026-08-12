<script lang="ts">
	// components.md — Title Bar pattern (v2.8, ADR-0013). Replaces the native
	// OS title bar entirely (decorations: false) — full window width, three
	// zones: left (Settings, + Add project — relocated from the old sidebar
	// footer), center (search + sidebar-toggle — relocated from the old
	// sidebar header, same pairing/behavior), right (window controls, always
	// right-anchored regardless of settingsStore.sidebarPosition).
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import Button from "$lib/components/Button.svelte";
	import ProjectFormModal from "./ProjectFormModal.svelte";
	import SettingsModal from "./SettingsModal.svelte";
	import { appStore } from "$lib/stores/app.svelte";

	let addFormOpen = $state(false);
	let settingsOpen = $state(false);

	const tauriWindow = getCurrentWindow();
	let maximized = $state(false);

	// code review M1/M2 fix round: subscribe before reading the initial value
	// (not the other way around) so a resize landing in the gap between the
	// two calls is still captured by the initial isMaximized() read rather
	// than silently missed; `cancelled` guards the listener-registration
	// promise against resolving after this effect has already been torn
	// down, which previously could leave `onResized`'s handler subscribed
	// with no way to unlisten it.
	$effect(() => {
		let cancelled = false;
		let unlisten: (() => void) | undefined;
		tauriWindow
			.onResized(async () => {
				maximized = await tauriWindow.isMaximized();
			})
			.then((stop) => {
				if (cancelled) {
					stop();
				} else {
					unlisten = stop;
				}
			});
		tauriWindow.isMaximized().then((value) => {
			if (!cancelled) maximized = value;
		});
		return () => {
			cancelled = true;
			unlisten?.();
		};
	});

	function handleMinimize() {
		tauriWindow.minimize();
	}

	function handleToggleMaximize() {
		tauriWindow.toggleMaximize();
	}

	function handleClose() {
		tauriWindow.close();
	}
</script>

<!--
	code review M1/M2 fix round:
	- data-tauri-drag-region="deep" (not bare) so any empty descendant space
	  within a zone counts as drag region too, not just the literal <header>
	  background — matches components.md's Title Bar Behavior ("the empty
	  space in each zone... is the window's drag region"). Verified against
	  Tauri's actual injected script (tauri/src/window/scripts/drag.js,
	  isDragRegion()): bare/"true" only matches when the attributed element
	  itself is the click target; "deep" matches any descendant, while a
	  clickable descendant (button/input) without its own attribute still
	  blocks the drag before the walk ever reaches the header — so Button/
	  input stay fully clickable either way.
	- No custom dblclick handler: that same script already invokes
	  `internal_toggle_maximize` natively on any double-click landing in a
	  valid drag region (Linux/Windows path, in the mousedown handler itself).
	  A separate `ondblclick` here previously fired *in addition* to that
	  native invoke — the browser's dblclick event synthesis is independent
	  of `stopImmediatePropagation()` on the earlier mousedown — so one
	  double-click was toggling maximize twice and visibly doing nothing.
-->
<header class="titlebar" data-tauri-drag-region="deep">
	<!-- Settings/Add-project/search/sidebar-toggle all need the project store
	     to have finished loading, or act on the sidebar, neither of which
	     exists yet at the migration prompt / initial-load moment — same
	     reachability as today (these lived in Sidebar.svelte, which was
	     never rendered before that point). Window controls (right zone,
	     below) are the one part of this bar that must work regardless of
	     load state, since they replace the native decorations a not-yet-ready
	     window used to get for free. -->
	{#if appStore.ready}
		<div class="zone zone-left">
			<Button variant="ghost" size="icon" ariaLabel="Settings" onclick={() => (settingsOpen = true)}>⚙</Button>
			<Button variant="ghost" onclick={() => (addFormOpen = true)}>+ Add project</Button>
		</div>

		<div class="zone zone-center">
			<!-- unspecified: `Input` always renders a visible label line above its
			     control (label + gap + --control-height-md ≈ 52px), which doesn't
			     fit inside --titlebar-height (36px). Composed a compact field
			     locally instead, following Input's own token usage (surface/
			     border/radius/focus) rather than inventing new values — accessible
			     name comes from aria-label since there's no room for a visible
			     label here. Review needed: either give Input a labelless/compact
			     mode for reuse, or formally document this as the Title Bar's own
			     bespoke field in components.md. -->
			<input
				class="search-input"
				type="text"
				placeholder="Search projects…"
				aria-label="Search projects"
				bind:value={appStore.search}
			/>
			<Button
				variant="ghost"
				size="icon"
				ariaLabel={appStore.sidebarHidden ? "Show sidebar" : "Hide sidebar"}
				onclick={() => appStore.toggleSidebar()}
			>
				<!-- v2.9: sidebar-panel glyph replaces the hamburger (☰), and unlike the
				     hamburger it's now state-dependent again — outline "collapse" when
				     shown (clicking hides it), filled "expand" when hidden (clicking
				     shows it) — closer to the v1.4 direction-flipping precedent than the
				     v1.7 single-glyph one, but swapping icon *style* (outline/filled)
				     rather than arrow *direction*, so it stays independent of
				     settingsStore.sidebarPosition the same way v1.7's hamburger was. -->
				{#if appStore.sidebarHidden}
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
						focusable="false"
					>
						<path
							d="M18 3a3 3 0 0 1 2.995 2.824l.005 .176v12a3 3 0 0 1 -2.824 2.995l-.176 .005h-12a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-12a3 3 0 0 1 2.824 -2.995l.176 -.005h12zm-3 2h-9a1 1 0 0 0 -.993 .883l-.007 .117v12a1 1 0 0 0 .883 .993l.117 .007h9v-14zm-5.387 4.21l.094 .083l2 2a1 1 0 0 1 .083 1.32l-.083 .094l-2 2a1 1 0 0 1 -1.497 -1.32l.083 -.094l1.292 -1.293l-1.292 -1.293a1 1 0 0 1 -.083 -1.32l.083 -.094a1 1 0 0 1 1.32 -.083z"
						/>
					</svg>
				{:else}
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						focusable="false"
					>
						<path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
						<path d="M15 4v16" />
						<path d="M9 10l2 2l-2 2" />
					</svg>
				{/if}
			</Button>
		</div>
	{/if}

	<div class="zone zone-right">
		<Button variant="ghost" size="icon" ariaLabel="Minimize" onclick={handleMinimize}>─</Button>
		<Button
			variant="ghost"
			size="icon"
			ariaLabel={maximized ? "Restore" : "Maximize"}
			onclick={handleToggleMaximize}
		>
			{maximized ? "❐" : "□"}
		</Button>
		<div class="close-slot">
			<Button variant="ghost" size="icon" ariaLabel="Close" onclick={handleClose}>✕</Button>
		</div>
	</div>
</header>

<ProjectFormModal open={addFormOpen} project={undefined} onClose={() => (addFormOpen = false)} />

<SettingsModal open={settingsOpen} onClose={() => (settingsOpen = false)} />

<style>
	.titlebar {
		position: relative;
		/* Above WindowResizeHandles' top edge/corner handles (z-index: 1,
		   see that component) — both occupy the true window top, and a real
		   button/input must always win the pointer-event fight there over a
		   resize-drag attempt. */
		z-index: 2;
		height: var(--titlebar-height);
		display: flex;
		align-items: center;
		padding: 0 var(--space-3);
		background: var(--color-surface-scrim);
		border-bottom: var(--border-width-sm) solid var(--color-border);
		flex-shrink: 0;
	}

	.zone {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.zone-right {
		margin-left: auto;
	}

	.zone-center {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
	}

	.search-input {
		width: 14rem; /* token-exempt: fixed field width for the compact title-bar search box, same category as SettingsModal's .slider-value min-width — no spacing-scale value fits a field-width purpose */
		height: var(--control-height-sm);
		padding: 0 var(--space-2);
		background: var(--color-surface);
		border: var(--border-width-sm) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--color-text);
	}

	.search-input:focus-visible {
		outline: none;
		border-color: var(--color-primary);
	}

	/* Scoped override, not a fifth Button variant (components.md Title Bar
	   Do/Don't) — only the close control reddens on hover, matching the
	   near-universal OS convention. Specificity matches Button's own
	   .btn-ghost:hover:not(:disabled) exactly, plus this wrapper class, so it
	   wins regardless of CSS injection order. */
	.close-slot :global(.btn-ghost:hover:not(:disabled)) {
		background: var(--color-danger-bg-subtle);
		color: var(--color-danger);
	}
</style>
