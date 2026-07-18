<script lang="ts">
	import Input from "$lib/components/Input.svelte";
	import Button from "$lib/components/Button.svelte";
	import SecurityBadge from "$lib/components/SecurityBadge.svelte";
	import { unlock, errorMessage } from "$lib/api";
	import { appStore } from "$lib/stores/app.svelte";

	let password = $state("");
	let error = $state("");
	let loading = $state(false);

	async function handleUnlock() {
		if (!password) return;
		loading = true;
		error = "";
		try {
			const projects = await unlock(password);
			appStore.unlockWith(password, projects);
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
		<SecurityBadge variant="labeled" label="Encrypted" />
		<Input
			id="master-password"
			label="Master password"
			variant="password"
			autofocus
			bind:value={password}
			onEnter={handleUnlock}
			error={error || undefined}
		/>
		<Button variant="primary" onclick={handleUnlock} loading={loading}>Unlock</Button>
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
		background: var(--color-background);
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
</style>
