use crate::ai::client::AiClient;
use crate::ai::prompts::content_chat_system_prompt;
use crate::commands::capture::AppState;
use crate::storage::repository::Repository;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,   // "user" or "assistant"
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub reply: String,
}

/// Chat with AI about a piece of content.
/// Takes the article text, conversation history, and the new user message.
/// Returns the AI's reply.
#[tauri::command]
pub async fn chat_with_content(
    state: State<'_, AppState>,
    article_text: String,
    history: Vec<ChatMessage>,
    user_input: String,
) -> Result<ChatResponse, String> {
    let db = state.db.clone();
    let repo = Repository::new(db);

    // Read AI settings
    let provider = repo
        .get_setting("ai_provider")
        .map_err(|e| format!("读取 AI 提供商失败: {}", e))?
        .unwrap_or_else(|| "anthropic".to_string());

    let api_key = repo
        .get_setting(&format!("ai_api_key_{}", provider))
        .ok().flatten()
        .or_else(|| repo.get_setting("ai_api_key").ok().flatten())
        .unwrap_or_default();

    if api_key.is_empty() {
        return Err("请先在设置中配置 AI API Key".to_string());
    }

    let model = repo
        .get_setting("ai_model")
        .map_err(|e| format!("读取 AI 模型失败: {}", e))?
        .unwrap_or_else(|| "claude-haiku-4-5-20251001".to_string());

    // Truncate article text to avoid exceeding token limits
    let truncated_article = if article_text.len() > 15000 {
        format!("{}...\n\n[文章内容过长，已截断]", &article_text[..15000])
    } else {
        article_text
    };

    let system_prompt = content_chat_system_prompt(&truncated_article);

    // Build the user message with conversation history for context
    let user_message = if history.is_empty() {
        user_input
    } else {
        let mut parts = Vec::new();
        parts.push("以下是之前的对话记录：".to_string());
        for msg in &history {
            let role_label = if msg.role == "user" { "用户" } else { "助手" };
            parts.push(format!("{}: {}", role_label, msg.content));
        }
        parts.push(format!("\n用户的新问题: {}", user_input));
        parts.join("\n")
    };

    let client = AiClient::new(api_key, provider, model);
    let response = client
        .send_message(&system_prompt, &user_message)
        .await
        .map_err(|e| format!("AI 对话失败: {}", e))?;

    Ok(ChatResponse {
        reply: response.text,
    })
}

/// Get chat history for a content item.
#[tauri::command]
pub async fn get_chat_history(
    state: State<'_, AppState>,
    content_id: String,
) -> Result<Vec<ChatMessage>, String> {
    let db = state.db.clone();
    let repo = Repository::new(db);
    let messages = repo
        .get_chat_messages(&content_id)
        .map_err(|e| format!("读取聊天记录失败: {}", e))?;
    Ok(messages
        .into_iter()
        .map(|(role, content)| ChatMessage { role, content })
        .collect())
}

/// Save a single chat message for a content item.
#[tauri::command]
pub async fn save_chat_message(
    state: State<'_, AppState>,
    content_id: String,
    role: String,
    message: String,
) -> Result<(), String> {
    let db = state.db.clone();
    let repo = Repository::new(db);
    repo.save_chat_message(&content_id, &role, &message)
        .map_err(|e| format!("保存聊天记录失败: {}", e))
}

/// Clear all chat history for a content item.
#[tauri::command]
pub async fn clear_chat_history(
    state: State<'_, AppState>,
    content_id: String,
) -> Result<(), String> {
    let db = state.db.clone();
    let repo = Repository::new(db);
    repo.delete_chat_messages(&content_id)
        .map_err(|e| format!("清除聊天记录失败: {}", e))
}
