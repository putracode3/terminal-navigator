mod command_runner;
mod commands;
mod config_sync;
mod crypto;
mod error;
mod git_status;
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
            // the project data to owner-only. Without this, the directory
            // (and the data file inside it) end up with whatever
            // permissions the OS default/umask gives — this app shouldn't
            // rely on an ancestor directory happening to be locked down.
            // Since ADR-0014 removed encryption, this is the data's only
            // protection, not a defense-in-depth layer.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Err(e) = std::fs::set_permissions(&data_dir, std::fs::Permissions::from_mode(0o700)) {
                    eprintln!("warning: failed to restrict app data directory permissions: {e}");
                }
            }

            // Seeds a fresh (first-run) store with a "Home" project
            // (project_store::load) so the sidebar is never totally empty
            // on first launch. Not fatal if this can't be resolved — the
            // fresh store then just starts empty, same as before this
            // existed.
            let home_dir = app.path().home_dir().ok();
            if home_dir.is_none() {
                eprintln!("warning: failed to resolve home directory — the sidebar will start empty on first launch");
            }

            app.manage(AppState {
                store: Mutex::new(None),
                data_file: data_dir.join("projects.enc"),
                settings_file: data_dir.join("settings.json"),
                home_dir,
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
            commands::init_store,
            commands::migrate_and_load,
            commands::list_sidebar_entries,
            commands::add_project,
            commands::update_project,
            commands::delete_project,
            commands::merge_projects,
            commands::move_project,
            commands::reorder_folder,
            commands::rename_folder,
            commands::open_terminal,
            commands::home_dir,
            commands::open_home_terminal,
            commands::split_pane,
            commands::write_terminal,
            commands::resize_terminal,
            commands::close_terminal,
            commands::export_config,
            commands::import_config,
            commands::path_exists,
            commands::get_git_branch,
            commands::get_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
