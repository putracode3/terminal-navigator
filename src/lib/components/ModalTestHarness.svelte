<script lang="ts">
	import Modal from "./Modal.svelte";

	let {
		open,
		onClose,
		closeOnBackdropClick = true,
	}: {
		open: boolean;
		onClose: () => void;
		closeOnBackdropClick?: boolean;
	} = $props();
</script>

<Modal {open} title="Test modal" {onClose} {closeOnBackdropClick}>
	{#snippet children()}
		<p>Modal body content</p>
		<input aria-label="first field" />
		<input aria-label="second field" />
	{/snippet}
	{#snippet footer()}
		<button>Cancel</button>
		<button>Confirm</button>
	{/snippet}
</Modal>
