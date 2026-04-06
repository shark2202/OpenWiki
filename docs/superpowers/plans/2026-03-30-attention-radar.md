# Attention Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing Digest tab with an AI-powered "Attention Radar" that passively surfaces interest patterns from saved clipboard content.

**Architecture:** Backend Rust module queries 14 days of content, calls AI API via a standalone structured-analysis function (not modifying existing AiClient), caches results in a new `attention_insights` SQLite table with status tracking. Frontend replaces DigestView with RadarView, renders InsightCard components, listens for Tauri events on analysis completion.

**Tech Stack:** Rust (reqwest, serde, tokio), SQLite (rusqlite), React 19, TypeScript, Zustand, Tailwind CSS 4, Lucide Icons, Framer Motion, Tauri 2 event system.

**Design doc:** `~/.gstack/projects/kdsz001-xiaoyun/pipiwang-feat-data-hub-design-20260330-012030.md`
**Eng review:** All 7 issues resolved. Codex outside voice integrated.
**Design review:** 6/10 → 8/10. Typography + empty states + keyboard nav specified.

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src-tauri/src/ai/attention_analyzer.rs` | AI analysis logic: build prompt, call API with tool_use, validate JSON |
| `src-tauri/src/commands/attention.rs` | Tauri commands: trigger_attention_analysis, get_attention_insights |
| `src-tauri/src/storage/migrations/005_add_attention_insights.sql` | Database migration for attention_insights table |
| `src/features/digest/RadarView.tsx` | Main radar page component |
| `src/features/digest/InsightCard.tsx` | Unified card component for all 3 insight types |
| `src/features/digest/InsightDetail.tsx` | Thread detail view (AI insight + timeline) |
| `src/stores/radarStore.ts` | Zustand store for radar state |
| `src/services/radarService.ts` | Tauri command wrappers for radar |

### Modified files
| File | Change |
|------|--------|
| `src-tauri/src/ai/mod.rs` | Add `pub mod attention_analyzer;` |
| `src-tauri/src/commands/mod.rs` | Add `pub mod attention;` |
| `src-tauri/src/storage/repository.rs` | Add 4 new functions for attention data |
| `src-tauri/src/storage/models.rs` | Add AttentionInsight model |
| `src-tauri/src/lib.rs` | Register 2 new commands |
| `src/App.tsx` | Change tab label "消化"→"雷达", icon BookOpen→Target |

---

## Task 1: Database Migration + Model

**Files:**
- Create: `src-tauri/src/storage/migrations/005_add_attention_insights.sql`
- Modify: `src-tauri/src/storage/models.rs`

- [ ] **Step 1: Create migration SQL**

```sql
-- 005_add_attention_insights.sql
CREATE TABLE IF NOT EXISTS attention_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    analyzed_at TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    content_count INTEGER NOT NULL,
    model_used TEXT NOT NULL,
    is_current INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_insights_current ON attention_insights(is_current, analyzed_at);
```

- [ ] **Step 2: Add AttentionInsight model to models.rs**

Add to the end of `src-tauri/src/storage/models.rs`:

```rust
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
```

- [ ] **Step 3: Verify migration runs**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/storage/migrations/005_add_attention_insights.sql src-tauri/src/storage/models.rs
git commit -m "feat: add attention_insights table and model"
```

---

## Task 2: Repository Functions

**Files:**
- Modify: `src-tauri/src/storage/repository.rs`

- [ ] **Step 1: Add `get_recent_content_for_analysis` function**

Add to `impl Repository` block in `repository.rs`:

```rust
/// Get recent content for attention analysis (only needed fields, ordered by captured_at).
/// Returns at most `limit` items from the last `days` days.
pub fn get_recent_content_for_analysis(
    &self,
    days: i64,
    limit: usize,
) -> Result<Vec<(String, Option<String>, Option<String>, String)>, Box<dyn std::error::Error>> {
    let conn = self.conn_lock()?;
    let cutoff = (chrono::Utc::now() - chrono::TimeDelta::days(days))
        .to_rfc3339();
    let mut stmt = conn.prepare(
        "SELECT id, raw_text, source_url, captured_at
         FROM captured_content
         WHERE is_deleted = 0 AND captured_at >= ?1
         ORDER BY captured_at DESC
         LIMIT ?2"
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
```

- [ ] **Step 2: Add `save_attention_insight` function**

```rust
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
    let conn = self.conn_lock()?;
    // Mark all previous as not current
    conn.execute("UPDATE attention_insights SET is_current = 0", [])?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO attention_insights (analysis_json, status, error_message, analyzed_at, window_start, window_end, content_count, model_used, is_current)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)",
        params![analysis_json, status, error_message, now, window_start, window_end, content_count, model_used],
    )?;
    Ok(conn.last_insert_rowid())
}
```

- [ ] **Step 3: Add `update_insight_status` function**

```rust
/// Update the status (and optionally analysis_json / error_message) of an insight.
pub fn update_insight_status(
    &self,
    id: i64,
    status: &str,
    analysis_json: Option<&str>,
    error_message: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let conn = self.conn_lock()?;
    conn.execute(
        "UPDATE attention_insights SET status = ?1, analysis_json = ?2, error_message = ?3 WHERE id = ?4",
        params![status, analysis_json, error_message, id],
    )?;
    Ok(())
}
```

- [ ] **Step 4: Add `get_current_insight` function**

```rust
/// Get the most recent current insight.
pub fn get_current_insight(&self) -> Result<Option<AttentionInsight>, Box<dyn std::error::Error>> {
    let conn = self.conn_lock()?;
    let mut stmt = conn.prepare(
        "SELECT id, analysis_json, status, error_message, analyzed_at, window_start, window_end, content_count, model_used, is_current
         FROM attention_insights
         WHERE is_current = 1
         ORDER BY analyzed_at DESC
         LIMIT 1"
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
```

- [ ] **Step 5: Add `has_new_content_since` function**

```rust
/// Check if any content was saved or updated after the given timestamp.
pub fn has_new_content_since(&self, since: &str) -> Result<bool, Box<dyn std::error::Error>> {
    let conn = self.conn_lock()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM captured_content WHERE is_deleted = 0 AND (captured_at > ?1 OR updated_at > ?1)",
        params![since],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}
```

- [ ] **Step 6: Add import for AttentionInsight at top of repository.rs**

Add `AttentionInsight` to the existing `use super::models::{ ... }` import.

- [ ] **Step 7: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/storage/repository.rs
git commit -m "feat: add repository functions for attention insights"
```

---

## Task 3: Attention Analyzer (AI Logic)

**Files:**
- Create: `src-tauri/src/ai/attention_analyzer.rs`
- Modify: `src-tauri/src/ai/mod.rs`

- [ ] **Step 1: Create attention_analyzer.rs**

```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};

/// JSON schema for the AI analysis response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttentionAnalysis {
    pub recurring_threads: Vec<RecurringThread>,
    pub unexpected_connections: Vec<UnexpectedConnection>,
    pub new_obsessions: Vec<NewObsession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurringThread {
    pub topic: String,
    pub title: String,
    pub why_now: String,
    pub evidence: Vec<EvidenceItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnexpectedConnection {
    pub title: String,
    pub why_now: String,
    pub group_a: EvidenceGroup,
    pub group_b: EvidenceGroup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceGroup {
    pub topic: String,
    pub evidence: Vec<EvidenceItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewObsession {
    pub topic: String,
    pub title: String,
    pub why_now: String,
    pub since_days: i32,
    pub evidence: Vec<EvidenceItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceItem {
    pub index: usize,
    pub title: String,
    pub date: String,
}

/// Content item prepared for analysis (index-based, not ID-based)
struct AnalysisInput {
    index: usize,
    content_id: String,
    text_preview: String,
    source_url: Option<String>,
    captured_at: String,
}

/// Build the analysis prompt from content items.
pub fn build_prompt(
    items: &[(String, Option<String>, Option<String>, String)],
) -> (String, String) {
    let system = r#"你是一个个人注意力分析助手。你的任务是分析用户最近保存的内容，找出他们的兴趣模式。

分析规则：
1. 反复出现的线索（recurring_threads）：至少 3 条内容属于同一主题才算。给出主题名称、一句话解释为什么这个线索现在重要、列出证据（用 index 引用内容）。
2. 意外联系（unexpected_connections）：两组看似不同主题之间的隐藏关联。解释共同指向。
3. 新痴迷（new_obsessions）：最近 3-5 天才密集出现的新兴趣，之前没有相关内容。

重要：
- 用 index 编号引用内容，不要编造 index
- 标题用中文，语气亲切
- 如果某个类别没有发现，返回空数组
- 返回纯 JSON，不要包裹在 markdown 代码块中"#.to_string();

    // Build content list with dynamic truncation
    let total = items.len();
    let max_chars_per_item: usize = if total <= 20 {
        1000
    } else if total <= 50 {
        600
    } else if total <= 100 {
        400
    } else {
        300
    };

    let mut content_lines = Vec::new();
    for (i, (id, raw_text, source_url, captured_at)) in items.iter().enumerate() {
        let text = raw_text.as_deref().unwrap_or("");
        let truncated: String = if text.chars().count() > max_chars_per_item {
            format!("{}...", text.chars().take(max_chars_per_item).collect::<String>())
        } else {
            text.to_string()
        };

        let date = &captured_at[..10]; // YYYY-MM-DD
        let url_part = source_url.as_deref().map(|u| format!(" | URL: {}", u)).unwrap_or_default();
        content_lines.push(format!("[{}] ({}{}) {}", i, date, url_part, truncated));
    }

    let user_msg = format!(
        "以下是用户最近 14 天保存的 {} 条内容。请分析并返回 JSON。\n\n{}\n\n请返回如下 JSON 结构：\n{{\n  \"recurring_threads\": [...],\n  \"unexpected_connections\": [...],\n  \"new_obsessions\": [...]\n}}",
        total,
        content_lines.join("\n\n")
    );

    (system, user_msg)
}

/// Validate and fix the AI response JSON.
/// - Drops evidence items with index out of bounds.
/// - Drops threads/connections/obsessions with no remaining evidence.
pub fn validate_analysis(
    raw_json: &str,
    item_count: usize,
) -> Result<AttentionAnalysis, String> {
    let mut analysis: AttentionAnalysis = serde_json::from_str(raw_json)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    // Filter out-of-bounds indices
    for thread in &mut analysis.recurring_threads {
        thread.evidence.retain(|e| e.index < item_count);
    }
    analysis.recurring_threads.retain(|t| !t.evidence.is_empty());

    for conn in &mut analysis.unexpected_connections {
        conn.group_a.evidence.retain(|e| e.index < item_count);
        conn.group_b.evidence.retain(|e| e.index < item_count);
    }
    analysis.unexpected_connections.retain(|c| {
        !c.group_a.evidence.is_empty() || !c.group_b.evidence.is_empty()
    });

    for obs in &mut analysis.new_obsessions {
        obs.evidence.retain(|e| e.index < item_count);
    }
    analysis.new_obsessions.retain(|o| !o.evidence.is_empty());

    Ok(analysis)
}

/// Map index-based evidence back to real content IDs.
pub fn map_indices_to_ids(
    analysis: &mut AttentionAnalysis,
    id_map: &[String],
) {
    // We keep index as-is in the JSON (frontend uses it for display order)
    // but the frontend also gets the id_map to resolve content details
    // This function is a no-op for now but reserved for future use
}

/// Call the AI API directly with structured analysis request.
/// Uses Anthropic API directly (not through AiClient) to support
/// JSON-mode prompting without modifying the shared AiClient.
pub async fn call_analysis_api(
    api_key: &str,
    provider: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let http_client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    match provider.to_lowercase().as_str() {
        "anthropic" | "" => {
            call_anthropic_json(&http_client, api_key, model, system_prompt, user_message).await
        }
        "openai" => {
            call_openai_json(&http_client, api_key, model, system_prompt, user_message).await
        }
        "openrouter" => {
            call_openrouter_json(&http_client, api_key, model, system_prompt, user_message).await
        }
        _ => {
            call_anthropic_json(&http_client, api_key, model, system_prompt, user_message).await
        }
    }
}

#[derive(Serialize)]
struct AnthropicReq {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct AnthropicResp {
    content: Vec<AnthropicBlock>,
}

#[derive(Deserialize)]
struct AnthropicBlock {
    text: Option<String>,
}

async fn call_anthropic_json(
    client: &Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let body = AnthropicReq {
        model: model.to_string(),
        max_tokens: 4096,
        system: system_prompt.to_string(),
        messages: vec![serde_json::json!({"role": "user", "content": user_message})],
    };

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API 请求失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("API 错误 ({}): {}", status, &text[..text.len().min(200)]));
    }

    let parsed: AnthropicResp = serde_json::from_str(&text)
        .map_err(|e| format!("解析响应失败: {}", e))?;

    parsed.content.first()
        .and_then(|b| b.text.clone())
        .ok_or_else(|| "AI 返回空内容".to_string())
}

async fn call_openai_json(
    client: &Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "max_tokens": 4096,
        "temperature": 0.3,
        "response_format": {"type": "json_object"}
    });

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API 请求失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("API 错误 ({}): {}", status, &text[..text.len().min(200)]));
    }

    #[derive(Deserialize)]
    struct OaiResp { choices: Vec<OaiChoice> }
    #[derive(Deserialize)]
    struct OaiChoice { message: OaiMsg }
    #[derive(Deserialize)]
    struct OaiMsg { content: String }

    let parsed: OaiResp = serde_json::from_str(&text)
        .map_err(|e| format!("解析响应失败: {}", e))?;

    parsed.choices.first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "AI 返回空内容".to_string())
}

async fn call_openrouter_json(
    client: &Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "max_tokens": 4096,
        "temperature": 0.3
    });

    let resp = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API 请求失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("API 错误 ({}): {}", status, &text[..text.len().min(200)]));
    }

    #[derive(Deserialize)]
    struct OrResp { choices: Vec<OrChoice> }
    #[derive(Deserialize)]
    struct OrChoice { message: OrMsg }
    #[derive(Deserialize)]
    struct OrMsg { content: String }

    let parsed: OrResp = serde_json::from_str(&text)
        .map_err(|e| format!("解析响应失败: {}", e))?;

    parsed.choices.first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "AI 返回空内容".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_analysis_valid() {
        let json = r#"{
            "recurring_threads": [{"topic":"test","title":"t","why_now":"w","evidence":[{"index":0,"title":"e","date":"2026-03-28"}]}],
            "unexpected_connections": [],
            "new_obsessions": []
        }"#;
        let result = validate_analysis(json, 5);
        assert!(result.is_ok());
        let a = result.unwrap();
        assert_eq!(a.recurring_threads.len(), 1);
    }

    #[test]
    fn test_validate_analysis_drops_out_of_bounds() {
        let json = r#"{
            "recurring_threads": [{"topic":"test","title":"t","why_now":"w","evidence":[{"index":99,"title":"e","date":"2026-03-28"}]}],
            "unexpected_connections": [],
            "new_obsessions": []
        }"#;
        let result = validate_analysis(json, 5);
        assert!(result.is_ok());
        let a = result.unwrap();
        // Thread should be dropped because all evidence was out of bounds
        assert_eq!(a.recurring_threads.len(), 0);
    }

    #[test]
    fn test_validate_analysis_invalid_json() {
        let result = validate_analysis("not json", 5);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_analysis_empty() {
        let json = r#"{"recurring_threads":[],"unexpected_connections":[],"new_obsessions":[]}"#;
        let result = validate_analysis(json, 0);
        assert!(result.is_ok());
    }

    #[test]
    fn test_build_prompt_truncation() {
        let items: Vec<(String, Option<String>, Option<String>, String)> = (0..5)
            .map(|i| (
                format!("id_{}", i),
                Some("a".repeat(2000)),
                None,
                format!("2026-03-{:02}T00:00:00Z", 20 + i),
            ))
            .collect();
        let (system, user) = build_prompt(&items);
        assert!(system.contains("注意力分析"));
        assert!(user.contains("[0]"));
        assert!(user.contains("[4]"));
        // Each item should be truncated to ~1000 chars (5 items = small set)
        assert!(user.len() < 5 * 2000);
    }
}
```

- [ ] **Step 2: Register module in ai/mod.rs**

Add to `src-tauri/src/ai/mod.rs`:
```rust
pub mod attention_analyzer;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test attention_analyzer`
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ai/attention_analyzer.rs src-tauri/src/ai/mod.rs
git commit -m "feat: add attention analyzer with prompt builder, JSON validator, and API caller"
```

---

## Task 4: Tauri Commands

**Files:**
- Create: `src-tauri/src/commands/attention.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create attention.rs commands**

```rust
use crate::ai::attention_analyzer;
use crate::commands::capture::AppState;
use crate::storage::models::AttentionInsight;
use crate::storage::repository::Repository;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize)]
pub struct RadarStatus {
    pub status: String, // "fresh" | "analyzing" | "stale" | "empty" | "no_api_key" | "not_enough_content" | "error"
    pub insight: Option<AttentionInsight>,
    pub has_new_content: bool,
}

#[tauri::command]
pub async fn get_attention_insights(
    state: State<'_, AppState>,
) -> Result<RadarStatus, String> {
    let repo = Repository::new(state.db.clone());

    // Check if API key is configured
    let api_key = repo.get_setting("ai_api_key").ok().flatten().unwrap_or_default();
    if api_key.is_empty() {
        return Ok(RadarStatus {
            status: "no_api_key".to_string(),
            insight: None,
            has_new_content: false,
        });
    }

    // Check content count
    let content = repo.get_recent_content_for_analysis(14, 1)
        .map_err(|e| e.to_string())?;
    if content.is_empty() {
        return Ok(RadarStatus {
            status: "not_enough_content".to_string(),
            insight: None,
            has_new_content: false,
        });
    }

    // Get current insight
    let insight = repo.get_current_insight().map_err(|e| e.to_string())?;

    match &insight {
        Some(i) if i.status == "analyzing" => {
            Ok(RadarStatus {
                status: "analyzing".to_string(),
                insight: Some(i.clone()),
                has_new_content: false,
            })
        }
        Some(i) if i.status == "complete" => {
            let has_new = repo.has_new_content_since(&i.analyzed_at)
                .unwrap_or(false);
            Ok(RadarStatus {
                status: if has_new { "stale" } else { "fresh" }.to_string(),
                insight: Some(i.clone()),
                has_new_content: has_new,
            })
        }
        Some(i) if i.status == "error" => {
            Ok(RadarStatus {
                status: "error".to_string(),
                insight: Some(i.clone()),
                has_new_content: true,
            })
        }
        _ => {
            Ok(RadarStatus {
                status: "empty".to_string(),
                insight: None,
                has_new_content: true,
            })
        }
    }
}

#[tauri::command]
pub async fn trigger_attention_analysis(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.clone();
    let repo = Repository::new(db.clone());

    // Check if already analyzing
    if let Ok(Some(insight)) = repo.get_current_insight() {
        if insight.status == "analyzing" {
            return Ok(()); // Already in progress
        }
    }

    // Get AI settings
    let api_key = repo.get_setting("ai_api_key").ok().flatten()
        .ok_or("未配置 AI API 密钥")?;
    let provider = repo.get_setting("ai_provider").ok().flatten()
        .unwrap_or_else(|| "anthropic".to_string());
    let model = repo.get_setting("ai_model").ok().flatten()
        .unwrap_or_else(|| "claude-haiku-4-5-20251001".to_string());

    // Get content for analysis
    let items = repo.get_recent_content_for_analysis(14, 200)
        .map_err(|e| e.to_string())?;

    if items.len() < 5 {
        return Err("内容不足 5 条，无法分析".to_string());
    }

    let content_count = items.len() as i32;
    let now = chrono::Utc::now();
    let window_end = now.format("%Y-%m-%d").to_string();
    let window_start = (now - chrono::TimeDelta::days(14)).format("%Y-%m-%d").to_string();

    // Create "analyzing" record
    let insight_id = repo.save_attention_insight(
        None, "analyzing", None,
        &window_start, &window_end, content_count, &model,
    ).map_err(|e| e.to_string())?;

    // Build prompt
    let (system_prompt, user_message) = attention_analyzer::build_prompt(&items);

    // Collect content IDs for index mapping
    let id_map: Vec<String> = items.iter().map(|(id, _, _, _)| id.clone()).collect();

    // Spawn background task
    tauri::async_runtime::spawn(async move {
        let repo = Repository::new(db.clone());

        match attention_analyzer::call_analysis_api(
            &api_key, &provider, &model,
            &system_prompt, &user_message,
        ).await {
            Ok(raw_json) => {
                // Try to extract JSON from potential markdown code blocks
                let json_str = extract_json(&raw_json);

                match attention_analyzer::validate_analysis(&json_str, id_map.len()) {
                    Ok(analysis) => {
                        // Build response with id_map included
                        let response = serde_json::json!({
                            "analysis": analysis,
                            "id_map": id_map,
                        });
                        let json = serde_json::to_string(&response).unwrap_or_default();
                        let _ = repo.update_insight_status(
                            insight_id, "complete", Some(&json), None,
                        );
                        let _ = app.emit("attention-analysis-complete", "complete");
                    }
                    Err(e) => {
                        log::error!("Attention analysis validation failed: {}", e);
                        let _ = repo.update_insight_status(
                            insight_id, "error", None, Some(&e),
                        );
                        let _ = app.emit("attention-analysis-complete", "error");
                    }
                }
            }
            Err(e) => {
                log::error!("Attention analysis API call failed: {}", e);
                let _ = repo.update_insight_status(
                    insight_id, "error", None, Some(&e),
                );
                let _ = app.emit("attention-analysis-complete", "error");
            }
        }
    });

    Ok(())
}

/// Extract JSON from a string that might be wrapped in markdown code blocks.
fn extract_json(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.starts_with("```json") {
        trimmed
            .trim_start_matches("```json")
            .trim_end_matches("```")
            .trim()
            .to_string()
    } else if trimmed.starts_with("```") {
        trimmed
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .to_string()
    } else {
        trimmed.to_string()
    }
}
```

- [ ] **Step 2: Register module in commands/mod.rs**

Add to `src-tauri/src/commands/mod.rs`:
```rust
pub mod attention;
```

- [ ] **Step 3: Register commands in lib.rs**

Add to the `generate_handler![]` in `src-tauri/src/lib.rs`, after the datahub commands:
```rust
commands::attention::get_attention_insights,
commands::attention::trigger_attention_analysis,
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles. (Note: `repo.get_setting()` must exist — check if it's already in repository.rs. If not, it reads from a settings table. The app already has this.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/attention.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for attention radar (trigger + get)"
```

---

## Task 5: Frontend Service + Store

**Files:**
- Create: `src/services/radarService.ts`
- Create: `src/stores/radarStore.ts`

- [ ] **Step 1: Create radarService.ts**

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface RadarStatus {
  status: "fresh" | "analyzing" | "stale" | "empty" | "no_api_key" | "not_enough_content" | "error";
  insight: AttentionInsight | null;
  has_new_content: boolean;
}

export interface AttentionInsight {
  id: number;
  analysis_json: string | null;
  status: string;
  error_message: string | null;
  analyzed_at: string;
  window_start: string;
  window_end: string;
  content_count: number;
  model_used: string;
  is_current: boolean;
}

export interface AttentionAnalysis {
  analysis: {
    recurring_threads: RecurringThread[];
    unexpected_connections: UnexpectedConnection[];
    new_obsessions: NewObsession[];
  };
  id_map: string[];
}

export interface RecurringThread {
  topic: string;
  title: string;
  why_now: string;
  evidence: EvidenceItem[];
}

export interface UnexpectedConnection {
  title: string;
  why_now: string;
  group_a: EvidenceGroup;
  group_b: EvidenceGroup;
}

export interface EvidenceGroup {
  topic: string;
  evidence: EvidenceItem[];
}

export interface NewObsession {
  topic: string;
  title: string;
  why_now: string;
  since_days: number;
  evidence: EvidenceItem[];
}

export interface EvidenceItem {
  index: number;
  title: string;
  date: string;
}

export async function getAttentionInsights(): Promise<RadarStatus> {
  return invoke<RadarStatus>("get_attention_insights");
}

export async function triggerAttentionAnalysis(): Promise<void> {
  return invoke("trigger_attention_analysis");
}
```

- [ ] **Step 2: Create radarStore.ts**

```typescript
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  getAttentionInsights,
  triggerAttentionAnalysis,
  type RadarStatus,
  type AttentionAnalysis,
} from "../services/radarService";

interface RadarState {
  status: RadarStatus["status"];
  analysis: AttentionAnalysis | null;
  contentCount: number;
  hasNewContent: boolean;
  errorMessage: string | null;
  isLoading: boolean;

  // Detail view
  selectedInsight: { type: string; index: number } | null;

  loadRadar: () => Promise<void>;
  triggerAnalysis: () => Promise<void>;
  selectInsight: (type: string, index: number) => void;
  clearSelection: () => void;
  setupEventListener: () => Promise<() => void>;
}

export const useRadarStore = create<RadarState>((set, get) => ({
  status: "empty",
  analysis: null,
  contentCount: 0,
  hasNewContent: false,
  errorMessage: null,
  isLoading: true,
  selectedInsight: null,

  loadRadar: async () => {
    set({ isLoading: true });
    try {
      const result = await getAttentionInsights();
      const analysis = result.insight?.analysis_json
        ? (JSON.parse(result.insight.analysis_json) as AttentionAnalysis)
        : null;

      set({
        status: result.status,
        analysis,
        contentCount: result.insight?.content_count ?? 0,
        hasNewContent: result.has_new_content,
        errorMessage: result.insight?.error_message ?? null,
        isLoading: false,
      });

      // Auto-trigger analysis if stale or empty (and not already analyzing)
      if ((result.status === "stale" || result.status === "empty") && result.status !== "analyzing") {
        get().triggerAnalysis();
      }
    } catch (e) {
      set({
        isLoading: false,
        status: "error",
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  },

  triggerAnalysis: async () => {
    set({ status: "analyzing" });
    try {
      await triggerAttentionAnalysis();
    } catch (e) {
      set({
        status: "error",
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  },

  selectInsight: (type: string, index: number) => {
    set({ selectedInsight: { type, index } });
  },

  clearSelection: () => {
    set({ selectedInsight: null });
  },

  setupEventListener: async () => {
    const unlisten = await listen<string>("attention-analysis-complete", () => {
      get().loadRadar();
    });
    return unlisten;
  },
}));
```

- [ ] **Step 3: Commit**

```bash
git add src/services/radarService.ts src/stores/radarStore.ts
git commit -m "feat: add radar service and Zustand store with Tauri event listener"
```

---

## Task 6: RadarView Component

**Files:**
- Create: `src/features/digest/RadarView.tsx`
- Create: `src/features/digest/InsightCard.tsx`
- Create: `src/features/digest/InsightDetail.tsx`

- [ ] **Step 1: Create InsightCard.tsx**

```tsx
import { Target, Zap, Sparkles, ChevronRight } from "lucide-react";

interface EvidenceItem {
  index: number;
  title: string;
  date: string;
}

interface EvidenceGroup {
  topic: string;
  evidence: EvidenceItem[];
}

type InsightType = "thread" | "connection" | "obsession";

interface InsightCardProps {
  type: InsightType;
  title: string;
  whyNow: string;
  evidence?: EvidenceItem[];
  groupA?: EvidenceGroup;
  groupB?: EvidenceGroup;
  sinceDays?: number;
  onExpand: () => void;
}

const TYPE_CONFIG = {
  thread: { color: "#F97316", bg: "#FFF7ED", icon: Target, label: "反复线索" },
  connection: { color: "#2563EB", bg: "#EFF6FF", icon: Zap, label: "意外联系" },
  obsession: { color: "#16A34A", bg: "#F0FDF4", icon: Sparkles, label: "新痴迷" },
};

export function InsightCard({ type, title, whyNow, evidence, groupA, groupB, sinceDays, onExpand }: InsightCardProps) {
  const config = TYPE_CONFIG[type];
  const Icon = config.icon;

  return (
    <div
      className="bg-white border border-stone-200 rounded-xl p-4 mb-3 hover:border-stone-300 transition-colors cursor-pointer"
      onClick={onExpand}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onExpand()}
      role="button"
      aria-label={title}
    >
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: config.bg }}
        >
          <Icon size={12} style={{ color: config.color }} />
        </div>
        <h3 className="text-[15px] font-semibold text-stone-900 leading-snug flex-1">
          {title}
        </h3>
      </div>

      {/* AI explanation */}
      <p className="text-[13px] text-stone-600 leading-relaxed mb-3 pl-7 border-l-2 border-stone-200 ml-2.5">
        {whyNow}
      </p>

      {/* Evidence: regular list for thread/obsession */}
      {evidence && evidence.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {evidence.slice(0, 4).map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px] text-stone-600">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: config.color }} />
              <span className="text-[11px] text-stone-400 font-mono flex-shrink-0">{e.date}</span>
              <span className="truncate">{e.title}</span>
            </div>
          ))}
          {evidence.length > 4 && (
            <div className="text-[11px] text-stone-400 pl-3.5">+ {evidence.length - 4} 条更多</div>
          )}
        </div>
      )}

      {/* Evidence: dual columns for connection */}
      {type === "connection" && groupA && groupB && (
        <div className="flex gap-3 mb-3">
          <div className="flex-1 bg-stone-50 rounded-lg p-3">
            <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-2">
              {groupA.topic}
            </div>
            {groupA.evidence.slice(0, 2).map((e, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[12px] text-stone-600 mb-1">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: config.color }} />
                <span className="truncate">{e.title}</span>
              </div>
            ))}
          </div>
          <div className="flex-1 bg-stone-50 rounded-lg p-3">
            <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-2">
              {groupB.topic}
            </div>
            {groupB.evidence.slice(0, 2).map((e, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[12px] text-stone-600 mb-1">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: config.color }} />
                <span className="truncate">{e.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="flex items-center gap-1 text-[13px] font-medium" style={{ color: config.color }}>
        {type === "connection" ? "探索这个联系" : "深入了解这个线索"}
        <ChevronRight size={14} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create InsightDetail.tsx**

```tsx
import { ArrowLeft } from "lucide-react";
import type { RecurringThread, UnexpectedConnection, NewObsession } from "../../services/radarService";

interface InsightDetailProps {
  type: "thread" | "connection" | "obsession";
  data: RecurringThread | UnexpectedConnection | NewObsession;
  onBack: () => void;
}

export function InsightDetail({ type, data, onBack }: InsightDetailProps) {
  const isConnection = type === "connection";
  const conn = isConnection ? (data as UnexpectedConnection) : null;
  const thread = !isConnection ? (data as RecurringThread | NewObsession) : null;

  return (
    <div className="min-w-[640px]">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] text-stone-500 hover:text-stone-700 mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        返回雷达
      </button>

      {/* Title */}
      <h1 className="text-[24px] font-bold text-stone-900 mb-1 font-['Cabinet_Grotesk']">
        {data.title}
      </h1>
      <p className="text-[13px] text-stone-400 mb-6">
        过去 14 天
        {thread && "evidence" in thread ? ` · ${thread.evidence.length} 条相关内容` : ""}
      </p>

      {/* AI Insight block */}
      <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 mb-8">
        <p className="text-[13px] text-stone-700 leading-relaxed">{data.why_now}</p>
      </div>

      {/* Timeline for thread/obsession */}
      {thread && "evidence" in thread && (
        <div className="space-y-0">
          <h2 className="text-[15px] font-semibold text-stone-900 mb-4">时间线</h2>
          {thread.evidence.map((e, i) => (
            <div key={i} className="flex gap-3 pb-4 border-l-2 border-stone-200 ml-2 pl-4 last:border-transparent">
              <span className="text-[11px] text-stone-400 font-mono flex-shrink-0 mt-0.5">{e.date}</span>
              <p className="text-[13px] text-stone-700">{e.title}</p>
            </div>
          ))}
        </div>
      )}

      {/* Dual groups for connection */}
      {conn && (
        <div className="grid grid-cols-2 gap-4">
          {[conn.group_a, conn.group_b].map((group, gi) => (
            <div key={gi}>
              <h2 className="text-[15px] font-semibold text-stone-900 mb-3">{group.topic}</h2>
              {group.evidence.map((e, i) => (
                <div key={i} className="flex gap-3 pb-3 border-l-2 border-blue-200 ml-2 pl-4">
                  <span className="text-[11px] text-stone-400 font-mono flex-shrink-0 mt-0.5">{e.date}</span>
                  <p className="text-[13px] text-stone-700">{e.title}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create RadarView.tsx**

```tsx
import { useEffect } from "react";
import { RefreshCw, Target, Key, Search } from "lucide-react";
import { useRadarStore } from "../../stores/radarStore";
import { InsightCard } from "./InsightCard";
import { InsightDetail } from "./InsightDetail";
import type { AttentionAnalysis } from "../../services/radarService";

export function RadarView() {
  const {
    status, analysis, contentCount, hasNewContent, errorMessage,
    isLoading, selectedInsight,
    loadRadar, triggerAnalysis, selectInsight, clearSelection, setupEventListener,
  } = useRadarStore();

  useEffect(() => {
    loadRadar();
    let cleanup: (() => void) | undefined;
    setupEventListener().then((fn) => { cleanup = fn; });
    return () => { cleanup?.(); };
  }, [loadRadar, setupEventListener]);

  // Detail view
  if (selectedInsight && analysis) {
    const { type, index } = selectedInsight;
    const a = analysis.analysis;
    let data;
    if (type === "thread") data = a.recurring_threads[index];
    else if (type === "connection") data = a.unexpected_connections[index];
    else data = a.new_obsessions[index];

    if (data) {
      return <InsightDetail type={type as any} data={data} onBack={clearSelection} />;
    }
  }

  // Empty states
  if (!isLoading && status === "no_api_key") {
    return <EmptyState icon={Key} title="需要配置 AI 服务" desc="注意力雷达需要 AI 来分析你的内容" action="前往设置 →" />;
  }
  if (!isLoading && status === "not_enough_content") {
    return <EmptyState icon={Target} title="你离洞察只差几步" desc="继续保存你感兴趣的内容，积累到 5 条就能看到注意力分析" action="去看看内容 →" />;
  }

  const a = analysis?.analysis;
  const threadCount = a?.recurring_threads?.length ?? 0;
  const connCount = a?.unexpected_connections?.length ?? 0;
  const obsCount = a?.new_obsessions?.length ?? 0;
  const noFindings = a && threadCount === 0 && connCount === 0 && obsCount === 0;

  return (
    <div className="min-w-[640px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[24px] font-bold text-stone-900 font-['Cabinet_Grotesk']">注意力雷达</h1>
        <button
          onClick={() => triggerAnalysis()}
          disabled={status === "analyzing" || !hasNewContent}
          className="flex items-center gap-1.5 text-[13px] text-stone-500 hover:text-orange-500 disabled:text-stone-300 disabled:cursor-not-allowed transition-colors"
          title={hasNewContent ? "刷新分析" : "暂无新内容"}
        >
          <RefreshCw size={14} className={status === "analyzing" ? "animate-spin" : ""} />
          刷新
        </button>
      </div>
      <p className="text-[13px] text-stone-400 mb-6">
        最近 14 天{contentCount > 0 ? ` · 基于 ${contentCount} 条内容分析` : ""}
      </p>

      {/* Loading skeleton */}
      {(isLoading || status === "analyzing") && !analysis && (
        <div className="space-y-4">
          <div className="flex gap-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="flex-1 bg-stone-100 rounded-xl h-16 animate-pulse" />
            ))}
          </div>
          {[1,2].map(i => (
            <div key={i} className="bg-stone-100 rounded-xl h-32 animate-pulse" />
          ))}
        </div>
      )}

      {/* Error state */}
      {status === "error" && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-6">
          <p className="text-[13px] text-red-700">{errorMessage || "分析失败"}</p>
          <button onClick={() => triggerAnalysis()} className="text-[13px] text-red-500 mt-2 hover:underline">
            重试
          </button>
        </div>
      )}

      {/* No findings */}
      {noFindings && status !== "analyzing" && (
        <EmptyState icon={Search} title="暂时没有发现模式" desc="最近保存的内容主题比较分散，过几天再来看看" />
      )}

      {/* Stats bar */}
      {a && !noFindings && (
        <>
          <div className="flex gap-6 mb-8 bg-white border border-stone-200 rounded-xl p-4">
            <Stat label="保存内容" value={contentCount} />
            <Stat label="反复线索" value={threadCount} color="#F97316" />
            <Stat label="意外联系" value={connCount} color="#2563EB" />
            <Stat label="新痴迷" value={obsCount} color="#16A34A" />
          </div>

          {/* Recurring Threads */}
          {threadCount > 0 && (
            <Section icon={Target} title="反复出现的线索" count={threadCount} color="#F97316">
              {a.recurring_threads
                .sort((a, b) => b.evidence.length - a.evidence.length)
                .map((t, i) => (
                <InsightCard key={i} type="thread" title={t.title} whyNow={t.why_now}
                  evidence={t.evidence} onExpand={() => selectInsight("thread", i)} />
              ))}
            </Section>
          )}

          {/* Unexpected Connections */}
          {connCount > 0 && (
            <Section icon={() => <span className="text-[12px]">⚡</span>} title="意外联系" count={connCount} color="#2563EB">
              {a.unexpected_connections.map((c, i) => (
                <InsightCard key={i} type="connection" title={c.title} whyNow={c.why_now}
                  groupA={c.group_a} groupB={c.group_b} onExpand={() => selectInsight("connection", i)} />
              ))}
            </Section>
          )}

          {/* New Obsessions */}
          {obsCount > 0 && (
            <Section icon={() => <span className="text-[12px]">★</span>} title="新痴迷" count={obsCount} color="#16A34A">
              {a.new_obsessions.map((o, i) => (
                <InsightCard key={i} type="obsession" title={o.title} whyNow={o.why_now}
                  evidence={o.evidence} sinceDays={o.since_days} onExpand={() => selectInsight("obsession", i)} />
              ))}
            </Section>
          )}
        </>
      )}

      {/* Analyzing overlay on stale data */}
      {status === "analyzing" && analysis && (
        <div className="text-center text-[13px] text-stone-400 mt-4">
          <RefreshCw size={14} className="animate-spin inline mr-1.5" />
          正在更新分析...
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center flex-1">
      <div className="text-[24px] font-bold font-mono" style={{ color: color || "#1C1917" }}>{value}</div>
      <div className="text-[11px] text-stone-400">{label}</div>
    </div>
  );
}

function Section({ icon: Icon, title, count, color, children }: {
  icon: any; title: string; count: number; color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}>
          {typeof Icon === "function" && Icon.length === 0 ? <Icon /> : <Icon size={12} style={{ color }} />}
        </div>
        <h2 className="text-[15px] font-semibold text-stone-900">{title}</h2>
        <span className="text-[11px] text-stone-400 ml-auto">{count} 个</span>
      </div>
      {children}
    </div>
  );
}

function EmptyState({ icon: Icon, title, desc, action }: {
  icon: any; title: string; desc: string; action?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center pt-16 text-center">
      <Icon size={48} className="text-stone-300 mb-4" strokeWidth={1.5} />
      <h2 className="text-[15px] font-semibold text-stone-900 mb-1">{title}</h2>
      <p className="text-[13px] text-stone-500 max-w-[280px]">{desc}</p>
      {action && (
        <span className="text-[13px] font-medium text-orange-500 mt-3 cursor-pointer hover:underline">{action}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/features/digest/RadarView.tsx src/features/digest/InsightCard.tsx src/features/digest/InsightDetail.tsx
git commit -m "feat: add RadarView, InsightCard, and InsightDetail components"
```

---

## Task 7: Navigation Update (App.tsx)

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update imports in App.tsx**

Replace `BookOpen` with `Target` in the lucide-react import:
```typescript
import { ClipboardList, Target, Database, Settings, Search } from "lucide-react";
```

Replace `DigestView` import:
```typescript
import { RadarView } from "./features/digest/RadarView";
```

- [ ] **Step 2: Update TABS array**

Change the digest tab:
```typescript
{ id: "digest", label: "雷达", icon: Target },
```

- [ ] **Step 3: Update tab content rendering**

Find where `activeTab === "digest"` renders `<DigestView />` and replace with `<RadarView />`.

- [ ] **Step 4: Verify the app compiles**

Run: `npm run build`
Expected: builds without errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: update navigation — rename digest to radar, swap icon and view"
```

---

## Task 8: Backend Unit Tests

**Files:**
- The tests are already in `src-tauri/src/ai/attention_analyzer.rs` (Task 3)

- [ ] **Step 1: Run all attention analyzer tests**

Run: `cd src-tauri && cargo test attention_analyzer -- --nocapture`
Expected: 5 tests pass.

- [ ] **Step 2: Run full cargo test to check for regressions**

Run: `cd src-tauri && cargo test`
Expected: all tests pass.

- [ ] **Step 3: Run cargo check on the whole project**

Run: `cd src-tauri && cargo check`
Expected: no errors.

---

## Task 9: Integration Verification

- [ ] **Step 1: Run the full build**

Run: `npm run build`
Expected: frontend builds without errors.

- [ ] **Step 2: Run tauri dev to test the app**

Run: `npx tauri dev`
Expected: app launches, "雷达" tab appears in navigation. Clicking it shows either an empty state (if no API key) or triggers analysis.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: integration fixes for attention radar"
```
