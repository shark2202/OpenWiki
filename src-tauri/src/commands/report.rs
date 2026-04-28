use crate::ai::preference_engine;
use crate::ai::report_generator;
use crate::commands::capture::AppState;
use crate::storage::models::{FeedbackType, UserFeedback, WeeklyReport};
use crate::storage::repository::Repository;
use chrono::Utc;
use tauri::State;

/// Trigger AI weekly report generation.
/// The report generator resolves provider, model, API key, and OAuth state.
#[tauri::command]
pub async fn generate_report(state: State<'_, AppState>) -> Result<WeeklyReport, String> {
    let db = state.db.clone();

    log::info!("Generating weekly report");

    // Generate the report (async). Provider/model/key/OAuth resolution lives in
    // the generator so weekly reports follow the same AI path as summaries/wiki.
    let report = report_generator::generate_weekly_report(db).await?;

    Ok(report)
}

/// Fetch a previously generated report by its week_start date (YYYY-MM-DD).
#[tauri::command]
pub fn get_report(
    state: State<'_, AppState>,
    week_start: String,
) -> Result<Option<WeeklyReport>, String> {
    let repo = Repository::new(state.db.clone());
    repo.get_report_by_week(&week_start)
        .map_err(|e| format!("Failed to get weekly report: {}", e))
}

/// List all generated reports (metadata only: id, week_start, week_end, summary).
#[tauri::command]
pub fn get_all_reports(state: State<'_, AppState>) -> Result<Vec<WeeklyReport>, String> {
    let repo = Repository::new(state.db.clone());
    repo.get_all_reports()
        .map_err(|e| format!("Failed to get weekly report list: {}", e))
}

/// Submit user feedback (interested / dismissed / bookmarked) for a content or section.
/// If the feedback is "interested" or "bookmarked", also update user preferences.
#[tauri::command]
pub fn submit_feedback(
    state: State<'_, AppState>,
    content_id: Option<String>,
    section_id: Option<String>,
    feedback_type: String,
) -> Result<(), String> {
    let db = state.db.clone();
    let repo = Repository::new(db.clone());

    let feedback = UserFeedback {
        id: uuid::Uuid::new_v4().to_string(),
        content_id: content_id.clone(),
        section_id,
        feedback_type: FeedbackType::from_str(&feedback_type),
        created_at: Utc::now().to_rfc3339(),
    };

    repo.save_feedback(&feedback)
        .map_err(|e| format!("Failed to save feedback: {}", e))?;

    log::info!("User feedback saved: type={}", feedback_type);

    // If the user marked content as interested/bookmarked, update preferences
    if let Some(cid) = content_id {
        if feedback_type == "interested"
            || feedback_type == "bookmarked"
            || feedback_type == "dismissed"
        {
            if let Err(e) = preference_engine::update_preferences(db, &cid, &feedback_type) {
                log::error!("Failed to update user preferences: {}", e);
                // Don't fail the whole command for preference update errors
            }
        }
    }

    Ok(())
}
