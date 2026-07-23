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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    pub theme_preset: String,
    pub keybindings: HashMap<String, String>,
    pub sidebar_position: SidebarPosition,
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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme_preset: "app-default".to_string(),
            keybindings: default_keybindings(),
            sidebar_position: SidebarPosition::Left,
            // design.md §4.6: the app looks exactly as it does today until
            // the user opts in.
            glass_intensity: 0.0,
            // design.md §4.7: same — 0 is a fully opaque window.
            window_transparency: 0.0,
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
    fn defaults_include_all_twelve_registry_actions() {
        let settings = Settings::default();
        assert_eq!(settings.keybindings.len(), 13);
        assert_eq!(settings.keybindings.get("clipboard.copy"), Some(&"Ctrl+Shift+C".to_string()));
        assert_eq!(settings.keybindings.get("pane.moveFocusDown"), Some(&"Alt+ArrowDown".to_string()));
        assert_eq!(settings.keybindings.get("terminal.zoomIn"), Some(&"Ctrl+=".to_string()));
        assert_eq!(settings.keybindings.get("terminal.zoomOut"), Some(&"Ctrl+-".to_string()));
        assert_eq!(settings.keybindings.get("terminal.closeSession"), Some(&"Ctrl+Shift+W".to_string()));
        assert_eq!(settings.keybindings.get("terminal.nextTab"), Some(&"Ctrl+Tab".to_string()));
        assert_eq!(settings.keybindings.get("terminal.previousTab"), Some(&"Ctrl+Shift+Tab".to_string()));
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
