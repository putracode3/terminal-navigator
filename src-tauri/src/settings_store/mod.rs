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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub theme_preset: String,
    pub keybindings: HashMap<String, String>,
    pub sidebar_position: SidebarPosition,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme_preset: "app-default".to_string(),
            keybindings: default_keybindings(),
            sidebar_position: SidebarPosition::Left,
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
        assert_eq!(settings.keybindings.len(), 12);
        assert_eq!(settings.keybindings.get("clipboard.copy"), Some(&"Ctrl+Shift+C".to_string()));
        assert_eq!(settings.keybindings.get("pane.moveFocusDown"), Some(&"Alt+ArrowDown".to_string()));
        assert_eq!(settings.keybindings.get("terminal.zoomIn"), Some(&"Ctrl+=".to_string()));
        assert_eq!(settings.keybindings.get("terminal.zoomOut"), Some(&"Ctrl+-".to_string()));
        assert_eq!(settings.keybindings.get("terminal.nextTab"), Some(&"Ctrl+Tab".to_string()));
        assert_eq!(settings.keybindings.get("terminal.previousTab"), Some(&"Ctrl+Shift+Tab".to_string()));
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
