<script lang="ts">
	// components.md — Keybinding Row: capture/rebind interaction with live
	// conflict detection. See its full spec for the recording state machine
	// rationale (Escape/Tab precedence, the Ctrl/Alt/Cmd-modifier rule).
	import Button from "./Button.svelte";
	import { formatCombo, hasRequiredModifier } from "$lib/keybindings";

	let {
		label,
		combo,
		onRebind,
		checkConflict,
		disabled = false,
		onRecordingChange,
	}: {
		label: string;
		combo: string;
		/** Persists the new combo (settingsStore.setKeybinding) — resolves on
		 * success, rejects on backend failure. The common conflict case is
		 * already caught client-side by `checkConflict` before this is ever
		 * called; a rejection here is the defense-in-depth fallback. */
		onRebind: (newCombo: string) => Promise<void>;
		/** Returns the other action's label already bound to `newCombo`, or
		 * null if it's free — computed by the parent from the full
		 * keybindings map (components.md: "re-runs against the in-memory
		 * keybindings map on every capture attempt"). */
		checkConflict: (newCombo: string) => string | null;
		/** True while a *different* row is recording — disables this row's
		 * Rebind button (code review m1: without this, two rows could both
		 * register a capture listener and receive the same keystroke, since
		 * stopPropagation doesn't stop sibling listeners on the same
		 * `window` target — only one mutual-exclusion owner, the parent,
		 * can prevent that). */
		disabled?: boolean;
		/** Notifies the parent when this row starts/stops actively capturing,
		 * so it can set `disabled` on every other row while this one is live. */
		onRecordingChange?: (recording: boolean) => void;
	} = $props();

	type Mode = "idle" | "recording" | "conflict" | "rejected" | "saved";
	let mode = $state<Mode>("idle");
	let statusMessage = $state("");
	let savedTimeout: ReturnType<typeof setTimeout> | undefined;

	const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

	function startRecording() {
		mode = "recording";
		statusMessage = "Recording — press a key combination";
		window.addEventListener("keydown", handleCapture, true);
		onRecordingChange?.(true);
	}

	function stopListening() {
		window.removeEventListener("keydown", handleCapture, true);
	}

	function cancelRecording() {
		stopListening();
		mode = "idle";
		statusMessage = "";
		onRecordingChange?.(false);
	}

	async function handleCapture(e: KeyboardEvent) {
		// Bare Tab (or Shift+Tab — Shift alone doesn't count as a required
		// modifier, see hasRequiredModifier): let its default focus-move happen
		// (and Modal's own Tab-trap bubble-phase handler run normally
		// afterward) — only recording itself is cancelled, per components.md's
		// Escape/Tab precedence rule. A *modified* Tab (Ctrl+Tab, Alt+Tab, …)
		// falls through to normal capture instead — fixed regression: this
		// used to cancel unconditionally, which meant a Tab-containing combo
		// (e.g. terminal.nextTab's default Ctrl+Tab) could never actually be
		// rebound through this UI at all.
		if (e.key === "Tab" && !hasRequiredModifier(e)) {
			cancelRecording();
			return;
		}

		// Capture phase, before this can reach xterm's own keydown handling or
		// Modal's Escape-to-close (components.md: "a deliberate override...
		// scoped to exactly this row, exactly while recording").
		e.preventDefault();
		e.stopPropagation();

		if (e.key === "Escape") {
			cancelRecording();
			return;
		}
		// A bare modifier keydown isn't a complete combo yet — keep listening.
		if (MODIFIER_KEYS.has(e.key)) return;

		if (!hasRequiredModifier(e)) {
			mode = "rejected";
			statusMessage = "Must include Ctrl, Alt, or Cmd";
			return; // stays recording — user can retry immediately
		}

		const candidate = formatCombo(e);
		const conflictingAction = checkConflict(candidate);
		if (conflictingAction) {
			mode = "conflict";
			statusMessage = `Already used by ${conflictingAction}`;
			return; // stays recording
		}

		stopListening();
		try {
			await onRebind(candidate);
			mode = "saved";
			statusMessage = "Saved";
			onRecordingChange?.(false); // capture session over — free other rows to record
			savedTimeout = setTimeout(() => {
				if (mode === "saved") mode = "idle";
			}, 2000);
		} catch (err) {
			mode = "conflict";
			statusMessage = err instanceof Error ? err.message : String(err);
			onRecordingChange?.(false); // listener already removed above — can't retry-capture, so free other rows
		}
	}

	$effect(() => {
		return () => {
			stopListening();
			clearTimeout(savedTimeout);
		};
	});

	const errored = $derived(mode === "conflict" || mode === "rejected");
</script>

<div class="row" class:active={mode !== "idle"}>
	<span class="label">{label}</span>
	<span class="chip" class:placeholder={mode === "recording" || errored} class:error={errored}>
		{#if mode === "recording" || errored}
			Press a key combination…
		{:else}
			{combo || "—"}
		{/if}
	</span>
	<span class="action">
		{#if mode === "recording" || errored}
			<Button variant="ghost" size="sm" onclick={cancelRecording}>Cancel</Button>
		{:else}
			<Button variant="ghost" size="sm" onclick={startRecording} {disabled}>Rebind</Button>
		{/if}
	</span>
</div>
{#if statusMessage}
	<p class="status" class:error={errored} aria-live="polite">{statusMessage}</p>
{/if}

<style>
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.row:hover,
	.row:focus-within {
		background: var(--color-surface-elevated);
	}

	.label {
		flex: 1;
		font-size: var(--text-sm);
		color: var(--color-text);
	}

	.chip {
		font-family: var(--font-family-mono);
		font-size: var(--text-xs);
		background: var(--color-surface);
		border: var(--border-width-sm) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		color: var(--color-text);
		white-space: nowrap;
	}

	.chip.placeholder {
		border-width: var(--border-width-md);
		border-color: var(--color-primary);
		color: var(--color-text-muted);
	}

	.chip.placeholder.error {
		border-color: var(--color-danger);
	}

	.action {
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-out);
	}

	.row:hover .action,
	.row:focus-within .action,
	.row.active .action {
		opacity: 1;
	}

	.status {
		margin: 0 0 0 var(--space-3);
		padding: 0 var(--space-3);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.status.error {
		color: var(--color-danger);
	}
</style>
