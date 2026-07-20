// FR-13 non-sensitive preferences (theme, keybindings, sidebar position) —
// loaded independently of appStore's lock state (NFR-8/ADR-0009): this
// store's `load()` must be safe to call before `unlock`.
import { getSettings, saveSettings, type SettingsDto, type SidebarPosition } from "$lib/api";
import { DEFAULT_KEYBINDINGS } from "$lib/keybindings";

class SettingsStore {
	themePreset = $state("app-default");
	// Starts at the real defaults (not empty placeholders) so e.g.
	// TerminalPane's clipboard shortcuts work correctly even in the brief
	// window before load() resolves, not just after.
	keybindings = $state<Record<string, string>>({ ...DEFAULT_KEYBINDINGS });
	sidebarPosition = $state<SidebarPosition>("left");
	loaded = $state(false);

	async load(): Promise<void> {
		const settings = await getSettings();
		this.apply(settings);
		this.loaded = true;
	}

	private apply(settings: SettingsDto): void {
		this.themePreset = settings.themePreset;
		this.keybindings = settings.keybindings;
		this.sidebarPosition = settings.sidebarPosition;
	}

	private toDto(): SettingsDto {
		return {
			themePreset: this.themePreset,
			keybindings: this.keybindings,
			sidebarPosition: this.sidebarPosition,
		};
	}

	/** Every setter here autosaves immediately (components.md, Settings Panel
	 * pattern) and rolls the in-memory value back if the save fails, so the
	 * UI never shows a value that isn't actually persisted. */
	async setThemePreset(id: string): Promise<void> {
		const previous = this.themePreset;
		this.themePreset = id;
		try {
			await saveSettings(this.toDto());
		} catch (e) {
			this.themePreset = previous;
			throw e;
		}
	}

	async setSidebarPosition(position: SidebarPosition): Promise<void> {
		const previous = this.sidebarPosition;
		this.sidebarPosition = position;
		try {
			await saveSettings(this.toDto());
		} catch (e) {
			this.sidebarPosition = previous;
			throw e;
		}
	}

	async setKeybinding(actionId: string, combo: string): Promise<void> {
		const previous = this.keybindings;
		this.keybindings = { ...this.keybindings, [actionId]: combo };
		try {
			await saveSettings(this.toDto());
		} catch (e) {
			this.keybindings = previous;
			throw e;
		}
	}
}

export const settingsStore = new SettingsStore();
