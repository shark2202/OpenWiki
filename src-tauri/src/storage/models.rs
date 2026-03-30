use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentType {
    Text,
    Image,
    Url,
    Mixed,
}

impl ContentType {
    pub fn as_str(&self) -> &str {
        match self {
            ContentType::Text => "text",
            ContentType::Image => "image",
            ContentType::Url => "url",
            ContentType::Mixed => "mixed",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "image" => ContentType::Image,
            "url" => ContentType::Url,
            "mixed" => ContentType::Mixed,
            _ => ContentType::Text,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedContent {
    pub id: String,
    pub content_type: ContentType,
    pub raw_text: Option<String>,
    pub image_path: Option<String>,
    pub thumbnail_path: Option<String>,
    pub source_app: String,
    pub source_bundle_id: Option<String>,
    pub source_url: Option<String>,
    pub user_note: Option<String>,
    pub captured_at: String,
    pub content_hash: String,
    pub byte_size: i64,
    pub is_deleted: bool,
    pub created_at: String,
    pub updated_at: String,
    pub digested_at: Option<String>,
    pub digest_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeeklyReport {
    pub id: String,
    pub week_start: String,
    pub week_end: String,
    pub summary_text: String,
    pub report_json: serde_json::Value,
    pub content_count: i32,
    pub model_used: String,
    pub tokens_used: Option<i32>,
    pub generated_at: String,
    pub sections: Vec<ReportSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportSection {
    pub id: String,
    pub report_id: String,
    pub section_type: String,
    pub title: String,
    pub body: String,
    pub relevance_score: Option<f64>,
    pub sort_order: i32,
    pub content_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedbackType {
    Interested,
    Dismissed,
    Bookmarked,
}

impl FeedbackType {
    pub fn as_str(&self) -> &str {
        match self {
            FeedbackType::Interested => "interested",
            FeedbackType::Dismissed => "dismissed",
            FeedbackType::Bookmarked => "bookmarked",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "dismissed" => FeedbackType::Dismissed,
            "bookmarked" => FeedbackType::Bookmarked,
            _ => FeedbackType::Interested,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserFeedback {
    pub id: String,
    pub content_id: Option<String>,
    pub section_id: Option<String>,
    pub feedback_type: FeedbackType,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreference {
    pub id: String,
    pub topic: String,
    pub weight: f64,
    pub occurrence_count: i32,
    pub last_updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureEvent {
    pub content_type: String,
    pub preview: String,
    pub source_app: String,
    pub raw_text: Option<String>,
    pub image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttentionInsight {
    pub id: i64,
    pub analysis_json: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub analyzed_at: String,
    pub window_start: String,
    pub window_end: String,
    pub content_count: i32,
    pub model_used: String,
    pub is_current: bool,
}
