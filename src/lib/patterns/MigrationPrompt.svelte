<script lang="ts">
	// ADR-0014: shown only once, ever, per pre-existing installation — when
	// `initStore` reports the data file is still in the pre-ADR-0014
	// encrypted format. Asks for the legacy master password exactly once to
	// migrate the file to the current plain format; never shown again after
	// that migration succeeds.
	import Input from "$lib/components/Input.svelte";
	import Button from "$lib/components/Button.svelte";
	import { migrateAndLoad, errorMessage } from "$lib/api";
	import { appStore } from "$lib/stores/app.svelte";

	let password = $state("");
	let error = $state("");
	let loading = $state(false);

	async function handleMigrate() {
		if (!password) return;
		loading = true;
		error = "";
		try {
			const entries = await migrateAndLoad(password);
			appStore.finishLoading(entries);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}
</script>

<div class="unlock-screen">
	<div class="glow" aria-hidden="true"></div>
	<div class="card">
		<h1>Terminal Navigator</h1>
		<p class="explainer">
			Your existing project data is still in the old encrypted format. Enter your previous master password once to
			migrate it — you won't be asked again.
		</p>
		<Input
			id="legacy-password"
			label="Previous master password"
			variant="password"
			autofocus
			bind:value={password}
			onEnter={handleMigrate}
			error={error || undefined}
		/>
		<Button variant="primary" onclick={handleMigrate} loading={loading}>Migrate</Button>
	</div>
</div>

<style>
	.unlock-screen {
		position: relative;
		height: 100%;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		/* FR-15/design.md §4.7 (v2.3): this is a full-page pattern replacing
		   the app shell outright, so it owns the scrim itself — previously
		   this was plain --color-background (opaque), which meant the
		   unlock screen never respected --window-transparency at all,
		   contradicting FR-15's own edge case (NFR-8). */
		background: var(--color-background-scrim);
	}

	.glow {
		position: absolute;
		width: var(--unlock-glow-size);
		height: var(--unlock-glow-size);
		border-radius: var(--radius-full);
		background: var(--color-accent-gradient);
		filter: blur(4rem);
		opacity: 0.15;
		pointer-events: none;
	}

	.card {
		position: relative;
		width: var(--unlock-card-width);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-6);
		padding: var(--space-8);
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-glow-primary);
	}

	.card > :global(.field) {
		width: 100%;
	}

	.card > :global(.btn) {
		width: 100%;
	}

	h1 {
		font-size: var(--text-xl);
		text-align: center;
	}

	.explainer {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		text-align: center;
	}
</style>
