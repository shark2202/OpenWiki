// Background scheduler for auto-generating the attention/insight report.
//
// Behaviour (confirmed with the user):
//   - First report: auto-generate once the user has accumulated
//     FIRST_TRIGGER_MIN_ITEMS saved items.
//   - After that: refresh at most once every RECURRING_INTERVAL_DAYS, and only
//     when there is new content since the last report — so we never spend API
//     credits re-analysing unchanged data.
//
// The heavy lifting reuses `attention::run_attention_analysis`, the exact same
// routine the manual "生成/刷新报告" button calls.

use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

use crate::storage::database::Database;
use crate::storage::repository::Repository;

/// Minimum saved items before the first report is auto-generated.
const FIRST_TRIGGER_MIN_ITEMS: i64 = 15;
/// Minimum days between two auto-generated reports.
const RECURRING_INTERVAL_DAYS: i64 = 7;
/// How often the scheduler re-checks the trigger conditions.
const CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;
/// Delay before the first check, so startup isn't competing for resources.
const STARTUP_DELAY_SECS: u64 = 90;

/// Inputs to the auto-trigger decision, gathered from the DB. Kept separate
/// from the DB access so the decision logic below can be unit-tested.
pub struct AutoTriggerInputs {
    pub ai_configured: bool,
    pub is_analyzing: bool,
    pub has_report: bool,
    pub total_items: i64,
    pub days_since_report: i64,
    pub has_new_content: bool,
}

/// Decide whether the background scheduler should start an analysis now.
pub fn should_auto_trigger(inp: &AutoTriggerInputs) -> bool {
    // Never run without a configured AI provider, and never stack on top of an
    // in-flight analysis.
    if !inp.ai_configured || inp.is_analyzing {
        return false;
    }
    if !inp.has_report {
        // First-ever report: wait until enough content has accumulated.
        return inp.total_items >= FIRST_TRIGGER_MIN_ITEMS;
    }
    // Recurring: weekly cadence, but only when there's something new to analyse.
    inp.days_since_report >= RECURRING_INTERVAL_DAYS && inp.has_new_content
}

/// True when an AI provider is usable (API key, OAuth, or a local model).
/// Mirrors the check used by the manual trigger / radar status.
fn ai_configured(repo: &Repository) -> bool {
    let provider = repo
        .get_setting("ai_provider")
        .ok()
        .flatten()
        .unwrap_or_else(|| "anthropic".to_string());
    let key = repo
        .get_setting(&format!("ai_api_key_{}", provider))
        .ok()
        .flatten()
        .or_else(|| repo.get_setting("ai_api_key").ok().flatten())
        .unwrap_or_default();
    if !key.is_empty() {
        return true;
    }
    matches!(
        provider.as_str(),
        "openai" | "google" | "ollama" | "custom" | "lmstudio"
    )
}

fn gather_inputs(repo: &Repository) -> AutoTriggerInputs {
    let insight = repo.get_current_insight().ok().flatten();
    let is_analyzing = insight
        .as_ref()
        .map(|i| i.status == "analyzing")
        .unwrap_or(false);
    let has_report = insight
        .as_ref()
        .map(|i| i.status == "complete")
        .unwrap_or(false);

    let (days_since_report, has_new_content) = match insight.as_ref() {
        Some(i) if i.status == "complete" => {
            let analyzed = chrono::DateTime::parse_from_rfc3339(&i.analyzed_at)
                .map(|t| t.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::Utc::now());
            let days = (chrono::Utc::now() - analyzed).num_days();
            let has_new = repo.has_new_content_since(&i.analyzed_at).unwrap_or(false);
            (days, has_new)
        }
        _ => (0, false),
    };

    AutoTriggerInputs {
        ai_configured: ai_configured(repo),
        is_analyzing,
        has_report,
        total_items: repo.count_content().unwrap_or(0),
        days_since_report,
        has_new_content,
    }
}

/// Spawn the background insight scheduler. Runs for the lifetime of the app,
/// re-checking every CHECK_INTERVAL_SECS. All failures are logged, never
/// surfaced to the user.
pub fn spawn_insight_scheduler(app: AppHandle, db: Arc<Database>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;
        loop {
            let should_run = {
                let repo = Repository::new(db.clone());
                should_auto_trigger(&gather_inputs(&repo))
            };
            if should_run {
                log::info!("[insight-scheduler] conditions met — auto-generating report");
                if let Err(e) =
                    crate::commands::attention::run_attention_analysis(app.clone(), db.clone())
                        .await
                {
                    log::warn!("[insight-scheduler] auto analysis failed: {}", e);
                }
            }
            tokio::time::sleep(Duration::from_secs(CHECK_INTERVAL_SECS)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> AutoTriggerInputs {
        AutoTriggerInputs {
            ai_configured: true,
            is_analyzing: false,
            has_report: false,
            total_items: 0,
            days_since_report: 0,
            has_new_content: false,
        }
    }

    #[test]
    fn no_trigger_without_ai() {
        let mut i = base();
        i.ai_configured = false;
        i.total_items = 100;
        assert!(!should_auto_trigger(&i));
    }

    #[test]
    fn no_trigger_while_analyzing() {
        let mut i = base();
        i.is_analyzing = true;
        i.total_items = 100;
        assert!(!should_auto_trigger(&i));
    }

    #[test]
    fn first_report_triggers_at_threshold() {
        let mut i = base();
        i.total_items = FIRST_TRIGGER_MIN_ITEMS;
        assert!(should_auto_trigger(&i));
    }

    #[test]
    fn first_report_waits_below_threshold() {
        let mut i = base();
        i.total_items = FIRST_TRIGGER_MIN_ITEMS - 1;
        assert!(!should_auto_trigger(&i));
    }

    #[test]
    fn recurring_triggers_after_a_week_with_new_content() {
        let mut i = base();
        i.has_report = true;
        i.total_items = 100;
        i.days_since_report = RECURRING_INTERVAL_DAYS;
        i.has_new_content = true;
        assert!(should_auto_trigger(&i));
    }

    #[test]
    fn recurring_skips_when_no_new_content() {
        let mut i = base();
        i.has_report = true;
        i.days_since_report = 30;
        i.has_new_content = false;
        assert!(!should_auto_trigger(&i));
    }

    #[test]
    fn recurring_waits_within_the_week() {
        let mut i = base();
        i.has_report = true;
        i.days_since_report = RECURRING_INTERVAL_DAYS - 1;
        i.has_new_content = true;
        assert!(!should_auto_trigger(&i));
    }
}
