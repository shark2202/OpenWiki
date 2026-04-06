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
pub fn save_content_auto(
    db: &Arc<Database>,
    event: CaptureEvent,
) -> Result<CapturedContent, String> {
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

    // Check for duplicate content — if found, move it to the top by updating captured_at
    let repo = crate::storage::repository::Repository::new(db.clone());
    if let Ok(Some(existing)) = repo.find_content_by_hash(&content_hash) {
        let _ = repo.touch_captured_at(&existing.id);
        log::info!(
            "Duplicate content detected (hash={}), moved to top: {}",
            &content_hash[..16],
            existing.id
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
        digested_at: None,
        digest_action: None,
        summary: None,
        tags: None,
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
            let enabled = repo
                .get_setting("datahub_export_enabled")
                .ok()
                .flatten()
                .unwrap_or_default()
                == "true";
            let auto_sync = repo
                .get_setting("datahub_auto_sync")
                .ok()
                .flatten()
                .unwrap_or_else(|| "true".to_string())
                == "true";
            if enabled && auto_sync {
                let export_dir = repo
                    .get_setting("datahub_export_dir")
                    .ok()
                    .flatten()
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
    let mut content = match save_content_auto(&state.db, event) {
        Ok(c) => c,
        Err(e) if e.contains("Duplicate content") => {
            // Content was moved to top, emit refresh event
            let _ = app.emit(
                "content:url-fetched",
                serde_json::json!({"id": "", "reorder": true}),
            );
            return Err("已移到最前面".to_string());
        }
        Err(e) => return Err(e),
    };

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

    // AI summary for text content (images get it after OCR, URLs after fetch)
    if content.content_type.as_str() == "text" {
        if let Some(ref text) = content.raw_text {
            spawn_summary_task(
                state.db.clone(),
                app.clone(),
                content.id.clone(),
                text.clone(),
            );
        }
    }

    Ok(content)
}

/// Get multiple content items by their IDs. Used by radar detail view.
#[tauri::command]
pub fn get_contents_by_ids(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Vec<CapturedContent>, String> {
    let repo = crate::storage::repository::Repository::new(state.db.clone());
    let mut results = Vec::new();
    for id in &ids {
        match repo.get_content_by_id(id) {
            Ok(Some(content)) => results.push(content),
            Ok(None) => {} // skip missing
            Err(e) => log::warn!("Failed to get content {}: {}", id, e),
        }
    }
    Ok(results)
}

/// Called by the bubble window to retrieve the latest pending capture.
/// Returns the pending data and clears it from state.
#[tauri::command]
pub fn get_pending_capture(
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    let data = state
        .pending_capture
        .lock()
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
    let content = repo
        .get_all_content(500, 0)
        .map_err(|e| format!("DB error: {}", e))?
        .into_iter()
        .find(|c| c.id == content_id)
        .ok_or_else(|| "Content not found".to_string())?;

    let url = content
        .source_url
        .ok_or_else(|| "No source URL for this content".to_string())?;

    log::info!("Retrying URL fetch for {} (url={})", content_id, url);

    // Spawn async fetch task
    tauri::async_runtime::spawn(async move {
        let reader = crate::capture::url_reader::UrlReader::new();
        match reader.fetch_content(&url).await {
            Ok(result) => {
                let db_for_summary = db.clone();
                let repo = crate::storage::repository::Repository::new(db);
                if let Err(e) = repo.update_content_for_url(&content_id, &result.content, &url) {
                    log::error!("Failed to update URL content on retry: {}", e);
                } else {
                    log::info!(
                        "URL retry succeeded for {}: {} chars",
                        content_id,
                        result.content.len()
                    );
                    spawn_summary_task(
                        db_for_summary,
                        app.clone(),
                        content_id.clone(),
                        result.content.clone(),
                    );
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
pub async fn ocr_image(state: State<'_, AppState>, content_id: String) -> Result<String, String> {
    let db = state.db.clone();
    let repo = crate::storage::repository::Repository::new(db.clone());

    // Find the content record
    let content = repo
        .get_all_content(500, 0)
        .map_err(|e| format!("DB error: {}", e))?
        .into_iter()
        .find(|c| c.id == content_id)
        .ok_or_else(|| "Content not found".to_string())?;

    let image_path = content
        .image_path
        .ok_or_else(|| "No image path for this content".to_string())?;

    log::info!(
        "[OCR] Starting OCR for {} (path={})",
        content_id,
        image_path
    );

    // Run OCR in a blocking thread (Swift process is synchronous)
    let path_clone = image_path.clone();
    let text =
        tokio::task::spawn_blocking(move || crate::capture::ocr::recognize_text(&path_clone))
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
fn spawn_auto_ocr(app: &tauri::AppHandle, db: &Arc<Database>, content: &CapturedContent) {
    if content.content_type.as_str() != "image" {
        return;
    }
    // Skip if already has text (OCR already done)
    if content
        .raw_text
        .as_ref()
        .map(|t| !t.is_empty())
        .unwrap_or(false)
    {
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
                let db_for_summary = db_clone.clone();
                let repo = crate::storage::repository::Repository::new(db_clone);
                if let Err(e) = repo.update_raw_text(&content_id, &text) {
                    log::error!("[OCR] Failed to save: {}", e);
                } else {
                    log::info!(
                        "[OCR] Auto-OCR done for {}: {} chars",
                        content_id,
                        text.len()
                    );
                    spawn_summary_task(
                        db_for_summary,
                        app_clone.clone(),
                        content_id.clone(),
                        text.clone(),
                    );
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
fn spawn_auto_url_fetch(app: &tauri::AppHandle, db: &Arc<Database>, content: &CapturedContent) {
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
                let db_for_summary = db_clone.clone();
                let repo = crate::storage::repository::Repository::new(db_clone);
                if let Err(e) = repo.update_content_for_url(&content_id, &result.content, &url) {
                    log::error!("Failed to update URL content: {}", e);
                } else {
                    log::info!(
                        "URL fetched for {}: {} chars",
                        content_id,
                        result.content.len()
                    );
                    spawn_summary_task(
                        db_for_summary,
                        app_clone.clone(),
                        content_id.clone(),
                        result.content.clone(),
                    );
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

/// Spawn an async task to generate an AI summary for a content item.
/// Silently skips if no API key configured or text too short.
pub fn spawn_summary_task(
    db: Arc<Database>,
    app: tauri::AppHandle,
    content_id: String,
    text: String,
) {
    // At least 2 Chinese characters (~6 bytes) to be worth summarizing
    if text.trim().len() < 6 {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let repo = crate::storage::repository::Repository::new(db.clone());

        let provider_str = repo
            .get_setting("ai_provider")
            .ok()
            .flatten()
            .unwrap_or_else(|| "anthropic".to_string());

        // Load per-provider API key, fall back to legacy key
        let provider_key = format!("ai_api_key_{}", provider_str);
        let api_key = repo
            .get_setting(&provider_key)
            .ok()
            .flatten()
            .or_else(|| repo.get_setting("ai_api_key").ok().flatten())
            .unwrap_or_default();
        if api_key.is_empty() {
            return;
        }
        let model = repo
            .get_setting("ai_model")
            .ok()
            .flatten()
            .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());

        // 发送完整内容给 AI（上限 5000 字，覆盖绝大多数文章）
        let content_for_ai: String = text.chars().take(5000).collect();
        let prompt = format!(
            "通读以下全文，返回JSON格式，包含两个字段：\n\
             1. \"tags\": 2-3个价值点标签，每个标签回答\"这篇内容教了我什么/让我记住了什么\"。\n\
                要求：具体、有信息量、能帮人回忆起这篇内容。\n\
                好的标签：\"逆向思维选股\"、\"冷启动获客策略\"、\"注意力即货币\"\n\
                差的标签：\"投资\"、\"方法论\"、\"AI\"（太泛，没有信息量）\n\
                每个标签3-8个字，用中文简体\n\
             2. \"summary\": 用大白话说这篇内容讲了什么（中文简体，不超过80字）。\n\
                像朋友转发文章时附的一句话，让人一看就知道要不要点开。\n\
                不要用书面语、不要用\"探讨\"\"阐述\"\"倡导\"这类词，就正常说话。\n\
             无论原文是什么语言，都必须用中文简体。只返回JSON。\n\
             示例：{{\"tags\":[\"逆向思维选股\",\"情绪周期套利\",\"长期持有复利\"],\"summary\":\"教你怎么在股市暴跌时抄底，关键是平时得留够现金，不然想抄也没钱\"}}\n\n{}",
            content_for_ai
        );

        let provider = crate::ai::attention_analyzer::AnalysisProvider::from_str(&provider_str);
        match crate::ai::attention_analyzer::call_analysis_api(
            &provider, &api_key, &model, "", &prompt, 512,
        )
        .await
        {
            Ok(raw) => {
                let (summary, tags) = extract_summary_and_tags(&raw);
                if !summary.is_empty() {
                    let tags_str = tags.join(",");
                    let _ = repo.update_summary_and_tags(&content_id, &summary, &tags_str);
                    let _ = app.emit("content-summary-ready", &content_id);
                    log::info!(
                        "Summary generated for {}: [{}] {}",
                        content_id,
                        tags_str,
                        summary
                    );
                }
            }
            Err(e) => {
                log::warn!("Summary generation failed for {}: {}", content_id, e);
            }
        }
    });
}

/// Extract summary and tags from AI response.
/// Expected format: {"tags":["标签1","标签2"],"summary":"摘要文本"}
/// Falls back gracefully for unexpected formats.
fn extract_summary_and_tags(raw: &str) -> (String, Vec<String>) {
    let trimmed = raw.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let summary = v
            .get("summary")
            .and_then(|v| v.as_str())
            .or_else(|| v.get("text").and_then(|v| v.as_str()))
            .or_else(|| v.get("content").and_then(|v| v.as_str()))
            .unwrap_or("")
            .trim()
            .to_string();

        let tags = v
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if !summary.is_empty() {
            return (summary, tags);
        }

        // Fallback: single string value in object
        if let Some(obj) = v.as_object() {
            if obj.len() == 1 {
                if let Some(s) = obj.values().next().and_then(|v| v.as_str()) {
                    return (s.trim().to_string(), vec![]);
                }
            }
        }
        // Array fallback
        if let Some(arr) = v.as_array() {
            if let Some(s) = arr.first().and_then(|v| v.as_str()) {
                return (s.trim().to_string(), vec![]);
            }
        }
        // Plain string in JSON
        if let Some(s) = v.as_str() {
            return (s.trim().to_string(), vec![]);
        }
    }
    // Not JSON — treat as plain text summary
    let stripped = trimmed
        .trim_matches('"')
        .trim_matches('「')
        .trim_matches('」');
    (stripped.trim().to_string(), vec![])
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
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let now = chrono::Local::now().format("%H:%M:%S%.3f");
        let _ = writeln!(f, "[{}] {}", now, message);
    }
    log::info!("[BUBBLE_DEBUG] {}", message);
}

/// Test AI API connection with the given provider, model, and key.
/// Returns Ok(model_response) on success, Err(error_message) on failure.
#[tauri::command]
pub async fn test_ai_connection(
    provider: String,
    model: String,
    api_key: String,
) -> Result<String, String> {
    let p = crate::ai::attention_analyzer::AnalysisProvider::from_str(&provider);
    crate::ai::attention_analyzer::call_analysis_api(
        &p,
        &api_key,
        &model,
        "",
        "回复\"连接成功\"这四个字，不要说其他内容。",
        64,
    )
    .await
}
