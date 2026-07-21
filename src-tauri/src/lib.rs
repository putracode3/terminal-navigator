mod command_runner;
mod commands;
mod config_sync;
mod crypto;
mod error;
mod project_store;
mod pty_manager;
mod settings_store;

use std::sync::Mutex;

use tauri::Manager;

use commands::AppState;
use pty_manager::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data directory");
            // Security audit 2026-07-20, M3: restrict the directory holding
            // the encrypted project data to owner-only. Without this, the
            // directory (and the data file inside it) end up with whatever
            // permissions the OS default/umask gives — this app shouldn't
            // rely on an ancestor directory happening to be locked down.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Err(e) = std::fs::set_permissions(&data_dir, std::fs::Permissions::from_mode(0o700)) {
                    eprintln!("warning: failed to restrict app data directory permissions: {e}");
                }
            }

            app.manage(AppState {
                store: Mutex::new(None),
                data_file: data_dir.join("projects.enc"),
                settings_file: data_dir.join("settings.json"),
                pty_manager: PtyManager::new(),
            });

            // tauri.conf.json's `"maximized": true` alone is unreliable on Linux:
            // the window manager can ignore a maximize request made before the
            // window is actually mapped. Maximizing explicitly here (after the
            // window exists, before it's shown — see `"visible": false` in
            // tauri.conf.json) avoids both the ignored-request race and any
            // visible flash of the small pre-maximize size.
            let window = app
                .get_webview_window("main")
                .expect("no window with label \"main\" — check tauri.conf.json's window label");

            // Maximize is a cosmetic nicety: if the window manager rejects or
            // doesn't support it, fall back to the normal windowed size rather
            // than take the whole app down over it.
            if let Err(e) = window.maximize() {
                eprintln!("warning: failed to maximize the main window on startup: {e}");
            }

            // Becoming visible at all is not optional — tauri.conf.json starts
            // the window hidden, so if this fails the app would otherwise hang
            // with no window and no explanation. Fail loudly instead.
            window.show().expect("failed to show the main window");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::unlock,
            commands::list_sidebar_entries,
            commands::add_project,
            commands::update_project,
            commands::delete_project,
            commands::merge_projects,
            commands::move_project,
            commands::reorder_folder,
            commands::rename_folder,
            commands::open_terminal,
            commands::split_pane,
            commands::write_terminal,
            commands::resize_terminal,
            commands::close_terminal,
            commands::export_config,
            commands::import_config,
            commands::path_exists,
            commands::get_settings,
            commands::save_settings,
            commands::change_master_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
