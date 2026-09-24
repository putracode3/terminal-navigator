<script lang="ts">
	// components.md — Settings Panel pattern (FR-13). Reuses Modal's `form`
	// variant as-is (no new modal size). Theme/keybindings/sidebar-position
	// autosave per-control. Master password change removed (ADR-0014) — no
	// master password left to change.
	import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
	import Modal from "$lib/components/Modal.svelte";
	import Input from "$lib/components/Input.svelte";
	import Button from "$lib/components/Button.svelte";
	import ThemePresetCard from "$lib/components/ThemePresetCard.svelte";
	import KeybindingRow from "$lib/components/KeybindingRow.svelte";
	import SegmentedControl from "$lib/components/SegmentedControl.svelte";
	import { THEME_PRESETS, getThemePreset } from "$lib/theme-presets";
	import { themeStore } from "$lib/stores/theme.svelte";
	import { KEYBINDING_ACTIONS, actionLabel, type ActionId } from "$lib/keybindings";
	import { settingsStore } from "$lib/stores/settings.svelte";
	import { appStore } from "$lib/stores/app.svelte";
	import { exportConfig, importConfig, errorMessage } from "$lib/api";

	let { open, onClose }: { open: boolean; onClose: () => void } = $props();

	let themeGridEl: HTMLDivElement | undefined = $state();

	function moveThemeFocus(delta: number) {
		if (!themeGridEl) return;
		const cards = Array.from(themeGridEl.querySelectorAll<HTMLElement>('[role="radio"]'));
		const currentIndex = cards.indexOf(document.activeElement as HTMLElement);
		const nextIndex = (currentIndex + delta + cards.length) % cards.length;
		cards[nextIndex]?.focus();
	}

	function handleThemeGridKeydown(e: KeyboardEvent) {
		if (e.key === "ArrowRight" || e.key === "ArrowDown") {
			e.preventDefault();
			moveThemeFocus(1);
		} else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
			e.preventDefault();
			moveThemeFocus(-1);
		}
	}

	function checkConflict(actionId: ActionId, candidate: string): string | null {
		for (const [otherId, otherCombo] of Object.entries(settingsStore.keybindings)) {
			if (otherId !== actionId && otherCombo === candidate) return actionLabel(otherId);
		}
		return null;
	}

	// code review m1: mutual exclusion so at most one Keybinding Row ever has
	// a live capture listener — without this, two rows could both register a
	// window keydown listener and receive the same keystroke (stopPropagation
	// doesn't stop sibling listeners on the same target).
	let recordingActionId = $state<string | null>(null);
	function handleRecordingChange(actionId: string, recording: boolean) {
		if (recording) recordingActionId = actionId;
		else if (recordingActionId === actionId) recordingActionId = null;
	}

	// code review m3: theme/sidebar-position autosave silently rolled back
	// on failure with no user-facing feedback (unhandled rejection). Surface
	// it the same way keybinding rebinds already do.
	let settingsError = $state("");

	// FR-14. Two-stage on purpose: `oninput` fires on every step of the drag,
	// and routing that straight to the store would mean one IPC round-trip +
	// atomic disk write per step. So the drag only updates the live preview
	// (writing --glass-intensity directly, which every glass surface already
	// reads), and the value is persisted once on `change` — i.e. on release.
	let glassValue = $state(settingsStore.glassIntensity);

	// Keep the local value in step when the store changes from elsewhere
	// (initial load(), or a failed save rolling back).
	$effect(() => {
		glassValue = settingsStore.glassIntensity;
	});

	function applyGlassPreview(intensity: number) {
		const root = document.documentElement;
		root.style.setProperty("--glass-intensity", String(intensity));
		root.dataset.glass = intensity > 0 ? "on" : "off";
	}

	function handleGlassInput(event: Event) {
		const intensity = Number((event.currentTarget as HTMLInputElement).value) / 100;
		glassValue = intensity;
		applyGlassPreview(intensity);
	}

	// FR-15 — same two-stage drag/commit shape as the glass slider, and for
	// the same reason: `oninput` fires per step, and persisting each one
	// would mean an IPC round-trip plus an atomic disk write per pixel.
	let windowValue = $state(settingsStore.windowTransparency);

	$effect(() => {
		windowValue = settingsStore.windowTransparency;
	});

	function applyWindowPreview(transparency: number) {
		document.documentElement.style.setProperty("--window-transparency", String(transparency));
	}

	function handleWindowInput(event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value) / 100;
		windowValue = value;
		applyWindowPreview(value);
	}

	function handleWindowCommit(event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value) / 100;
		settingsError = "";
		settingsStore.setWindowTransparency(value).catch((e) => {
			settingsError = errorMessage(e);
			applyWindowPreview(settingsStore.windowTransparency);
		});
	}

	function handleGlassCommit(event: Event) {
		const intensity = Number((event.currentTarget as HTMLInputElement).value) / 100;
		settingsError = "";
		settingsStore.setGlassIntensity(intensity).catch((e) => {
			settingsError = errorMessage(e);
			// The store already rolled its value back; undo the live preview
			// too, so what's on screen matches what's actually persisted.
			applyGlassPreview(settingsStore.glassIntensity);
		});
	}

	const keybindingGroups = $derived.by(() => {
		const groups: { name: string; actions: typeof KEYBINDING_ACTIONS }[] = [];
		for (const action of KEYBINDING_ACTIONS) {
			let group = groups.find((g) => g.name === action.group);
			if (!group) {
				group = { name: action.group, actions: [] };
				groups.push(group);
			}
			group.actions.push(action);
		}
		return groups;
	});

	const sidebarPositionOptions = [
		{ value: "left", label: "Left" },
		{ value: "right", label: "Right" },
	];

	// design.md §4.1a / components.md Settings Panel (v2.5). Its own group,
	// not folded into "Theme" below — that section is §4.5's terminal
	// *content* presets, a deliberately separate system from app-chrome
	// appearance (see §4.5's own separation rule).
	const themeModeOptions = [
		{ value: "dark", label: "Dark" },
		{ value: "light", label: "Light" },
		{ value: "system", label: "System" },
	];

	// v2.8 (components.md, Settings Panel — Data group): Export/Import,
	// relocated from the sidebar footer (FR-07, ADR-0004/ADR-0008). Since
	// ADR-0014 removed encryption, import no longer needs a password at all
	// — it just validates the source file's shape server-side. Status/error
	// lifecycle carried over verbatim from the old footer banner (design.md
	// v2.4 rule: an owned lifetime or a dismiss affordance), just renamed to
	// make clear this is Data-group-scoped, not shared with `settingsError`
	// above.
	let dataSyncStatus = $state("");
	let dataSyncError = $state("");
	let dataSyncing = $state(false);
	let pendingImportSource = $state<string | undefined>(undefined);
	const DATA_ERROR_DISMISS_MS = 8000;
	let dataErrorTimer: ReturnType<typeof setTimeout> | undefined;

	function flashDataStatus(message: string) {
		dataSyncStatus = message;
		setTimeout(() => {
			if (dataSyncStatus === message) dataSyncStatus = "";
		}, 3000);
	}

	function flashDataError(message: string) {
		dataSyncError = message;
		clearTimeout(dataErrorTimer);
		dataErrorTimer = setTimeout(() => (dataSyncError = ""), DATA_ERROR_DISMISS_MS);
	}

	function dismissDataError() {
		clearTimeout(dataErrorTimer);
		dataSyncError = "";
	}

	async function handleExport() {
		const destination = await saveDialog({ defaultPath: "terminal-navigator-export.enc" });
		if (!destination) return;
		dismissDataError();
		dataSyncing = true;
		try {
			await exportConfig(destination);
			flashDataStatus("Exported");
		} catch (e) {
			flashDataError(errorMessage(e));
		} finally {
			dataSyncing = false;
		}
	}

	async function handleImportPick() {
		const source = await openDialog({ multiple: false, directory: false });
		if (typeof source === "string") {
			dismissDataError();
			pendingImportSource = source;
		}
	}

	async function confirmImport() {
		if (!pendingImportSource) return;
		dataSyncing = true;
		try {
			const entries = await importConfig(pendingImportSource);
			appStore.setEntries(entries);
			pendingImportSource = undefined;
			flashDataStatus("Imported — project list replaced");
		} catch (e) {
			flashDataError(errorMessage(e));
			pendingImportSource = undefined;
		} finally {
			dataSyncing = false;
		}
	}

	$effect(() => {
		return () => clearTimeout(dataErrorTimer);
	});

	// code review m2: this modal stays permanently mounted (TitleBar.svelte
	// renders it unconditionally), so without this reset, closing without
	// submitting and reopening left stale status/errors in place.
	// v2.8: also resets the Data group's status/error — components.md is
	// explicit that a stale "Exported" flash or dismissed error must not
	// reappear the next time the modal reopens, since this state now lives
	// inside a dismissible modal rather than always-visible chrome.
	$effect(() => {
		if (open) {
			settingsError = "";
			dismissDataError();
			dataSyncStatus = "";
			pendingImportSource = undefined;
		}
	});
</script>

<Modal {open} title="Settings" variant="form" {onClose}>
	{#snippet children()}
		{#if settingsError}<p class="error">{settingsError}</p>{/if}
		<section>
			<h3>Appearance</h3>
			<SegmentedControl
				options={themeModeOptions}
				value={settingsStore.themeMode}
				onChange={(value) => {
					settingsError = "";
					settingsStore.setThemeMode(value as "dark" | "light" | "system").catch((e) => (settingsError = errorMessage(e)));
				}}
				ariaLabel="App appearance"
			/>
		</section>

		<section>
			<h3>Theme</h3>
			<!-- svelte-ignore a11y_interactive_supports_focus -- WAI-ARIA radiogroup pattern: the group container is never a tab stop itself; each ThemePresetCard button carries its own native tabindex/focus, this container only adds arrow-key navigation between them -->
			<div
				class="theme-grid"
				role="radiogroup"
				aria-label="Terminal theme"
				bind:this={themeGridEl}
				onkeydown={handleThemeGridKeydown}
			>
				<!-- Resolved, not raw: App Default's card must preview the variant
				     the chrome theme actually renders (components.md, Theme Preset
				     Card Behavior). One card per preset in both themes — never a
				     separate "App Default Light" entry (design.md §9 rule 11). -->
				{#each THEME_PRESETS as listed (listed.id)}
					{@const preset = getThemePreset(listed.id, themeStore.resolved)}
					<ThemePresetCard
						{preset}
						selected={settingsStore.themePreset === preset.id}
						onSelect={() => {
							settingsError = "";
							settingsStore.setThemePreset(preset.id).catch((e) => (settingsError = errorMessage(e)));
						}}
					/>
				{/each}
			</div>
		</section>

		<section>
			<h3>Keybindings</h3>
			<p class="hint">
				Some combinations may be intercepted by your desktop environment before this app sees them.
			</p>
			{#each keybindingGroups as group (group.name)}
				<p class="group-label">{group.name}</p>
				{#each group.actions as action (action.id)}
					<KeybindingRow
						label={action.label}
						combo={settingsStore.keybindings[action.id] ?? ""}
						onRebind={(newCombo) => settingsStore.setKeybinding(action.id, newCombo)}
						checkConflict={(newCombo) => checkConflict(action.id, newCombo)}
						disabled={recordingActionId !== null && recordingActionId !== action.id}
						onRecordingChange={(recording) => handleRecordingChange(action.id, recording)}
					/>
				{/each}
			{/each}
		</section>

		<section>
			<h3>Sidebar position</h3>
			<SegmentedControl
				options={sidebarPositionOptions}
				value={settingsStore.sidebarPosition}
				onChange={(value) => {
					settingsError = "";
					settingsStore.setSidebarPosition(value as "left" | "right").catch((e) => (settingsError = errorMessage(e)));
				}}
				ariaLabel="Sidebar position"
			/>
		</section>

		<section>
			<h3>Data</h3>
			<div class="data-row">
				<Button variant="secondary" size="sm" onclick={handleExport} loading={dataSyncing}>Export</Button>
				<Button variant="secondary" size="sm" onclick={handleImportPick} loading={dataSyncing}>Import</Button>
			</div>
			{#if dataSyncStatus}<p class="sync-status">{dataSyncStatus}</p>{/if}
			{#if dataSyncError}
				<div class="error-banner" role="alert">
					<p class="error">{dataSyncError}</p>
					<button class="error-dismiss" aria-label="Dismiss error" onclick={dismissDataError}>✕</button>
				</div>
			{/if}
		</section>

		<section>
			<h3>Glass effect</h3>
			<p class="hint">
				Frosted-glass translucency for dialogs and menus. The app window itself stays opaque —
				your desktop won't show through.
			</p>
			<!-- unspecified: range/slider control — components.md has no Slider spec; composed from
			     existing tokens following the Input/SegmentedControl conventions. Review needed. -->
			<div class="slider-row">
				<input
					id="settings-glass-intensity"
					class="slider"
					type="range"
					min="0"
					max="100"
					step="5"
					value={Math.round(glassValue * 100)}
					aria-label="Glass effect intensity"
					aria-valuetext={glassValue === 0 ? "Off" : `${Math.round(glassValue * 100)} percent`}
					oninput={handleGlassInput}
					onchange={handleGlassCommit}
				/>
				<span class="slider-value">{glassValue === 0 ? "Off" : `${Math.round(glassValue * 100)}%`}</span>
			</div>
		</section>

		<section>
			<h3>Window transparency</h3>
			<p class="hint">
				See through the window to your desktop. Needs a compositing window manager — without
				one the window stays opaque.
			</p>
			<div class="slider-row">
				<input
					id="settings-window-transparency"
					class="slider"
					type="range"
					min="0"
					max="100"
					step="5"
					value={Math.round(windowValue * 100)}
					aria-label="Window transparency"
					aria-valuetext={windowValue === 0 ? "Off" : `${Math.round(windowValue * 100)} percent`}
					oninput={handleWindowInput}
					onchange={handleWindowCommit}
				/>
				<span class="slider-value">{windowValue === 0 ? "Off" : `${Math.round(windowValue * 100)}%`}</span>
			</div>
		</section>
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={onClose}>Done</Button>
	{/snippet}
</Modal>

<!-- v2.8: relocated from Sidebar.svelte verbatim (FR-07/ADR-0008). Stacks
     on top of the Settings modal above — both use Modal's own z-index tokens
     and this one is the later sibling in the DOM, so it paints on top;
     unspecified: components.md's Title Bar/Settings Panel updates didn't
     explicitly address Modal-on-Modal stacking, review needed if this proves
     visually wrong in practice. -->
<Modal
	open={!!pendingImportSource}
	title="Import project data"
	variant="confirm"
	onClose={() => (pendingImportSource = undefined)}
>
	{#snippet children()}
		<p>
			This replaces <strong>all</strong> projects currently in Terminal Navigator with the contents
			of the selected file (ADR-0008 — import is replace, not merge). This cannot be undone.
		</p>
		<p>
			Imported projects' setup commands will run automatically each time you open their terminal
			— only import files from sources you trust. (The terminal that opens by itself at app
			launch never runs setup commands.)
		</p>
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (pendingImportSource = undefined)}>Cancel</Button>
		<Button variant="danger" onclick={confirmImport} loading={dataSyncing}>Replace and import</Button>
	{/snippet}
</Modal>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	h3 {
		margin: 0;
	}

	.error {
		margin: 0;
		color: var(--color-danger);
		font-size: var(--text-xs);
	}

	/* v2.8 Data group — relocated from Sidebar.svelte's footer verbatim. */
	.data-row {
		display: flex;
		gap: var(--space-2);
	}

	.data-row > :global(.btn) {
		flex: 1;
	}

	.sync-status {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-security);
	}

	.error-banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.error-banner > .error {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.error-dismiss {
		flex-shrink: 0;
		background: transparent;
		border: none;
		color: var(--color-danger);
		cursor: pointer;
		padding: 0 var(--space-1);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
	}

	.error-dismiss:hover {
		background: var(--color-surface-elevated);
	}

	.error-dismiss:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}

	.hint {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
	}

	/* unspecified: Slider — no components.md spec exists; states below mirror
	   the Input/Button conventions (same focus rule from design.md §7, same
	   --color-primary fill as other interactive controls). Review needed. */
	.slider-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.slider {
		flex: 1;
		appearance: none;
		height: var(--space-1);
		border-radius: var(--radius-full);
		background: var(--color-border-strong);
		cursor: pointer;
	}

	.slider:focus-visible {
		outline: var(--border-width-md) solid var(--color-focus);
		outline-offset: var(--space-1);
	}

	.slider::-webkit-slider-thumb {
		appearance: none;
		width: var(--space-4);
		height: var(--space-4);
		border-radius: var(--radius-full);
		background: var(--color-primary);
		border: var(--border-width-sm) solid var(--color-text);
	}

	.slider::-moz-range-thumb {
		width: var(--space-4);
		height: var(--space-4);
		border-radius: var(--radius-full);
		background: var(--color-primary);
		border: var(--border-width-sm) solid var(--color-text);
	}

	.slider-value {
		min-width: 3rem; /* token-exempt: reserves width for the widest label ("100%") so the slider doesn't reflow as the value changes */
		text-align: right;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	.theme-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-3);
	}

	.hint {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.group-label {
		margin: var(--space-2) 0 0;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
	}

</style>
