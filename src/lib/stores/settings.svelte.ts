// FR-13 non-sensitive preferences (theme, keybindings, sidebar position) —
// loaded independently of appStore's lock state (NFR-8/ADR-0009): this
// store's `load()` must be safe to call before `unlock`.
import { getSettings, saveSettings, type SettingsDto, type SidebarPosition, type ThemeMode } from "$lib/api";
import { DEFAULT_KEYBINDINGS } from "$lib/keybindings";

class SettingsStore {
	themePreset = $state("app-default");
	// Starts at the real defaults (not empty placeholders) so e.g.
	// TerminalPane's clipboard shortcuts work correctly even in the brief
	// window before load() resolves, not just after.
	keybindings = $state<Record<string, string>>({ ...DEFAULT_KEYBINDINGS });
	sidebarPosition = $state<SidebarPosition>("left");
	// design.md §4.1a (v2.5). Starts at the real default ("dark") for the
	// same reason keybindings starts at DEFAULT_KEYBINDINGS above — the
	// unlock screen renders before load() resolves (NFR-8) and must not
	// flash a placeholder theme.
	themeMode = $state<ThemeMode>("dark");
	// FR-14 (design.md §4.6). 0 = fully opaque, matching the backend
	// default: the app looks exactly as it did until the user opts in.
	glassIntensity = $state(0);
	// FR-15 (design.md §4.7). 0 = fully opaque window, matching the backend
	// default — the app looks unchanged until the user opts in.
	windowTransparency = $state(0);
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
		this.glassIntensity = settings.glassIntensity;
		this.windowTransparency = settings.windowTransparency;
		this.themeMode = settings.themeMode;
	}

	private toDto(): SettingsDto {
		return {
			themePreset: this.themePreset,
			keybindings: this.keybindings,
			sidebarPosition: this.sidebarPosition,
			glassIntensity: this.glassIntensity,
			windowTransparency: this.windowTransparency,
			themeMode: this.themeMode,
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

	async setThemeMode(mode: ThemeMode): Promise<void> {
		const previous = this.themeMode;
		this.themeMode = mode;
		try {
			await saveSettings(this.toDto());
		} catch (e) {
			this.themeMode = previous;
			throw e;
		}
	}

	/** FR-14. Clamped here as well as backend-side so a caller can't drive
	 *  --glass-intensity past the contrast-verified floors in tokens.css
	 *  (design.md §4.6) — those floors are the whole reason no slider
	 *  position can fail AA. */
	async setGlassIntensity(intensity: number): Promise<void> {
		const previous = this.glassIntensity;
		this.glassIntensity = Math.min(1, Math.max(0, intensity));
		try {
			await saveSettings(this.toDto());
		} catch (e) {
			this.glassIntensity = previous;
			throw e;
		}
	}

	/** FR-15. Clamped here and backend-side, same as setGlassIntensity —
	 *  out-of-range would drive --window-transparency past the scrim floor
	 *  that keeps primary text readable over an arbitrary wallpaper
	 *  (design.md §4.7). */
	async setWindowTransparency(transparency: number): Promise<void> {
		const previous = this.windowTransparency;
		this.windowTransparency = Math.min(1, Math.max(0, transparency));
		try {
			await saveSettings(this.toDto());
		} catch (e) {
			this.windowTransparency = previous;
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
