use tauri::{Emitter, Manager};

#[derive(Clone, serde::Serialize)]
struct SingleInstancePayload {
    args: Vec<String>,
    cwd: String,
}

#[tauri::command]
fn get_cli_args() -> Vec<String> {
    std::env::args().collect()
}

/// Registers "Open with Open PDF Studio" in Windows Explorer context menu for PDF files.
#[cfg(target_os = "windows")]
fn register_pdf_context_menu() {
    use winreg::enums::*;
    use winreg::RegKey;

    if let Ok(current_exe) = std::env::current_exe() {
        let exe_path_str = current_exe.to_string_lossy();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path = r"Software\Classes\SystemFileAssociations\.pdf\shell\OpenPDFStudio";

        if let Ok((key, _)) = hkcu.create_subkey(path) {
            let _ = key.set_value("", &"Open with Open PDF Studio");
            let _ = key.set_value("Icon", &format!("\"{}\"", exe_path_str));

            if let Ok((cmd_key, _)) = key.create_subkey("command") {
                let cmd_str = format!("\"{}\" \"%1\"", exe_path_str);
                let _ = cmd_key.set_value("", &cmd_str);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn register_pdf_context_menu() {}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        let _ = app.emit("single-instance", SingleInstancePayload { args: argv, cwd });
    }));

    builder
        .invoke_handler(tauri::generate_handler![greet, get_cli_args])
        .setup(|app| {
            register_pdf_context_menu();

            if let Some(window) = app.get_webview_window("main") {
                let icon = tauri::include_image!("icons/icon.ico");
                let _ = window.set_icon(icon);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
