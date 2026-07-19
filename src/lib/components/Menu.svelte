<script module lang="ts">
	export interface MenuItemDef {
		label: string;
		onSelect: () => void;
		danger?: boolean;
	}
</script>

<script lang="ts">
	// components.md — "Menu (overflow + context)": one component, two triggers
	// (anchored: position via CSS relative to a `position:relative` parent;
	// context: position via JS at a viewport coordinate), identical content
	// and behavior either way.
	let {
		open,
		items,
		anchorPosition = null,
		onClose,
	}: {
		open: boolean;
		items: MenuItemDef[];
		/** Viewport coordinates for the context variant. Omit for the anchored
		 *  variant (positions via CSS against the nearest `position:relative` ancestor). */
		anchorPosition?: { x: number; y: number } | null;
		onClose: () => void;
	} = $props();

	let menuEl: HTMLDivElement | undefined = $state();
	let clamped = $state<{ x: number; y: number } | null>(null);

	// Two-pass positioning for the context variant: render once at the raw
	// cursor position, measure the now-mounted menu, then clamp so it never
	// renders off-screen (components.md: "clamped ... never off-screen").
	$effect(() => {
		if (open && anchorPosition && menuEl) {
			const rect = menuEl.getBoundingClientRect();
			const x = Math.max(4, Math.min(anchorPosition.x, window.innerWidth - rect.width - 4));
			const y = Math.max(4, Math.min(anchorPosition.y, window.innerHeight - rect.height - 4));
			clamped = { x, y };
		} else {
			clamped = null;
		}
	});

	function menuItemEls(): HTMLElement[] {
		return menuEl ? Array.from(menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]')) : [];
	}

	function moveFocus(delta: number) {
		const els = menuItemEls();
		if (els.length === 0) return;
		const currentIndex = els.indexOf(document.activeElement as HTMLElement);
		const nextIndex = (currentIndex + delta + els.length) % els.length;
		els[nextIndex]?.focus();
	}

	$effect(() => {
		if (!open) return;

		function handleClickOutside(e: MouseEvent) {
			if (menuEl && !menuEl.contains(e.target as Node)) onClose();
		}
		function handleKeydown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				moveFocus(1);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				moveFocus(-1);
			}
		}

		// Deferred: a listener attached synchronously during the very click
		// that opened this menu would still receive that same click (it
		// hasn't finished bubbling to window yet) and close the menu instantly.
		const timer = setTimeout(() => {
			window.addEventListener("click", handleClickOutside);
			window.addEventListener("keydown", handleKeydown);
		}, 0);
		queueMicrotask(() => menuItemEls()[0]?.focus());

		return () => {
			clearTimeout(timer);
			window.removeEventListener("click", handleClickOutside);
			window.removeEventListener("keydown", handleKeydown);
		};
	});

	function selectItem(e: MouseEvent, item: MenuItemDef) {
		// The menu (and its trigger, for the anchored variant) sits inside
		// whatever row/element it's attached to — without stopping
		// propagation, this click would keep bubbling into that element's
		// own click handler (e.g. a Sidebar Project List Item's row-click).
		e.stopPropagation();
		item.onSelect();
		onClose();
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_interactive_supports_focus -- the container itself is never a focus target; focus always lands on a [role=menuitem] child (see the `$effect` above) -->
	<!-- svelte-ignore a11y_click_events_have_key_events -- keyboard support (ArrowUp/Down, Escape) is real, just attached to `window` above rather than this element, since Escape/arrows must work no matter which menuitem child has focus -->
	<div
		class="menu"
		class:menu-context={!!anchorPosition}
		role="menu"
		bind:this={menuEl}
		style={anchorPosition ? `left: ${(clamped ?? anchorPosition).x}px; top: ${(clamped ?? anchorPosition).y}px;` : ""}
		onclick={(e) => e.stopPropagation()}
	>
		{#each items as item (item.label)}
			<button role="menuitem" class:danger={item.danger} onclick={(e) => selectItem(e, item)}>
				{item.label}
			</button>
		{/each}
	</div>
{/if}

<style>
	.menu {
		position: absolute;
		right: 0;
		top: 100%;
		z-index: var(--z-dropdown);
		background: var(--color-surface-elevated);
		border: var(--border-width-sm) solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		display: flex;
		flex-direction: column;
		min-width: var(--menu-min-width);
		padding: var(--space-1);
	}

	.menu-context {
		position: fixed;
		right: auto;
		top: auto;
	}

	.menu button {
		background: transparent;
		border: none;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		color: var(--color-text);
		cursor: pointer;
	}

	.menu button:hover,
	.menu button:focus-visible {
		background: var(--color-surface);
	}

	.menu button.danger {
		color: var(--color-danger);
	}
</style>
