mod ai;
mod capture;
mod commands;
mod export;
mod scheduler;
mod storage;

use commands::capture::AppState;
use capture::detector::CaptureDetector;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Arc::new(
        storage::database::Database::new().expect("Failed to initialize database"),
    );

    let detector = CaptureDetector::new();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("xiaoyun".into()) }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["CmdOrCtrl+Shift+Y", "CmdOrCtrl+Shift+C"])
                .expect("Failed to parse shortcuts")
                .with_handler(|app, shortcut, event| {
                    if let tauri_plugin_global_shortcut::ShortcutState::Pressed = event.state {
                        let key = shortcut.key;
                        use tauri_plugin_global_shortcut::Code;
                        match key {
                            Code::KeyY => {
                                show_main_window(app, None);
                            }
                            Code::KeyC => {
                                trigger_spotlight_capture(app);
                            }
                            _ => {}
                        }
                    }
                })
                .build(),
        )
        .manage(AppState {
            db,
            pending_capture: std::sync::Arc::new(std::sync::Mutex::new(None)),
        })
        .setup(move |app| {
            eprintln!("[xiaoyun] App setup started");

            // --- Apply macOS vibrancy + auto-hide on blur ---
            if let Some(spotlight_win) = app.get_webview_window("spotlight") {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                let _ = apply_vibrancy(
                    &spotlight_win,
                    NSVisualEffectMaterial::HudWindow,
                    None,
                    Some(22.0),
                );

                // Hide spotlight when it loses focus (user clicked elsewhere).
                // This is more reliable than JS onFocusChanged which can stop
                // firing after repeated show/hide cycles.
                let win_clone = spotlight_win.clone();
                spotlight_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = win_clone.hide();
                    }
                });
            }

            // --- Intercept window close: hide instead of destroy ---
            if let Some(main_win) = app.get_webview_window("main") {
                let win_clone = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Prevent actual close, just hide the window
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            // --- System Tray ---
            setup_tray(app)?;

            // --- Start capture detector (auto-saves to database) ---
            eprintln!("[xiaoyun] Starting capture detector...");
            detector.start(app.handle().clone());
            eprintln!("[xiaoyun] Capture detector started!");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture::save_captured_content,
            commands::capture::save_spotlight_content,
            commands::capture::confirm_capture,
            commands::capture::dismiss_capture,
            commands::capture::get_pending_capture,
            commands::capture::debug_log,
            commands::capture::retry_url_fetch,
            commands::capture::ocr_image,
            commands::capture::get_contents_by_ids,
            commands::capture::test_ai_connection,
            commands::storage::get_all_content,
            commands::storage::delete_content,
            commands::report::generate_report,
            commands::report::get_report,
            commands::report::get_all_reports,
            commands::report::submit_feedback,
            commands::preferences::get_settings,
            commands::preferences::update_setting,
            commands::preferences::check_xreader_status,
            commands::chat::chat_with_content,
            commands::chat::get_chat_history,
            commands::chat::save_chat_message,
            commands::chat::clear_chat_history,
            commands::digest::get_digest_items,
            commands::digest::digest_item,
            commands::mcp::get_mcp_status,
            commands::mcp::connect_mcp,
            commands::mcp::disconnect_mcp,
            commands::mcp::copy_content_summary,
            commands::datahub::search_content,
            commands::datahub::get_dates_with_content,
            commands::datahub::get_content_for_date,
            commands::datahub::export_day_markdown,
            commands::datahub::export_all_markdown,
            commands::datahub::export_date_range_markdown,
            commands::datahub::get_export_dir,
            commands::datahub::set_export_dir,
            commands::datahub::open_export_dir,
            commands::datahub::get_storage_info,
            commands::datahub::export_all_single,
            commands::datahub::export_range_single,
            commands::datahub::open_data_folder,
            commands::attention::get_attention_insights,
            commands::attention::trigger_attention_analysis,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Handle Dock icon click on macOS: always show main window
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app, None);
            }
        });
}

/// Triggered by Cmd+Shift+C.
/// 1. Simulate Cmd+C to copy the user's current selection
/// 2. Wait a moment for the clipboard to update
/// 3. Read clipboard content
/// 4. Send it to the spotlight window via event
/// 5. Show the spotlight window
fn trigger_spotlight_capture(app: &tauri::AppHandle) {
    use tauri::Emitter;

    let app_clone = app.clone();
    std::thread::spawn(move || {
        // Step 1: Simulate Cmd+C via osascript
        let _ = std::process::Command::new("osascript")
            .args([
                "-e",
                r#"tell application "System Events" to keystroke "c" using command down"#,
            ])
            .output();

        // Step 2: Wait for clipboard to update
        std::thread::sleep(std::time::Duration::from_millis(150));

        // Step 3: Read clipboard
        let (content_type, raw_text, image_path) = read_clipboard_content();

        // Step 4: Detect source app
        let source_app = detect_frontmost_app();

        // Step 5: Emit content to spotlight window
        let payload = serde_json::json!({
            "content_type": content_type,
            "raw_text": raw_text,
            "image_path": image_path,
            "source_app": source_app,
        });
        let _ = app_clone.emit("spotlight:content-ready", payload);

        // Step 6: Show spotlight window
        if let Some(win) = app_clone.get_webview_window("spotlight") {
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
        }
    });
}

/// Read current clipboard content (text or image).
fn read_clipboard_content() -> (String, Option<String>, Option<String>) {
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        // Try text first
        if let Ok(text) = clipboard.get_text() {
            if !text.is_empty() {
                // Check if it's a URL
                if text.trim().starts_with("http://") || text.trim().starts_with("https://") {
                    return ("url".to_string(), Some(text), None);
                }
                return ("text".to_string(), Some(text), None);
            }
        }

        // Try image
        if let Ok(img) = clipboard.get_image() {
            // Save image to disk
            if let Some(path) = save_clipboard_image(&img) {
                return ("image".to_string(), None, Some(path));
            }
        }
    }

    ("text".to_string(), None, None)
}

/// Save clipboard image pixels to a temporary PNG file.
fn save_clipboard_image(img: &arboard::ImageData) -> Option<String> {
    let base = dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Library").join("Application Support")))?;

    let captures_dir = base.join("com.xiaoyun.app").join("captures");
    let _ = std::fs::create_dir_all(&captures_dir);

    let id = uuid::Uuid::new_v4().to_string();
    let file_path = captures_dir.join(format!("{}.png", id));

    let rgba_buf = image::RgbaImage::from_raw(
        img.width as u32,
        img.height as u32,
        img.bytes.to_vec(),
    )?;

    if rgba_buf.save(&file_path).is_ok() {
        Some(file_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Detect the frontmost application on macOS.
fn detect_frontmost_app() -> String {
    match std::process::Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        ])
        .output()
    {
        Ok(output) if output.status.success() => {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if name.is_empty() { "Unknown".to_string() } else { name }
        }
        _ => "Unknown".to_string(),
    }
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show = MenuItem::with_id(app, "show", "打开小云", true, None::<&str>)?;
    let report = MenuItem::with_id(app, "report", "生成周报", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &report, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("小云 — 智能信息助手")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => {
                    show_main_window(app, None);
                }
                "report" => {
                    show_main_window(app, Some("report"));
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

fn show_main_window(app: &tauri::AppHandle, tab: Option<&str>) {
    use tauri::Emitter;

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        if let Some(tab) = tab {
            let _ = app.emit("navigate-tab", tab);
        }
    }
}
