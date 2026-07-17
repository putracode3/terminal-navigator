mod command_runner;
mod commands;
mod config_sync;
mod crypto;
mod error;
mod project_store;
mod pty_manager;

use std::sync::Mutex;

use tauri::Manager;

use commands::AppState;
use pty_manager::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data directory");

            app.manage(AppState {
                store: Mutex::new(None),
                data_file: data_dir.join("projects.enc"),
                pty_manager: PtyManager::new(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::unlock,
            commands::list_projects,
            commands::add_project,
            commands::update_project,
            commands::delete_project,
            commands::open_terminal,
            commands::split_pane,
            commands::write_terminal,
            commands::resize_terminal,
            commands::close_terminal,
            commands::export_config,
            commands::import_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
