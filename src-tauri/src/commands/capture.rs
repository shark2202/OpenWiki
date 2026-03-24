use crate::capture::content::{compute_hash, detect_url};
use crate::storage::database::Database;
use crate::storage::models::{CaptureEvent, CapturedContent, ContentType};
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

/// The application data directory name for storing captured images.
const APP_DATA_DIR: &str = "com.xiaoyun.app";
const CAPTURES_SUBDIR: &str = "captures";
const THUMBNAILS_SUBDIR: &str = "thumbnails";
const THUMBNAIL_WIDTH: u32 = 200;

pub struct AppState {
    pub db: Arc<Database>,
    /// Stores the latest pending capture for the bubble window to retrieve.
    pub pending_capture: Arc<Mutex<Option<serde_json::Value>>>,
}

/// Get the captures directory, creating it if necessary.
fn get_captures_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Library").join("Application Support")))
        .ok_or_else(|| "Cannot determine application data directory".to_string())?;

    let captures_dir = base.join(APP_DATA_DIR).join(CAPTURES_SUBDIR);
    std::fs::create_dir_all(&captures_dir)
        .map_err(|e| format!("Failed to create captures directory: {}", e))?;

    Ok(captures_dir)
}

/// Get the thumbnails directory, creating it if necessary.
fn get_thumbnails_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Library").join("Application Support")))
        .ok_or_else(|| "Cannot determine application data directory".to_string())?;

    let thumbnails_dir = base.join(APP_DATA_DIR).join(THUMBNAILS_SUBDIR);
    std::fs::create_dir_all(&thumbnails_dir)
        .map_err(|e| format!("Failed to create thumbnails directory: {}", e))?;

    Ok(thumbnails_dir)
}

/// Copy a source image to the captures directory and return the new path.
fn copy_image_to_captures(source_path: &str, id: &str) -> Result<String, String> {
    let source = Path::new(source_path);
    if !source.exists() {
        return Err(format!("Source image does not exist: {}", source_path));
    }

    let extension = source
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "png".to_string());

    let captures_dir = get_captures_dir()?;
    let dest_filename = format!("{}.{}", id, extension);
    let dest_path = captures_dir.join(&dest_filename);

    std::fs::copy(source, &dest_path)
        .map_err(|e| format!("Failed to copy image to captures: {}", e))?;

    let dest_str = dest_path.to_string_lossy().to_string();
    log::info!("Image copied to captures: {}", dest_str);
    Ok(dest_str)
}

/// Generate a thumbnail (200px wide, preserving aspect ratio) and save it.
/// Returns the thumbnail path if successful.
fn generate_thumbnail(source_path: &str, id: &str) -> Result<String, String> {
    let img = image::open(source_path)
        .map_err(|e| format!("Failed to open image for thumbnail: {}", e))?;

    let (orig_width, orig_height) = (img.width(), img.height());
    if orig_width == 0 || orig_height == 0 {
        return Err("Image has zero dimensions".to_string());
    }

    // Calculate new height preserving aspect ratio
    let new_width = THUMBNAIL_WIDTH.min(orig_width);
    let new_height = (orig_height as f64 * new_width as f64 / orig_width as f64) as u32;

    let thumbnail = img.thumbnail(new_width, new_height);

    let thumbnails_dir = get_thumbnails_dir()?;
    let thumb_filename = format!("{}_thumb.png", id);
    let thumb_path = thumbnails_dir.join(&thumb_filename);

    thumbnail
        .save(&thumb_path)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    let thumb_str = thumb_path.to_string_lossy().to_string();
    log::info!(
        "Thumbnail generated: {} ({}x{} -> {}x{})",
        thumb_str,
        orig_width,
        orig_height,
        new_width,
        new_height
    );
    Ok(thumb_str)
}

/// Internal auto-save function called directly from CaptureDetector.
/// Does not require Tauri State — takes a Database reference directly.
pub fn save_content_auto(db: &Arc<Database>, event: CaptureEvent) -> Result<CapturedContent, String> {
    let now = Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    // Detect content type and extract URL if applicable
    let (content_type, raw_text, image_path, detected_url) = match event.content_type.as_str() {
        "image" => (ContentType::Image, None, event.image_path, None),
        "url" => {
            let url = event.raw_text.as_deref().and_then(detect_url);
            (ContentType::Url, event.raw_text.clone(), None, url)
        }
        _ => {
            if let Some(ref text) = event.raw_text {
                if let Some(url) = detect_url(text) {
                    (ContentType::Url, event.raw_text.clone(), None, Some(url))
                } else {
                    (ContentType::Text, event.raw_text.clone(), None, None)
                }
            } else {
                (ContentType::Text, None, None, None)
            }
        }
    };

    let (final_image_path, thumbnail_path) = if content_type.as_str() == "image" {
        if let Some(ref src_path) = image_path {
            let copied_path = match copy_image_to_captures(src_path, &id) {
                Ok(p) => Some(p),
                Err(e) => {
                    log::error!("Failed to copy image: {}", e);
                    image_path.clone()
                }
            };

            let thumb_source = copied_path.as_deref().unwrap_or(src_path.as_str());
            let thumb_path = match generate_thumbnail(thumb_source, &id) {
                Ok(p) => Some(p),
                Err(e) => {
                    log::error!("Failed to generate thumbnail: {}", e);
                    None
                }
            };

            (copied_path, thumb_path)
        } else {
            (None, None)
        }
    } else {
        (image_path, None)
    };

    // For hash computation, use detected_url (trimmed) for URL content to ensure consistent dedup
    let hash_data = if let Some(ref path) = final_image_path {
        let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        format!("img:{}:{}", path, file_size)
    } else if let Some(ref url) = detected_url {
        url.clone()
    } else {
        raw_text.as_deref().unwrap_or("").to_string()
    };
    let content_hash = compute_hash(hash_data.as_bytes());

    let byte_size = if let Some(ref path) = final_image_path {
        std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0)
    } else {
        raw_text.as_ref().map(|t| t.len() as i64).unwrap_or(0)
    };

    // For URL content, use the clean detected URL (trimmed) as source_url
    let source_url = detected_url.clone();

    // Check for duplicate content using content_hash before saving
    let repo = crate::storage::repository::Repository::new(db.clone());
    if repo
        .content_exists_by_hash(&content_hash)
        .unwrap_or(false)
    {
        log::info!(
            "Duplicate content detected (hash={}), skipping save",
            &content_hash[..16]
        );
        return Err("Duplicate content".to_string());
    }

    let content = CapturedContent {
        id: id.clone(),
        content_type,
        raw_text,
        image_path: final_image_path,
        thumbnail_path,
        source_app: event.source_app,
        source_bundle_id: None,
        source_url,
        user_note: None,
        captured_at: now.clone(),
        content_hash,
        byte_size,
        is_deleted: false,
        created_at: now.clone(),
        updated_at: now,
    };

    repo.save_content(&content).map_err(|e| e.to_string())?;

    log::info!(
        "Content auto-saved: {} (type={}, size={} bytes)",
        id,
        content.content_type.as_str(),
        content.byte_size
    );

    // Trigger auto-sync: export today's markdown if enabled
    {
        let db_clone = db.clone();
        let captured_date = content.captured_at[..10].to_string(); // "YYYY-MM-DD"
        std::thread::spawn(move || {
            let repo = crate::storage::repository::Repository::new(db_clone);
            // Check if auto-sync is enabled
            let enabled = repo.get_setting("datahub_export_enabled")
                .ok().flatten().unwrap_or_default() == "true";
            let auto_sync = repo.get_setting("datahub_auto_sync")
                .ok().flatten().unwrap_or_else(|| "true".to_string()) == "true";
            if enabled && auto_sync {
                let export_dir = repo.get_setting("datahub_export_dir")
                    .ok().flatten()
                    .unwrap_or_else(|| {
                        dirs::document_dir()
                            .unwrap_or_else(|| std::path::PathBuf::from("~/Documents"))
                            .join("Xiaoyun")
                            .to_string_lossy()
                            .to_string()
                    });
                let export_path = std::path::Path::new(&export_dir);
                match crate::export::markdown::export_day(&captured_date, &repo, export_path) {
                    Ok(p) => log::info!("Auto-synced markdown: {}", p.display()),
                    Err(e) => log::error!("Auto-sync failed: {}", e),
                }
            }
        });
    }

    Ok(content)
}

#[tauri::command]
pub fn save_captured_content(
    state: State<'_, AppState>,
    event: CaptureEvent,
) -> Result<CapturedContent, String> {
    save_content_auto(&state.db, event)
}

/// Save content from the Spotlight window with a user note.
/// Called when user presses Enter in the Spotlight input.
///
/// Handles the race condition where the clipboard watcher may have already
/// saved the same content. In that case, we find the existing record and
/// just attach the user_note to it.
#[tauri::command]
pub fn save_spotlight_content(
    state: State<'_, AppState>,
    content_type: String,
    raw_text: Option<String>,
    image_path: Option<String>,
    source_app: String,
    user_note: String,
) -> Result<CapturedContent, String> {
    let repo = crate::storage::repository::Repository::new(state.db.clone());

    let event = CaptureEvent {
        content_type,
        preview: raw_text
            .as_deref()
            .map(|t| t.chars().take(100).collect::<String>())
            .unwrap_or_default(),
        source_app,
        raw_text,
        image_path,
    };

    // Try saving — if duplicate, find the existing record instead
    let mut content = match save_content_auto(&state.db, event) {
        Ok(c) => c,
        Err(e) if e.contains("Duplicate content") => {
            // The clipboard watcher already saved this content.
            // Recompute the hash to find it.
            find_existing_content(&state.db)
                .ok_or_else(|| "Content was deduplicated but could not be found".to_string())?
        }
        Err(e) => return Err(e),
    };

    // Attach user_note if provided
    let note = if user_note.trim().is_empty() {
        None
    } else {
        Some(user_note.trim().to_string())
    };

    if let Some(ref note_text) = note {
        repo.update_user_note(&content.id, note_text)
            .map_err(|e| format!("Failed to save user note: {}", e))?;
        content.user_note = Some(note_text.clone());
    }

    Ok(content)
}

/// Find the most recently captured content item (used as fallback when
/// spotlight save hits a duplicate from the clipboard watcher).
fn find_existing_content(db: &Arc<Database>) -> Option<CapturedContent> {
    let repo = crate::storage::repository::Repository::new(db.clone());
    // Get the most recent item — it's almost certainly the one just auto-saved
    repo.get_all_content(1, 0)
        .ok()
        .and_then(|v| v.into_iter().next())
}

/// Called by the floating bubble when user confirms saving the captured content.
/// Receives the same JSON data that was originally sent as `capture:pending`.
#[tauri::command]
pub fn confirm_capture(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    content_type: String,
    preview: String,
    source_app: String,
    raw_text: Option<String>,
    image_path: Option<String>,
    user_note: Option<String>,
) -> Result<CapturedContent, String> {
    // NOTE: Do NOT close the bubble window here.
    // The frontend shows a green checkmark animation for 1.5s before closing itself.

    let event = CaptureEvent {
        content_type,
        preview,
        source_app,
        raw_text,
        image_path,
    };
    let mut content = save_content_auto(&state.db, event)?;

    // Attach user note if provided
    if let Some(ref note) = user_note {
        let note = note.trim();
        if !note.is_empty() {
            let repo = crate::storage::repository::Repository::new(state.db.clone());
            if let Err(e) = repo.update_user_note(&content.id, note) {
                log::error!("Failed to save user note: {}", e);
            } else {
                content.user_note = Some(note.to_string());
                log::info!("User note saved for {}: {}", content.id, note);
            }
        }
    }

    // Auto-OCR for image content
    spawn_auto_ocr(&app, &state.db, &content);

    // Auto-fetch for URL content
    spawn_auto_url_fetch(&app, &state.db, &content);

    Ok(content)
}

/// Called by the bubble window to retrieve the latest pending capture.
/// Returns the pending data and clears it from state.
#[tauri::command]
pub fn get_pending_capture(
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    let data = state.pending_capture.lock()
        .map_err(|e| format!("Lock error: {}", e))?
        .take();
    Ok(data)
}

/// Called by the floating bubble when countdown expires (user didn't confirm).
/// Cleans up temporary image file if one was created.
#[tauri::command]
pub fn dismiss_capture(app: tauri::AppHandle, image_path: Option<String>) -> Result<(), String> {
    // Hide bubble window from Rust side (backup)
    hide_bubble_window(&app);

    if let Some(ref path) = image_path {
        let p = std::path::Path::new(path);
        if p.exists() {
            if let Err(e) = std::fs::remove_file(p) {
                log::warn!("Failed to cleanup temp image {}: {}", path, e);
            } else {
                log::info!("Cleaned up dismissed capture image: {}", path);
            }
        }
    }
    Ok(())
}

/// Retry fetching URL content for a given content ID.
/// Called from frontend when a URL read has failed.
#[tauri::command]
pub async fn retry_url_fetch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    content_id: String,
) -> Result<(), String> {
    let db = state.db.clone();
    let repo = crate::storage::repository::Repository::new(db.clone());

    // Find the content record and get its source_url
    let content = repo.get_all_content(500, 0)
        .map_err(|e| format!("DB error: {}", e))?
        .into_iter()
        .find(|c| c.id == content_id)
        .ok_or_else(|| "Content not found".to_string())?;

    let url = content.source_url
        .ok_or_else(|| "No source URL for this content".to_string())?;

    log::info!("Retrying URL fetch for {} (url={})", content_id, url);

    // Spawn async fetch task
    tauri::async_runtime::spawn(async move {
        let reader = crate::capture::url_reader::UrlReader::new();
        match reader.fetch_content(&url).await {
            Ok(result) => {
                let repo = crate::storage::repository::Repository::new(db);
                if let Err(e) = repo.update_content_for_url(&content_id, &result.content, &url) {
                    log::error!("Failed to update URL content on retry: {}", e);
                } else {
                    log::info!("URL retry succeeded for {}: {} chars", content_id, result.content.len());
                    let _ = app.emit(
                        "content:url-fetched",
                        serde_json::json!({
                            "id": content_id,
                            "title": result.title,
                            "content_length": result.content.len(),
                        }),
                    );
                }
            }
            Err(e) => {
                log::error!("URL retry failed for {}: {}", content_id, e);
                let repo = crate::storage::repository::Repository::new(db);
                let fail_msg = format!("[读取失败] {}\n\n原始链接: {}", e, url);
                let _ = repo.update_content_for_url(&content_id, &fail_msg, &url);
                let _ = app.emit(
                    "content:url-fetched",
                    serde_json::json!({ "id": content_id, "failed": true }),
                );
            }
        }
    });

    Ok(())
}

/// Run OCR on an image content item using macOS Vision framework.
/// Saves the recognized text to raw_text and returns it.
#[tauri::command]
pub async fn ocr_image(
    state: State<'_, AppState>,
    content_id: String,
) -> Result<String, String> {
    let db = state.db.clone();
    let repo = crate::storage::repository::Repository::new(db.clone());

    // Find the content record
    let content = repo.get_all_content(500, 0)
        .map_err(|e| format!("DB error: {}", e))?
        .into_iter()
        .find(|c| c.id == content_id)
        .ok_or_else(|| "Content not found".to_string())?;

    let image_path = content.image_path
        .ok_or_else(|| "No image path for this content".to_string())?;

    log::info!("[OCR] Starting OCR for {} (path={})", content_id, image_path);

    // Run OCR in a blocking thread (Swift process is synchronous)
    let path_clone = image_path.clone();
    let text = tokio::task::spawn_blocking(move || {
        crate::capture::ocr::recognize_text(&path_clone)
    })
    .await
    .map_err(|e| format!("OCR task error: {}", e))?
    .map_err(|e| format!("OCR failed: {}", e))?;

    // Save OCR text to database
    repo.update_raw_text(&content_id, &text)
        .map_err(|e| format!("Failed to save OCR text: {}", e))?;

    log::info!("[OCR] Saved {} chars for {}", text.len(), content_id);
    Ok(text)
}

/// Spawn auto-OCR for image content in the background.
fn spawn_auto_ocr(
    app: &tauri::AppHandle,
    db: &Arc<Database>,
    content: &CapturedContent,
) {
    if content.content_type.as_str() != "image" {
        return;
    }
    // Skip if already has text (OCR already done)
    if content.raw_text.as_ref().map(|t| !t.is_empty()).unwrap_or(false) {
        return;
    }
    let image_path = match &content.image_path {
        Some(p) => p.clone(),
        None => return,
    };

    let content_id = content.id.clone();
    let db_clone = db.clone();
    let app_clone = app.clone();

    tauri::async_runtime::spawn(async move {
        log::info!("[OCR] Auto-OCR starting for {}", content_id);
        match tokio::task::spawn_blocking({
            let path = image_path.clone();
            move || crate::capture::ocr::recognize_text(&path)
        })
        .await
        {
            Ok(Ok(text)) => {
                let repo = crate::storage::repository::Repository::new(db_clone);
                if let Err(e) = repo.update_raw_text(&content_id, &text) {
                    log::error!("[OCR] Failed to save: {}", e);
                } else {
                    log::info!("[OCR] Auto-OCR done for {}: {} chars", content_id, text.len());
                    let _ = app_clone.emit(
                        "content:ocr-done",
                        serde_json::json!({
                            "id": content_id,
                            "text_length": text.len(),
                        }),
                    );
                }
            }
            Ok(Err(e)) => {
                log::info!("[OCR] No text found in {}: {}", content_id, e);
            }
            Err(e) => {
                log::error!("[OCR] Task failed for {}: {}", content_id, e);
            }
        }
    });
}

/// Spawn auto URL fetch for URL content in the background.
fn spawn_auto_url_fetch(
    app: &tauri::AppHandle,
    db: &Arc<Database>,
    content: &CapturedContent,
) {
    if content.content_type.as_str() != "url" {
        return;
    }
    let url = match &content.source_url {
        Some(u) => u.clone(),
        None => return,
    };
    // Skip if already fetched
    let needs_fetch = content
        .raw_text
        .as_ref()
        .map(|text| text.is_empty() || text.as_str() == url)
        .unwrap_or(true);
    if !needs_fetch {
        return;
    }

    let content_id = content.id.clone();
    let db_clone = db.clone();
    let app_clone = app.clone();

    log::info!("Spawning URL fetch for {} (url={})", content_id, url);
    tauri::async_runtime::spawn(async move {
        let reader = crate::capture::url_reader::UrlReader::new();
        match reader.fetch_content(&url).await {
            Ok(result) => {
                let repo = crate::storage::repository::Repository::new(db_clone);
                if let Err(e) = repo.update_content_for_url(&content_id, &result.content, &url) {
                    log::error!("Failed to update URL content: {}", e);
                } else {
                    log::info!("URL fetched for {}: {} chars", content_id, result.content.len());
                    let _ = app_clone.emit(
                        "content:url-fetched",
                        serde_json::json!({
                            "id": content_id,
                            "title": result.title,
                            "content_length": result.content.len(),
                        }),
                    );
                }
            }
            Err(e) => {
                log::error!("URL fetch failed for {}: {}", content_id, e);
                let repo = crate::storage::repository::Repository::new(db_clone);
                let fail_msg = format!("[读取失败] {}\n\n原始链接: {}", e, url);
                let _ = repo.update_content_for_url(&content_id, &fail_msg, &url);
                let _ = app_clone.emit(
                    "content:url-fetched",
                    serde_json::json!({ "id": content_id, "failed": true }),
                );
            }
        }
    });
}

/// Close (destroy) the bubble window completely.
fn hide_bubble_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("bubble") {
        let _ = win.close();
        log::info!("Bubble window closed/destroyed");
    }
}

/// Debug logging command — writes to a local file so we can see what happens at runtime.
#[tauri::command]
pub fn debug_log(message: String) {
    let path = std::env::temp_dir().join("xiaoyun_debug.log");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let now = chrono::Local::now().format("%H:%M:%S%.3f");
        let _ = writeln!(f, "[{}] {}", now, message);
    }
    log::info!("[BUBBLE_DEBUG] {}", message);
}
