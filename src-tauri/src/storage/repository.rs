use super::database::Database;
use super::models::{
    AttentionInsight, CapturedContent, ContentType, ReportSection, UserFeedback, UserPreference, WeeklyReport,
};
use rusqlite::params;
use std::sync::Arc;

pub struct Repository {
    db: Arc<Database>,
}

impl Repository {
    pub fn new(db: Arc<Database>) -> Self {
        Repository { db }
    }

    // ========== Captured Content ==========

    pub fn save_content(
        &self,
        content: &CapturedContent,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "INSERT INTO captured_content (id, content_type, raw_text, image_path, thumbnail_path, source_app, source_bundle_id, source_url, user_note, captured_at, content_hash, byte_size)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                content.id,
                content.content_type.as_str(),
                content.raw_text,
                content.image_path,
                content.thumbnail_path,
                content.source_app,
                content.source_bundle_id,
                content.source_url,
                content.user_note,
                content.captured_at,
                content.content_hash,
                content.byte_size,
            ],
        )?;
        Ok(())
    }

    pub fn get_all_content(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<CapturedContent>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, content_type, raw_text, image_path, thumbnail_path, source_app, source_bundle_id, source_url, user_note, captured_at, content_hash, byte_size, is_deleted, created_at, updated_at, digested_at, digest_action, summary, tags
             FROM captured_content WHERE is_deleted = 0 ORDER BY captured_at DESC LIMIT ?1 OFFSET ?2"
        )?;

        let rows = stmt.query_map(params![limit, offset], |row| {
            Ok(CapturedContent {
                id: row.get(0)?,
                content_type: ContentType::from_str(&row.get::<_, String>(1)?),
                raw_text: row.get(2)?,
                image_path: row.get(3)?,
                thumbnail_path: row.get(4)?,
                source_app: row.get(5)?,
                source_bundle_id: row.get(6)?,
                source_url: row.get(7)?,
                user_note: row.get(8)?,
                captured_at: row.get(9)?,
                content_hash: row.get(10)?,
                byte_size: row.get(11)?,
                is_deleted: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                digested_at: row.get(15).unwrap_or(None),
                digest_action: row.get(16).unwrap_or(None),
                summary: row.get(17).unwrap_or(None),
                tags: row.get(18).unwrap_or(None),
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Search content by keyword across raw_text, source_url, source_app, and user_note.
    pub fn search_content(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<CapturedContent>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, content_type, raw_text, image_path, thumbnail_path, source_app, source_bundle_id, source_url, user_note, captured_at, content_hash, byte_size, is_deleted, created_at, updated_at, digested_at, digest_action, summary, tags
             FROM captured_content
             WHERE is_deleted = 0
               AND (raw_text LIKE ?1 OR source_url LIKE ?1 OR source_app LIKE ?1 OR user_note LIKE ?1)
             ORDER BY captured_at DESC LIMIT ?2"
        )?;

        let rows = stmt.query_map(params![pattern, limit], |row| {
            Ok(CapturedContent {
                id: row.get(0)?,
                content_type: ContentType::from_str(&row.get::<_, String>(1)?),
                raw_text: row.get(2)?,
                image_path: row.get(3)?,
                thumbnail_path: row.get(4)?,
                source_app: row.get(5)?,
                source_bundle_id: row.get(6)?,
                source_url: row.get(7)?,
                user_note: row.get(8)?,
                captured_at: row.get(9)?,
                content_hash: row.get(10)?,
                byte_size: row.get(11)?,
                is_deleted: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                digested_at: row.get(15).unwrap_or(None),
                digest_action: row.get(16).unwrap_or(None),
                summary: row.get(17).unwrap_or(None),
                tags: row.get(18).unwrap_or(None),
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Update the raw_text and source_url of an existing content item.
    /// Used by the URL reader to fill in fetched article content.
    pub fn update_content_for_url(
        &self,
        id: &str,
        raw_text: &str,
        source_url: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "UPDATE captured_content SET raw_text = ?1, source_url = ?2, byte_size = ?3, updated_at = datetime('now') WHERE id = ?4",
            params![raw_text, source_url, raw_text.len() as i64, id],
        )?;
        Ok(())
    }

    /// Move a content item to the top by updating its captured_at to now.
    pub fn touch_captured_at(
        &self,
        id: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "UPDATE captured_content SET captured_at = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![now, id],
        )?;
        Ok(())
    }

    /// Update the AI-generated summary and tags for a content item.
    pub fn update_summary_and_tags(
        &self,
        id: &str,
        summary: &str,
        tags: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "UPDATE captured_content SET summary = ?1, tags = ?2, updated_at = datetime('now') WHERE id = ?3",
            rusqlite::params![summary, tags, id],
        )?;
        Ok(())
    }

    /// Update the raw_text of an existing content item (e.g. OCR result for images).
    pub fn update_raw_text(
        &self,
        id: &str,
        raw_text: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "UPDATE captured_content SET raw_text = ?1, byte_size = ?2, updated_at = datetime('now') WHERE id = ?3",
            params![raw_text, raw_text.len() as i64, id],
        )?;
        Ok(())
    }

    pub fn delete_content(&self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "UPDATE captured_content SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    /// Update the user_note for an existing content item.
    pub fn update_user_note(
        &self,
        id: &str,
        note: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "UPDATE captured_content SET user_note = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![note, id],
        )?;
        Ok(())
    }

    /// Find an existing content item by its content_hash (for dedup in spotlight).
    pub fn find_content_by_hash(
        &self,
        hash: &str,
    ) -> Result<Option<CapturedContent>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, content_type, raw_text, image_path, thumbnail_path, source_app, source_bundle_id, source_url, user_note, captured_at, content_hash, byte_size, is_deleted, created_at, updated_at, digested_at, digest_action, summary, tags
             FROM captured_content WHERE content_hash = ?1 AND is_deleted = 0 LIMIT 1"
        )?;

        let mut rows = stmt.query_map(params![hash], |row| {
            Ok(CapturedContent {
                id: row.get(0)?,
                content_type: ContentType::from_str(&row.get::<_, String>(1)?),
                raw_text: row.get(2)?,
                image_path: row.get(3)?,
                thumbnail_path: row.get(4)?,
                source_app: row.get(5)?,
                source_bundle_id: row.get(6)?,
                source_url: row.get(7)?,
                user_note: row.get(8)?,
                captured_at: row.get(9)?,
                content_hash: row.get(10)?,
                byte_size: row.get(11)?,
                is_deleted: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                digested_at: row.get(15).unwrap_or(None),
                digest_action: row.get(16).unwrap_or(None),
                summary: row.get(17).unwrap_or(None),
                tags: row.get(18).unwrap_or(None),
            })
        })?;

        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn content_exists_by_hash(&self, hash: &str) -> Result<bool, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM captured_content WHERE content_hash = ?1 AND is_deleted = 0",
            params![hash],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Get all content captured between week_start and week_end (inclusive).
    /// Dates should be in ISO 8601 / RFC 3339 format (e.g. "2025-01-06T00:00:00+00:00").
    pub fn get_content_for_week(
        &self,
        week_start: &str,
        week_end: &str,
    ) -> Result<Vec<CapturedContent>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, content_type, raw_text, image_path, thumbnail_path, source_app, source_bundle_id, source_url, user_note, captured_at, content_hash, byte_size, is_deleted, created_at, updated_at, digested_at, digest_action, summary, tags
             FROM captured_content
             WHERE is_deleted = 0 AND captured_at >= ?1 AND captured_at <= ?2
             ORDER BY captured_at DESC"
        )?;

        let rows = stmt.query_map(params![week_start, week_end], |row| {
            Ok(CapturedContent {
                id: row.get(0)?,
                content_type: ContentType::from_str(&row.get::<_, String>(1)?),
                raw_text: row.get(2)?,
                image_path: row.get(3)?,
                thumbnail_path: row.get(4)?,
                source_app: row.get(5)?,
                source_bundle_id: row.get(6)?,
                source_url: row.get(7)?,
                user_note: row.get(8)?,
                captured_at: row.get(9)?,
                content_hash: row.get(10)?,
                byte_size: row.get(11)?,
                is_deleted: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                digested_at: row.get(15).unwrap_or(None),
                digest_action: row.get(16).unwrap_or(None),
                summary: row.get(17).unwrap_or(None),
                tags: row.get(18).unwrap_or(None),
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Get a single content item by its ID.
    pub fn get_content_by_id(
        &self,
        id: &str,
    ) -> Result<Option<CapturedContent>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, content_type, raw_text, image_path, thumbnail_path, source_app, source_bundle_id, source_url, user_note, captured_at, content_hash, byte_size, is_deleted, created_at, updated_at, digested_at, digest_action, summary, tags
             FROM captured_content WHERE id = ?1 AND is_deleted = 0"
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            Ok(CapturedContent {
                id: row.get(0)?,
                content_type: ContentType::from_str(&row.get::<_, String>(1)?),
                raw_text: row.get(2)?,
                image_path: row.get(3)?,
                thumbnail_path: row.get(4)?,
                source_app: row.get(5)?,
                source_bundle_id: row.get(6)?,
                source_url: row.get(7)?,
                user_note: row.get(8)?,
                captured_at: row.get(9)?,
                content_hash: row.get(10)?,
                byte_size: row.get(11)?,
                is_deleted: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                digested_at: row.get(15).unwrap_or(None),
                digest_action: row.get(16).unwrap_or(None),
                summary: row.get(17).unwrap_or(None),
                tags: row.get(18).unwrap_or(None),
            })
        })?;

        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    // ========== Weekly Reports ==========

    /// Save a complete weekly report with its sections to the database.
    pub fn save_report(&self, report: &WeeklyReport) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        // Insert the report
        conn.execute(
            "INSERT OR REPLACE INTO weekly_reports (id, week_start, week_end, summary_text, report_json, content_count, model_used, tokens_used, generated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                report.id,
                report.week_start,
                report.week_end,
                report.summary_text,
                report.report_json.to_string(),
                report.content_count,
                report.model_used,
                report.tokens_used,
                report.generated_at,
            ],
        )?;

        // Delete old sections for this report (in case of regeneration)
        conn.execute(
            "DELETE FROM report_sections WHERE report_id = ?1",
            params![report.id],
        )?;

        // Insert sections
        for section in &report.sections {
            let content_ids_json = serde_json::to_string(&section.content_ids)
                .unwrap_or_else(|_| "[]".to_string());

            conn.execute(
                "INSERT INTO report_sections (id, report_id, section_type, title, body, relevance_score, sort_order, content_ids)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    section.id,
                    section.report_id,
                    section.section_type,
                    section.title,
                    section.body,
                    section.relevance_score,
                    section.sort_order,
                    content_ids_json,
                ],
            )?;
        }

        Ok(())
    }

    /// Get a weekly report for a specific week_start date.
    pub fn get_report_by_week(
        &self,
        week_start: &str,
    ) -> Result<Option<WeeklyReport>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, week_start, week_end, summary_text, report_json, content_count, model_used, tokens_used, generated_at
             FROM weekly_reports WHERE week_start = ?1"
        )?;

        let mut rows = stmt.query_map(params![week_start], |row| {
            let report_json_str: String = row.get(4)?;
            let report_json: serde_json::Value =
                serde_json::from_str(&report_json_str).unwrap_or(serde_json::Value::Null);

            Ok(WeeklyReport {
                id: row.get(0)?,
                week_start: row.get(1)?,
                week_end: row.get(2)?,
                summary_text: row.get(3)?,
                report_json,
                content_count: row.get(5)?,
                model_used: row.get(6)?,
                tokens_used: row.get(7)?,
                generated_at: row.get(8)?,
                sections: Vec::new(), // filled below
            })
        })?;

        let report = match rows.next() {
            Some(row) => row?,
            None => return Ok(None),
        };

        // Load sections for this report
        let sections = self.get_sections_for_report_inner(&conn, &report.id)?;

        Ok(Some(WeeklyReport {
            sections,
            ..report
        }))
    }

    /// List all weekly reports (without full sections, just metadata).
    pub fn get_all_reports(&self) -> Result<Vec<WeeklyReport>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, week_start, week_end, summary_text, report_json, content_count, model_used, tokens_used, generated_at
             FROM weekly_reports ORDER BY week_start DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            let report_json_str: String = row.get(4)?;
            let report_json: serde_json::Value =
                serde_json::from_str(&report_json_str).unwrap_or(serde_json::Value::Null);

            Ok(WeeklyReport {
                id: row.get(0)?,
                week_start: row.get(1)?,
                week_end: row.get(2)?,
                summary_text: row.get(3)?,
                report_json,
                content_count: row.get(5)?,
                model_used: row.get(6)?,
                tokens_used: row.get(7)?,
                generated_at: row.get(8)?,
                sections: Vec::new(),
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Internal helper: load sections for a report using an already-locked connection.
    fn get_sections_for_report_inner(
        &self,
        conn: &rusqlite::Connection,
        report_id: &str,
    ) -> Result<Vec<ReportSection>, Box<dyn std::error::Error>> {
        let mut stmt = conn.prepare(
            "SELECT id, report_id, section_type, title, body, relevance_score, sort_order, content_ids
             FROM report_sections WHERE report_id = ?1 ORDER BY sort_order"
        )?;

        let rows = stmt.query_map(params![report_id], |row| {
            let content_ids_str: Option<String> = row.get(7)?;
            let content_ids: Vec<String> = content_ids_str
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

            Ok(ReportSection {
                id: row.get(0)?,
                report_id: row.get(1)?,
                section_type: row.get(2)?,
                title: row.get(3)?,
                body: row.get(4)?,
                relevance_score: row.get(5)?,
                sort_order: row.get(6)?,
                content_ids,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    // ========== User Feedback ==========

    /// Save user feedback (interested/dismissed/bookmarked) for a content or section.
    pub fn save_feedback(
        &self,
        feedback: &UserFeedback,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        conn.execute(
            "INSERT INTO user_feedback (id, content_id, section_id, feedback_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                feedback.id,
                feedback.content_id,
                feedback.section_id,
                feedback.feedback_type.as_str(),
                feedback.created_at,
            ],
        )?;

        Ok(())
    }

    // ========== User Preferences ==========

    /// Update or insert a topic preference. Increases weight by weight_delta
    /// and increments occurrence_count.
    pub fn update_preference(
        &self,
        topic: &str,
        weight_delta: f64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        // Try to update existing preference
        let rows_updated = conn.execute(
            "UPDATE user_preferences SET weight = weight + ?1, occurrence_count = occurrence_count + 1, last_updated = datetime('now')
             WHERE topic = ?2",
            params![weight_delta, topic],
        )?;

        // If no existing row, insert a new one
        if rows_updated == 0 {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO user_preferences (id, topic, weight, occurrence_count, last_updated)
                 VALUES (?1, ?2, ?3, 1, datetime('now'))",
                params![id, topic, weight_delta],
            )?;
        }

        Ok(())
    }

    /// Get all user preferences ordered by weight descending.
    pub fn get_all_preferences(
        &self,
    ) -> Result<Vec<UserPreference>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, topic, weight, occurrence_count, last_updated
             FROM user_preferences ORDER BY weight DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(UserPreference {
                id: row.get(0)?,
                topic: row.get(1)?,
                weight: row.get(2)?,
                occurrence_count: row.get(3)?,
                last_updated: row.get(4)?,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    // ========== Chat Messages ==========

    /// Save a chat message for a content item.
    pub fn save_chat_message(
        &self,
        content_id: &str,
        role: &str,
        message: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO chat_messages (id, content_id, role, message) VALUES (?1, ?2, ?3, ?4)",
            params![id, content_id, role, message],
        )?;
        Ok(())
    }

    /// Get all chat messages for a content item, ordered by creation time.
    pub fn get_chat_messages(
        &self,
        content_id: &str,
    ) -> Result<Vec<(String, String)>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT role, message FROM chat_messages WHERE content_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![content_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Delete all chat messages for a content item.
    pub fn delete_chat_messages(
        &self,
        content_id: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "DELETE FROM chat_messages WHERE content_id = ?1",
            params![content_id],
        )?;
        Ok(())
    }

    // ========== Data Hub ==========

    /// Get all dates that have captured content, with counts.
    pub fn get_dates_with_content(&self) -> Result<Vec<(String, i64)>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT DATE(captured_at) as day, COUNT(*) as cnt FROM captured_content
             WHERE is_deleted = 0 GROUP BY day ORDER BY day DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Get all content for a specific date.
    pub fn get_content_for_date(
        &self,
        date: &str,
    ) -> Result<Vec<CapturedContent>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, content_type, raw_text, image_path, thumbnail_path, source_app, source_bundle_id, source_url, user_note, captured_at, content_hash, byte_size, is_deleted, created_at, updated_at, digested_at, digest_action, summary, tags
             FROM captured_content WHERE DATE(captured_at) = ?1 AND is_deleted = 0 ORDER BY captured_at ASC",
        )?;

        let rows = stmt.query_map(params![date], |row| {
            Ok(CapturedContent {
                id: row.get(0)?,
                content_type: ContentType::from_str(&row.get::<_, String>(1)?),
                raw_text: row.get(2)?,
                image_path: row.get(3)?,
                thumbnail_path: row.get(4)?,
                source_app: row.get(5)?,
                source_bundle_id: row.get(6)?,
                source_url: row.get(7)?,
                user_note: row.get(8)?,
                captured_at: row.get(9)?,
                content_hash: row.get(10)?,
                byte_size: row.get(11)?,
                is_deleted: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                digested_at: row.get(15).unwrap_or(None),
                digest_action: row.get(16).unwrap_or(None),
                summary: row.get(17).unwrap_or(None),
                tags: row.get(18).unwrap_or(None),
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    // ========== Digest ==========

    /// Get undigested content items, ordered by oldest first.
    /// Used by the "消化" feature to surface content for review.
    pub fn get_undigested_content(
        &self,
        limit: i64,
    ) -> Result<Vec<CapturedContent>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, content_type, raw_text, image_path, thumbnail_path, source_app, source_bundle_id, source_url, user_note, captured_at, content_hash, byte_size, is_deleted, created_at, updated_at, digested_at, digest_action, summary, tags
             FROM captured_content
             WHERE is_deleted = 0 AND digested_at IS NULL
             ORDER BY captured_at ASC LIMIT ?1"
        )?;

        let rows = stmt.query_map(params![limit], |row| {
            Ok(CapturedContent {
                id: row.get(0)?,
                content_type: ContentType::from_str(&row.get::<_, String>(1)?),
                raw_text: row.get(2)?,
                image_path: row.get(3)?,
                thumbnail_path: row.get(4)?,
                source_app: row.get(5)?,
                source_bundle_id: row.get(6)?,
                source_url: row.get(7)?,
                user_note: row.get(8)?,
                captured_at: row.get(9)?,
                content_hash: row.get(10)?,
                byte_size: row.get(11)?,
                is_deleted: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                digested_at: row.get(15).unwrap_or(None),
                digest_action: row.get(16).unwrap_or(None),
                summary: row.get(17).unwrap_or(None),
                tags: row.get(18).unwrap_or(None),
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Get undigested content from the last N days, ordered oldest first.
    pub fn get_undigested_content_recent(
        &self,
        days: i64,
    ) -> Result<Vec<CapturedContent>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, content_type, raw_text, image_path, thumbnail_path, source_app, source_bundle_id, source_url, user_note, captured_at, content_hash, byte_size, is_deleted, created_at, updated_at, digested_at, digest_action, summary, tags
             FROM captured_content
             WHERE is_deleted = 0 AND digested_at IS NULL
               AND captured_at >= datetime('now', '-' || ?1 || ' days')
             ORDER BY captured_at ASC"
        )?;

        let rows = stmt.query_map(params![days], |row| {
            Ok(CapturedContent {
                id: row.get(0)?,
                content_type: ContentType::from_str(&row.get::<_, String>(1)?),
                raw_text: row.get(2)?,
                image_path: row.get(3)?,
                thumbnail_path: row.get(4)?,
                source_app: row.get(5)?,
                source_bundle_id: row.get(6)?,
                source_url: row.get(7)?,
                user_note: row.get(8)?,
                captured_at: row.get(9)?,
                content_hash: row.get(10)?,
                byte_size: row.get(11)?,
                is_deleted: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                digested_at: row.get(15).unwrap_or(None),
                digest_action: row.get(16).unwrap_or(None),
                summary: row.get(17).unwrap_or(None),
                tags: row.get(18).unwrap_or(None),
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Mark a content item as digested with the given action (keep/archive/pin).
    pub fn update_digest_action(
        &self,
        id: &str,
        action: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let rows = conn.execute(
            "UPDATE captured_content SET digested_at = datetime('now'), digest_action = ?1, updated_at = datetime('now') WHERE id = ?2 AND is_deleted = 0",
            params![action, id],
        )?;
        if rows == 0 {
            return Err(format!("Content not found: {}", id).into());
        }
        Ok(())
    }

    /// Count total undigested content items.
    pub fn count_undigested(&self) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM captured_content WHERE is_deleted = 0 AND digested_at IS NULL",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    // ========== App Settings ==========

    /// Get a setting value by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;

        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Get all settings as key-value pairs.
    pub fn get_all_settings(
        &self,
    ) -> Result<std::collections::HashMap<String, String>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        let mut stmt = conn.prepare("SELECT key, value FROM app_settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut settings = std::collections::HashMap::new();
        for row in rows {
            let (key, value) = row?;
            settings.insert(key, value);
        }
        Ok(settings)
    }

    /// Update a setting value by key.
    pub fn update_setting(
        &self,
        key: &str,
        value: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')",
            params![key, value],
        )?;
        Ok(())
    }

    // ========== Attention Insights ==========

    /// Get recent content for attention analysis (only needed fields).
    pub fn get_recent_content_for_analysis(
        &self,
        days: i64,
        limit: usize,
    ) -> Result<Vec<(String, Option<String>, Option<String>, String)>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let cutoff = (chrono::Utc::now() - chrono::TimeDelta::days(days)).to_rfc3339();
        let mut stmt = conn.prepare(
            "SELECT id, raw_text, source_url, captured_at
             FROM captured_content
             WHERE is_deleted = 0 AND captured_at >= ?1
             ORDER BY captured_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![cutoff, limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Save a new attention insight, marking all previous as not current.
    pub fn save_attention_insight(
        &self,
        analysis_json: Option<&str>,
        status: &str,
        error_message: Option<&str>,
        window_start: &str,
        window_end: &str,
        content_count: i32,
        model_used: &str,
    ) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        conn.execute("UPDATE attention_insights SET is_current = 0", [])?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO attention_insights (analysis_json, status, error_message, analyzed_at, window_start, window_end, content_count, model_used, is_current)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)",
            params![analysis_json, status, error_message, now, window_start, window_end, content_count, model_used],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Update the status of an insight.
    pub fn update_insight_status(
        &self,
        id: i64,
        status: &str,
        analysis_json: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "UPDATE attention_insights SET status = ?1, analysis_json = ?2, error_message = ?3 WHERE id = ?4",
            params![status, analysis_json, error_message, id],
        )?;
        Ok(())
    }

    /// Get the most recent current insight.
    pub fn get_current_insight(
        &self,
    ) -> Result<Option<AttentionInsight>, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, analysis_json, status, error_message, analyzed_at, window_start, window_end, content_count, model_used, is_current
             FROM attention_insights
             WHERE is_current = 1
             ORDER BY analyzed_at DESC
             LIMIT 1",
        )?;
        let mut rows = stmt.query_map([], |row| {
            Ok(AttentionInsight {
                id: row.get(0)?,
                analysis_json: row.get(1)?,
                status: row.get(2)?,
                error_message: row.get(3)?,
                analyzed_at: row.get(4)?,
                window_start: row.get(5)?,
                window_end: row.get(6)?,
                content_count: row.get(7)?,
                model_used: row.get(8)?,
                is_current: row.get::<_, i32>(9)? == 1,
            })
        })?;
        match rows.next() {
            Some(Ok(insight)) => Ok(Some(insight)),
            Some(Err(e)) => Err(Box::new(e)),
            None => Ok(None),
        }
    }

    /// Check if any content was saved or updated after the given timestamp.
    pub fn has_new_content_since(
        &self,
        since: &str,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let conn = self
            .db
            .conn
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM captured_content WHERE is_deleted = 0 AND (captured_at > ?1 OR updated_at > ?1)",
            params![since],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::database::Database;
    use crate::storage::models::{CapturedContent, ContentType};

    /// Create an in-memory database with all migrations applied.
    fn test_db() -> Arc<Database> {
        let db = Database::new_in_memory().expect("Failed to create test DB");
        Arc::new(db)
    }

    fn make_content(id: &str, captured_at: &str) -> CapturedContent {
        CapturedContent {
            id: id.to_string(),
            content_type: ContentType::Text,
            raw_text: Some(format!("Test content {}", id)),
            image_path: None,
            thumbnail_path: None,
            source_app: "TestApp".to_string(),
            source_bundle_id: None,
            source_url: None,
            user_note: None,
            captured_at: captured_at.to_string(),
            content_hash: format!("hash_{}", id),
            byte_size: 100,
            is_deleted: false,
            created_at: captured_at.to_string(),
            updated_at: captured_at.to_string(),
            digested_at: None,
            digest_action: None,
        }
    }

    #[test]
    fn test_get_undigested_returns_oldest_first() {
        let db = test_db();
        let repo = Repository::new(db);

        // Insert 5 items with different timestamps
        for i in 1..=5 {
            let content = make_content(
                &format!("item_{}", i),
                &format!("2025-01-{:02}T10:00:00", i),
            );
            repo.save_content(&content).unwrap();
        }

        let items = repo.get_undigested_content(3).unwrap();
        assert_eq!(items.len(), 3);
        // Should be oldest first
        assert_eq!(items[0].id, "item_1");
        assert_eq!(items[1].id, "item_2");
        assert_eq!(items[2].id, "item_3");
    }

    #[test]
    fn test_get_undigested_skips_digested() {
        let db = test_db();
        let repo = Repository::new(db);

        for i in 1..=3 {
            let content = make_content(
                &format!("item_{}", i),
                &format!("2025-01-{:02}T10:00:00", i),
            );
            repo.save_content(&content).unwrap();
        }

        // Digest item_1
        repo.update_digest_action("item_1", "keep").unwrap();

        let items = repo.get_undigested_content(5).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "item_2");
        assert_eq!(items[1].id, "item_3");
    }

    #[test]
    fn test_get_undigested_empty_when_all_digested() {
        let db = test_db();
        let repo = Repository::new(db);

        let content = make_content("item_1", "2025-01-01T10:00:00");
        repo.save_content(&content).unwrap();
        repo.update_digest_action("item_1", "archive").unwrap();

        let items = repo.get_undigested_content(5).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn test_update_digest_keep() {
        let db = test_db();
        let repo = Repository::new(db);

        let content = make_content("item_1", "2025-01-01T10:00:00");
        repo.save_content(&content).unwrap();

        repo.update_digest_action("item_1", "keep").unwrap();

        // Verify by fetching — it should no longer be undigested
        let undigested = repo.get_undigested_content(5).unwrap();
        assert!(undigested.is_empty());

        // Verify the action was set correctly
        let item = repo.get_content_by_id("item_1").unwrap().unwrap();
        assert_eq!(item.digest_action.as_deref(), Some("keep"));
        assert!(item.digested_at.is_some());
    }

    #[test]
    fn test_update_digest_archive() {
        let db = test_db();
        let repo = Repository::new(db);

        let content = make_content("item_1", "2025-01-01T10:00:00");
        repo.save_content(&content).unwrap();

        repo.update_digest_action("item_1", "archive").unwrap();

        let item = repo.get_content_by_id("item_1").unwrap().unwrap();
        assert_eq!(item.digest_action.as_deref(), Some("archive"));
        assert!(item.digested_at.is_some());
    }

    #[test]
    fn test_update_digest_pin() {
        let db = test_db();
        let repo = Repository::new(db);

        let content = make_content("item_1", "2025-01-01T10:00:00");
        repo.save_content(&content).unwrap();

        repo.update_digest_action("item_1", "pin").unwrap();

        let item = repo.get_content_by_id("item_1").unwrap().unwrap();
        assert_eq!(item.digest_action.as_deref(), Some("pin"));
        assert!(item.digested_at.is_some());
    }

    #[test]
    fn test_update_digest_invalid_id() {
        let db = test_db();
        let repo = Repository::new(db);

        let result = repo.update_digest_action("nonexistent", "keep");
        assert!(result.is_err());
    }

    #[test]
    fn test_count_undigested() {
        let db = test_db();
        let repo = Repository::new(db);

        for i in 1..=5 {
            let content = make_content(
                &format!("item_{}", i),
                &format!("2025-01-{:02}T10:00:00", i),
            );
            repo.save_content(&content).unwrap();
        }

        assert_eq!(repo.count_undigested().unwrap(), 5);

        repo.update_digest_action("item_1", "archive").unwrap();
        repo.update_digest_action("item_2", "keep").unwrap();

        assert_eq!(repo.count_undigested().unwrap(), 3);
    }
}
