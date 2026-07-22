<script lang="ts">
	// components.md — Settings Panel pattern (FR-13). Reuses Modal's `form`
	// variant as-is (no new modal size). Theme/keybindings/sidebar-position
	// autosave per-control; master password change is the one scoped submit
	// action in the panel (Modal's amended Do/Don't).
	import Modal from "$lib/components/Modal.svelte";
	import Input from "$lib/components/Input.svelte";
	import Button from "$lib/components/Button.svelte";
	import SecurityBadge from "$lib/components/SecurityBadge.svelte";
	import ThemePresetCard from "$lib/components/ThemePresetCard.svelte";
	import KeybindingRow from "$lib/components/KeybindingRow.svelte";
	import SegmentedControl from "$lib/components/SegmentedControl.svelte";
	import { THEME_PRESETS } from "$lib/theme-presets";
	import { KEYBINDING_ACTIONS, actionLabel, type ActionId } from "$lib/keybindings";
	import { settingsStore } from "$lib/stores/settings.svelte";
	import { changeMasterPassword, isAppError, errorMessage } from "$lib/api";

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

	// Master password change — the one field group with real, hard-to-reverse
	// consequences (rotates the encryption key), so it gets its own scoped
	// submit rather than autosaving per keystroke.
	let currentPassword = $state("");
	let newPassword = $state("");
	let confirmPassword = $state("");
	let currentPasswordError = $state("");
	let newPasswordError = $state("");
	let confirmPasswordError = $state("");
	let passwordSuccess = $state("");
	let changingPassword = $state(false);
	let successTimeout: ReturnType<typeof setTimeout> | undefined;

	function clearPasswordErrors() {
		currentPasswordError = "";
		newPasswordError = "";
		confirmPasswordError = "";
	}

	async function handleChangePassword() {
		clearPasswordErrors();
		passwordSuccess = "";
		if (!newPassword) {
			newPasswordError = "New password cannot be empty.";
			return;
		}
		if (newPassword !== confirmPassword) {
			confirmPasswordError = "Passwords don't match.";
			return;
		}
		changingPassword = true;
		try {
			await changeMasterPassword(currentPassword, newPassword);
			currentPassword = "";
			newPassword = "";
			confirmPassword = "";
			passwordSuccess = "Password changed";
			successTimeout = setTimeout(() => {
				if (passwordSuccess === "Password changed") passwordSuccess = "";
			}, 2000);
		} catch (e) {
			if (isAppError(e) && e.kind === "wrong_password") {
				currentPasswordError = "Current password is incorrect";
			} else {
				confirmPasswordError = errorMessage(e);
			}
		} finally {
			changingPassword = false;
		}
	}

	$effect(() => {
		return () => clearTimeout(successTimeout);
	});

	// code review m2: this modal stays permanently mounted (Sidebar.svelte
	// renders it unconditionally), so without this reset, closing without
	// submitting and reopening left stale password text/errors in place.
	$effect(() => {
		if (open) {
			currentPassword = "";
			newPassword = "";
			confirmPassword = "";
			clearPasswordErrors();
			passwordSuccess = "";
			settingsError = "";
		}
	});
</script>

<Modal {open} title="Settings" variant="form" {onClose}>
	{#snippet children()}
		{#if settingsError}<p class="error">{settingsError}</p>{/if}
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
				{#each THEME_PRESETS as preset (preset.id)}
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
			<div class="section-header">
				<h3>Master password</h3>
				<SecurityBadge variant="inline" />
			</div>
			<Input
				id="settings-current-password"
				label="Current password"
				variant="password"
				bind:value={currentPassword}
				error={currentPasswordError || undefined}
			/>
			<Input
				id="settings-new-password"
				label="New password"
				variant="password"
				bind:value={newPassword}
				error={newPasswordError || undefined}
			/>
			<Input
				id="settings-confirm-password"
				label="Confirm new password"
				variant="password"
				bind:value={confirmPassword}
				error={confirmPasswordError || undefined}
				onEnter={handleChangePassword}
			/>
			<div class="password-action">
				<Button variant="primary" onclick={handleChangePassword} loading={changingPassword}>
					Change password
				</Button>
				{#if passwordSuccess}<span class="success">{passwordSuccess}</span>{/if}
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
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={onClose}>Done</Button>
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

	.section-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
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

	.password-action {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.success {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
</style>
