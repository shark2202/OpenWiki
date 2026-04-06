use crate::commands::capture::AppState;
use crate::storage::models::CapturedContent;
use crate::storage::repository::Repository;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct DigestResponse {
    pub items: Vec<CapturedContent>,
    pub remaining: i64,
}

#[tauri::command]
pub async fn get_digest_items(state: State<'_, AppState>) -> Result<DigestResponse, String> {
    let repo = Repository::new(state.db.clone());
    // Get undigested content from the last 7 days
    let items = repo
        .get_undigested_content_recent(7)
        .map_err(|e| e.to_string())?;
    let remaining = repo.count_undigested().map_err(|e| e.to_string())?;
    Ok(DigestResponse { items, remaining })
}

#[tauri::command]
pub async fn digest_item(
    id: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Validate action
    match action.as_str() {
        "keep" | "archive" | "pin" => {}
        _ => {
            return Err(format!(
                "Invalid digest action: {}. Must be keep, archive, or pin.",
                action
            ))
        }
    }
    let repo = Repository::new(state.db.clone());
    repo.update_digest_action(&id, &action)
        .map_err(|e| e.to_string())
}
