//! Non-sensitive app preferences — theme, keybindings, sidebar position
//! (FR-13, ADR-0009). Plaintext JSON, no `crypto` dependency, no unlock
//! gate: must be loadable/saveable before `project_store::unlock` is ever
//! called, so app chrome can render correctly even at the unlock screen
//! (NFR-8).

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SidebarPosition {
    #[default]
    Left,
    Right,
}

/// App-chrome appearance (design.md §4.1a, v2.5) — distinct from `theme_preset`
/// above, which governs terminal *content* colors only (§4.5) and is
/// unaffected by this. `System` is resolved to `Dark`/`Light` by the
/// frontend via `matchMedia`; the backend never interprets this value, it
/// only persists it (same "opaque to the backend" stance the rest of this
/// module already takes with e.g. keybinding action ids).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    pub theme_preset: String,
    pub keybindings: HashMap<String, String>,
    pub sidebar_position: SidebarPosition,
    /// App-chrome light/dark/system (design.md §4.1a, v2.5). `#[serde(default)]`
    /// for the same backward-compatibility reason as `glass_intensity` below —
    /// every settings.json written before this field existed must still load.
    #[serde(default)]
    pub theme_mode: ThemeMode,
    /// FR-14 glass intensity, 0.0..=1.0 (0 = fully opaque).
    ///
    /// `#[serde(default)]` is load-bearing, not decoration: `load()` treats
    /// an unparseable file as `Corrupted` rather than falling back to
    /// defaults, so without this a settings.json written by any earlier
    /// build — i.e. every existing install — would fail to parse the moment
    /// this field was added. Any future field added here needs the same
    /// treatment for the same reason.
    #[serde(default)]
    pub glass_intensity: f32,
    /// FR-15 window transparency, 0.0..=1.0 (0 = fully opaque).
    ///
    /// Deliberately a separate value from `glass_intensity`, not a shared
    /// one: glass is panel-over-panel inside the app, this is the whole app
    /// over the desktop (ADR-0012). Same `#[serde(default)]` reasoning as
    /// above — without it, every settings.json written before this field
    /// existed would fail to parse.
    #[serde(default)]
    pub window_transparency: f32,
    /// FR-11 (components.md "Sidebar Folder"): per-folder expand/collapse
    /// state, keyed by folder id (as string, matching the id shape already
    /// used at the IPC boundary for folders — see ADR-0011). A folder id
    /// absent from this map is treated as expanded — components.md's
    /// Anatomy table gives "expanded" as the default state, so this map
    /// only ever needs to record departures from that default, not every
    /// folder's state explicitly. Same `#[serde(default)]` reasoning as the
    /// fields above — without it, every settings.json written before this
    /// field existed would fail to parse.
    #[serde(default)]
    pub folder_expanded: HashMap<String, bool>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme_preset: "app-default".to_string(),
            keybindings: default_keybindings(),
            sidebar_position: SidebarPosition::Left,
            // design.md §4.1a: dark remains the default app-chrome theme.
            theme_mode: ThemeMode::Dark,
            // design.md §4.6: the app looks exactly as it does today until
            // the user opts in.
            glass_intensity: 0.0,
            // design.md §4.7: same — 0 is a fully opaque window.
            window_transparency: 0.0,
            // components.md: no folder has been collapsed yet, so nothing
            // to record — absence already means expanded.
            folder_expanded: HashMap::new(),
        }
    }
}

/// architecture.md §5.6's default keybinding registry — what ships until
/// the user rebinds anything. `settings_store` treats these action ids as
/// opaque strings; it has no idea what any of them actually do.
fn default_keybindings() -> HashMap<String, String> {
    [
        ("clipboard.copy", "Ctrl+Shift+C"),
        ("clipboard.paste", "Ctrl+Shift+V"),
        ("pane.splitBottom", "Alt+Shift+D"),
        ("pane.splitRight", "Alt+Shift+R"),
        ("pane.moveFocusLeft", "Alt+ArrowLeft"),
        ("pane.moveFocusRight", "Alt+ArrowRight"),
        ("pane.moveFocusUp", "Alt+ArrowUp"),
        ("pane.moveFocusDown", "Alt+ArrowDown"),
        ("terminal.zoomIn", "Ctrl+="),
        ("terminal.zoomOut", "Ctrl+-"),
        ("terminal.closeSession", "Ctrl+Shift+W"),
        ("terminal.nextTab", "Ctrl+Tab"),
        ("terminal.previousTab", "Ctrl+Shift+Tab"),
        ("sidebar.toggle", "Ctrl+B"),
    ]
    .into_iter()
    .map(|(action, combo)| (action.to_string(), combo.to_string()))
    .collect()
}

#[derive(Debug, Error)]
pub enum SettingsStoreError {
    #[error("two actions cannot share the same keybinding: {0}")]
    DuplicateKeybinding(String),
    #[error("glass intensity must be between 0.0 and 1.0, got {0}")]
    GlassIntensityOutOfRange(f32),
    #[error("window transparency must be between 0.0 and 1.0, got {0}")]
    WindowTransparencyOutOfRange(f32),
    #[error("failed to read/write settings file")]
    Io(#[from] std::io::Error),
    #[error("settings file is corrupted or in an unrecognized format")]
    Corrupted,
}

/// Loads `Settings` from `path`. A missing file (first launch) yields the
/// defaults, not an error. A present-but-unparseable file IS an error —
/// never silently discarded/replaced with defaults, matching
/// `project_store`'s own philosophy of surfacing corruption instead of
/// masking it.
pub fn load(path: &Path) -> Result<Settings, SettingsStoreError> {
    if !path.exists() {
        return Ok(Settings::default());
    }
    let raw = std::fs::read_to_string(path)?;
    serde_json::from_str(&raw).map_err(|_| SettingsStoreError::Corrupted)
}

/// Validates, then atomically writes `settings` to `path` (temp file +
/// rename in the same directory — crash-safe, same reasoning as ADR-0010
/// even though this file holds nothing sensitive).
pub fn save(path: &Path, settings: &Settings) -> Result<(), SettingsStoreError> {
    validate(settings)?;
    let json = serde_json::to_string_pretty(settings).map_err(|_| SettingsStoreError::Corrupted)?;
    write_atomic(path, json.as_bytes())?;
    Ok(())
}

/// Generic conflict check: no two action ids may map to the same combo.
/// Deliberately doesn't need to know what any action does (architecture.md
/// §5.6) — it only ever looks at the values, never the keys' meaning.
fn validate(settings: &Settings) -> Result<(), SettingsStoreError> {
    let mut seen: HashSet<&str> = HashSet::new();
    for combo in settings.keybindings.values() {
        if !seen.insert(combo.as_str()) {
            return Err(SettingsStoreError::DuplicateKeybinding(combo.clone()));
        }
    }
    // Range-checked here rather than trusted from the frontend slider —
    // same server-side-validation stance the rest of this module takes.
    // An out-of-range value would drive --glass-intensity past the
    // contrast-verified floors baked into tokens.css (design.md §4.6),
    // which is exactly what those floors exist to make unreachable.
    if !(0.0..=1.0).contains(&settings.glass_intensity) || settings.glass_intensity.is_nan() {
        return Err(SettingsStoreError::GlassIntensityOutOfRange(settings.glass_intensity));
    }
    // Same range guard, same reason (design.md §4.7): an out-of-range value
    // would drive --window-transparency past the scrim floor that keeps
    // primary text readable over an arbitrary wallpaper.
    if !(0.0..=1.0).contains(&settings.window_transparency) || settings.window_transparency.is_nan()
    {
        return Err(SettingsStoreError::WindowTransparencyOutOfRange(
            settings.window_transparency,
        ));
    }
    Ok(())
}

fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("settings.json");
    let tmp_path = dir.join(format!(".{file_name}.tmp"));
    std::fs::write(&tmp_path, contents)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn load_returns_defaults_when_file_missing() {
        let dir = tempdir().unwrap();
        let settings = load(&dir.path().join("settings.json")).unwrap();
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn defaults_include_all_fourteen_registry_actions() {
        let settings = Settings::default();
        assert_eq!(settings.keybindings.len(), 14);
        assert_eq!(settings.keybindings.get("clipboard.copy"), Some(&"Ctrl+Shift+C".to_string()));
        assert_eq!(settings.keybindings.get("pane.moveFocusDown"), Some(&"Alt+ArrowDown".to_string()));
        assert_eq!(settings.keybindings.get("terminal.zoomIn"), Some(&"Ctrl+=".to_string()));
        assert_eq!(settings.keybindings.get("terminal.zoomOut"), Some(&"Ctrl+-".to_string()));
        assert_eq!(settings.keybindings.get("terminal.closeSession"), Some(&"Ctrl+Shift+W".to_string()));
        assert_eq!(settings.keybindings.get("terminal.nextTab"), Some(&"Ctrl+Tab".to_string()));
        assert_eq!(settings.keybindings.get("terminal.previousTab"), Some(&"Ctrl+Shift+Tab".to_string()));
        assert_eq!(settings.keybindings.get("sidebar.toggle"), Some(&"Ctrl+B".to_string()));
    }

    /// Regression: adding `glass_intensity` (FR-14) must not orphan the
    /// settings.json every existing install already has on disk. `load()`
    /// surfaces corruption rather than masking it, so a missing field has
    /// to deserialize via `#[serde(default)]` instead of erroring.
    #[test]
    fn load_accepts_settings_file_written_before_glass_intensity_existed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // Exactly the shape a pre-FR-14 build wrote — no glass_intensity key.
        std::fs::write(
            &path,
            r#"{
                "theme_preset": "dracula",
                "keybindings": {"clipboard.copy": "Ctrl+Shift+C"},
                "sidebar_position": "right"
            }"#,
        )
        .unwrap();

        let settings = load(&path).expect("pre-FR-14 settings file must still load");
        assert_eq!(settings.theme_preset, "dracula");
        assert_eq!(settings.sidebar_position, SidebarPosition::Right);
        assert_eq!(settings.glass_intensity, 0.0, "missing field defaults to fully opaque");
    }

    #[test]
    fn save_rejects_glass_intensity_outside_zero_to_one() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        for bad in [1.5_f32, -0.1, f32::NAN] {
            let settings = Settings { glass_intensity: bad, ..Settings::default() };
            assert!(
                matches!(save(&path, &settings), Err(SettingsStoreError::GlassIntensityOutOfRange(_))),
                "glass_intensity {bad} should have been rejected"
            );
        }
    }

    #[test]
    fn save_accepts_glass_intensity_at_both_ends_of_the_range() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        for good in [0.0_f32, 0.5, 1.0] {
            let settings = Settings { glass_intensity: good, ..Settings::default() };
            save(&path, &settings).unwrap_or_else(|e| panic!("{good} should be accepted: {e}"));
            assert_eq!(load(&path).unwrap().glass_intensity, good);
        }
    }

    /// Regression for the second field added this way: a settings.json
    /// written by the FR-14 build (glass_intensity present, no
    /// window_transparency) must still load. Guards the `#[serde(default)]`
    /// on the newer field specifically — the FR-14 test above would still
    /// pass even if this one were missing.
    #[test]
    fn load_accepts_settings_file_written_before_window_transparency_existed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{
                "theme_preset": "nord",
                "keybindings": {"clipboard.copy": "Ctrl+Shift+C"},
                "sidebar_position": "left",
                "glass_intensity": 0.6
            }"#,
        )
        .unwrap();

        let settings = load(&path).expect("FR-14-era settings file must still load");
        assert_eq!(settings.theme_preset, "nord");
        assert_eq!(settings.glass_intensity, 0.6);
        assert_eq!(settings.window_transparency, 0.0, "missing field defaults to opaque");
    }

    /// Regression for the third field added this way (design.md §4.1a,
    /// v2.5): a settings.json written by the FR-15 build (window_transparency
    /// present, no theme_mode) must still load, defaulting to Dark.
    #[test]
    fn load_accepts_settings_file_written_before_theme_mode_existed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{
                "theme_preset": "solarized-dark",
                "keybindings": {"clipboard.copy": "Ctrl+Shift+C"},
                "sidebar_position": "left",
                "glass_intensity": 0.2,
                "window_transparency": 0.1
            }"#,
        )
        .unwrap();

        let settings = load(&path).expect("FR-15-era settings file must still load");
        assert_eq!(settings.theme_preset, "solarized-dark");
        assert_eq!(settings.theme_mode, ThemeMode::Dark, "missing field defaults to Dark");
    }

    #[test]
    fn theme_mode_persists_through_save_and_load() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        for mode in [ThemeMode::Dark, ThemeMode::Light, ThemeMode::System] {
            let settings = Settings { theme_mode: mode, ..Settings::default() };
            save(&path, &settings).unwrap();
            assert_eq!(load(&path).unwrap().theme_mode, mode);
        }
    }

    /// Regression for the fourth field added this way (FR-11): a
    /// settings.json written by the pre-folder_expanded build (theme_mode
    /// present, no folder_expanded) must still load, defaulting to an empty
    /// map — i.e. every folder renders expanded, matching this app's
    /// behavior before this field existed.
    #[test]
    fn load_accepts_settings_file_written_before_folder_expanded_existed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{
                "theme_preset": "nord",
                "keybindings": {"clipboard.copy": "Ctrl+Shift+C"},
                "sidebar_position": "left",
                "theme_mode": "dark",
                "glass_intensity": 0.0,
                "window_transparency": 0.0
            }"#,
        )
        .unwrap();

        let settings = load(&path).expect("pre-FR-11-collapse-state settings file must still load");
        assert_eq!(settings.theme_preset, "nord");
        assert!(settings.folder_expanded.is_empty(), "missing field defaults to an empty map");
    }

    #[test]
    fn folder_expanded_persists_through_save_and_load() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut folder_expanded = HashMap::new();
        folder_expanded.insert("folder-1".to_string(), false);
        folder_expanded.insert("folder-2".to_string(), true);
        let settings = Settings { folder_expanded: folder_expanded.clone(), ..Settings::default() };

        save(&path, &settings).unwrap();

        assert_eq!(load(&path).unwrap().folder_expanded, folder_expanded);
    }

    #[test]
    fn save_rejects_window_transparency_outside_zero_to_one() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        for bad in [1.2_f32, -0.5, f32::NAN] {
            let settings = Settings { window_transparency: bad, ..Settings::default() };
            assert!(
                matches!(
                    save(&path, &settings),
                    Err(SettingsStoreError::WindowTransparencyOutOfRange(_))
                ),
                "window_transparency {bad} should have been rejected"
            );
        }
    }

    /// The two effects are independent per ADR-0012 — setting one must not
    /// disturb the other, in either direction.
    #[test]
    fn glass_intensity_and_window_transparency_persist_independently() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings =
            Settings { glass_intensity: 0.8, window_transparency: 0.3, ..Settings::default() };
        save(&path, &settings).unwrap();

        let loaded = load(&path).unwrap();
        assert_eq!(loaded.glass_intensity, 0.8);
        assert_eq!(loaded.window_transparency, 0.3);
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = Settings {
            theme_preset: "dracula".to_string(),
            sidebar_position: SidebarPosition::Right,
            ..Settings::default()
        };

        save(&path, &settings).unwrap();
        let reloaded = load(&path).unwrap();

        assert_eq!(reloaded, settings);
    }

    #[test]
    fn save_rejects_duplicate_keybindings() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = Settings::default();
        settings.keybindings.insert("clipboard.paste".to_string(), "Ctrl+Shift+C".to_string());

        let result = save(&path, &settings);
        assert!(matches!(result, Err(SettingsStoreError::DuplicateKeybinding(_))));
    }

    #[test]
    fn save_with_conflicting_keybindings_does_not_touch_existing_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let good = Settings::default();
        save(&path, &good).unwrap();
        let before = std::fs::read_to_string(&path).unwrap();

        let mut bad = good.clone();
        bad.keybindings.insert("clipboard.paste".to_string(), "Ctrl+Shift+C".to_string());
        assert!(save(&path, &bad).is_err());

        let after = std::fs::read_to_string(&path).unwrap();
        assert_eq!(before, after, "a rejected save must not modify the file on disk");
    }

    #[test]
    fn save_leaves_no_leftover_temp_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        save(&path, &Settings::default()).unwrap();

        assert!(!dir.path().join(".settings.json.tmp").exists());
    }

    #[test]
    fn load_fails_on_corrupted_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"not valid json").unwrap();

        let result = load(&path);
        assert!(matches!(result, Err(SettingsStoreError::Corrupted)));
    }
}
