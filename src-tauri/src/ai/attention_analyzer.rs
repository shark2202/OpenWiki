use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

// --- Data Types (v2: Briefing) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefingTopic {
    pub id: String,
    pub rank: u32,
    pub insight_title: String,
    pub deep_analysis: String,
    pub key_findings: Vec<String>,
    pub suggestion: Option<String>,
    pub evidence_indices: Vec<usize>,
    pub content_count: u32,
    pub span_days: u32,
    pub trend: String,
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefingMeta {
    pub total_content: u32,
    pub window_days: u32,
    pub analysis_depth: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefingAnalysis {
    pub format_version: u32,
    pub topics: Vec<BriefingTopic>,
    pub meta: BriefingMeta,
}

// --- Prompt Builder (v2: Briefing) ---

/// Build system prompt and user message from content items.
/// Each item is (id, raw_text, source_url, captured_at).
/// Returns (system_prompt, user_message).
pub fn build_prompt(
    items: &[(String, Option<String>, Option<String>, String)],
) -> (String, String) {
    let count = items.len();
    let max_chars: usize = 500;

    let system_prompt = r#"你是用户的私人知识分析师。你的核心任务是：找到用户自己没注意到的联系和规律。

不要给出用户已经知道的信息（如"你关注了 AI"），而是找到令人惊讶的发现。

具体做法：
1. 找出用户最集中关注的 1-3 个方向（最多 3 个，如果没有明确方向就返回空的 topics 数组）
2. 对每个方向，找到跨内容的**意外发现**：
   - 两篇看似不相关的内容之间的隐藏联系
   - 用户无意识的行为模式（比如"你一直在围绕某个决定收集信息"）
   - 内容之间的矛盾或有趣对比
   - 不要复述每篇文章的内容，找到贯穿多篇的意外规律
3. 对排名第 1 的方向，给出一个具体可行动的建议（suggestion 字段），其他方向 suggestion 设为 null
4. 生成洞察性标题（不是主题名"AI 产品设计"，而是一个让人想点进去看的发现）

重要规则：
- 使用内容的**序号**（从 0 开始的 index）来引用内容，放在 evidence_indices 数组中
- topics 数组最多 3 个元素，按重要性排序（rank 1 最重要）
- 如果内容太分散没有明显方向，返回空的 topics 数组，这完全正常
- tag 只能是以下值之一："核心关注"、"次要关注"、"新兴关注"、"背景关注"
- trend 只能是以下值之一："growing"、"emerging"、"stable"、"fading"

请严格按以下 JSON 格式返回：
{
  "format_version": 2,
  "topics": [
    {
      "id": "topic_1",
      "rank": 1,
      "insight_title": "你保存的 3 篇文章指向了同一个你还没做的决定",
      "deep_analysis": "详细的跨内容分析段落...",
      "key_findings": ["发现1", "发现2", "发现3"],
      "suggestion": "具体可行动的建议...",
      "evidence_indices": [0, 3, 5, 7],
      "content_count": 12,
      "span_days": 9,
      "trend": "growing",
      "tag": "核心关注"
    }
  ],
  "meta": {
    "total_content": 42,
    "window_days": 14,
    "analysis_depth": "deep"
  }
}"#
        .to_string();

    let mut content_lines = Vec::with_capacity(count);
    for (i, (_id, raw_text, source_url, captured_at)) in items.iter().enumerate() {
        let text = raw_text.as_deref().unwrap_or("[无文本]");
        let truncated = truncate_str(text, max_chars);
        let url_part = source_url
            .as_deref()
            .map(|u| format!(" | 来源: {}", u))
            .unwrap_or_default();
        content_lines.push(format!(
            "[{}] (时间={}{}) {}",
            i, captured_at, url_part, truncated
        ));
    }

    let user_message = format!(
        "以下是用户最近 14 天收集的 {} 条内容，请深入分析并提炼洞察：\n\n{}",
        count,
        content_lines.join("\n\n")
    );

    (system_prompt, user_message)
}

fn truncate_str(s: &str, max_chars: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max_chars {
        s.to_string()
    } else {
        let truncated: String = chars[..max_chars].iter().collect();
        format!("{}...", truncated)
    }
}

// --- JSON Validator (v2: Briefing) ---

/// Parse and validate a BriefingAnalysis JSON string.
/// Filters out-of-bounds evidence indices and caps topics at 3.
pub fn validate_analysis(json_str: &str, item_count: usize) -> Result<BriefingAnalysis, String> {
    let cleaned = extract_json(json_str);

    let mut analysis: BriefingAnalysis = serde_json::from_str(&cleaned)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    // Cap topics at 3
    analysis.topics.truncate(3);

    // Filter out-of-bounds evidence indices
    for topic in &mut analysis.topics {
        topic.evidence_indices.retain(|&idx| idx < item_count);
    }

    Ok(analysis)
}

fn extract_json(s: &str) -> String {
    let trimmed = s.trim();
    // Check for ```json ... ``` blocks
    if let Some(start) = trimmed.find("```json") {
        let after_marker = &trimmed[start + 7..];
        if let Some(end) = after_marker.find("```") {
            return after_marker[..end].trim().to_string();
        }
    }
    // Check for ``` ... ``` blocks
    if let Some(start) = trimmed.find("```") {
        let after_marker = &trimmed[start + 3..];
        if let Some(end) = after_marker.find("```") {
            return after_marker[..end].trim().to_string();
        }
    }
    trimmed.to_string()
}

// --- API Caller ---

/// Supported provider for direct API calls
#[derive(Debug, Clone)]
pub enum AnalysisProvider {
    Anthropic,
    OpenAi,
    OpenRouter,
    DashScope,
}

impl AnalysisProvider {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "openai" => AnalysisProvider::OpenAi,
            "openrouter" => AnalysisProvider::OpenRouter,
            "dashscope" => AnalysisProvider::DashScope,
            _ => AnalysisProvider::Anthropic,
        }
    }
}

// --- Anthropic types (local to this module) ---

#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<ApiMessage>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ApiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    text: String,
}

// --- OpenAI types (local to this module) ---

#[derive(Debug, Serialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<ApiMessage>,
    max_tokens: u32,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
    /// DashScope Qwen3 series: disable thinking mode to save time and tokens
    #[serde(skip_serializing_if = "Option::is_none")]
    enable_thinking: Option<bool>,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: ApiMessage,
}

/// Call the AI API directly to perform attention analysis.
/// Returns the raw response text.
pub async fn call_analysis_api(
    provider: &AnalysisProvider,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let http_client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client 创建失败: {}", e))?;

    match provider {
        AnalysisProvider::Anthropic => {
            let body = AnthropicRequest {
                model: model.to_string(),
                max_tokens,
                system: system_prompt.to_string(),
                messages: vec![ApiMessage {
                    role: "user".to_string(),
                    content: user_message.to_string(),
                }],
            };

            let resp = http_client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Anthropic API 请求失败: {}", e))?;

            let status = resp.status();
            let text = resp
                .text()
                .await
                .map_err(|e| format!("读取 Anthropic 响应失败: {}", e))?;

            if !status.is_success() {
                return Err(format!("Anthropic API 错误 ({}): {}", status, text));
            }

            let parsed: AnthropicResponse = serde_json::from_str(&text)
                .map_err(|e| format!("解析 Anthropic 响应失败: {}", e))?;

            Ok(parsed
                .content
                .first()
                .map(|c| c.text.clone())
                .unwrap_or_default())
        }
        AnalysisProvider::OpenAi | AnalysisProvider::OpenRouter | AnalysisProvider::DashScope => {
            let url = match provider {
                AnalysisProvider::OpenRouter => {
                    "https://openrouter.ai/api/v1/chat/completions"
                }
                AnalysisProvider::DashScope => {
                    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
                }
                _ => "https://api.openai.com/v1/chat/completions",
            };

            let mut messages = Vec::new();
            if !system_prompt.is_empty() {
                messages.push(ApiMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                });
            }
            messages.push(ApiMessage {
                role: "user".to_string(),
                content: user_message.to_string(),
            });

            // Only include response_format for native OpenAI — OpenRouter and
            // DashScope models may not all support JSON mode
            let response_format = match provider {
                AnalysisProvider::OpenRouter | AnalysisProvider::DashScope => None,
                _ => Some(ResponseFormat {
                    format_type: "json_object".to_string(),
                }),
            };

            let enable_thinking = match provider {
                AnalysisProvider::DashScope => Some(false),
                _ => None,
            };

            let body = OpenAiRequest {
                model: model.to_string(),
                messages,
                max_tokens,
                temperature: 0.3,
                response_format,
                enable_thinking,
            };

            let mut req = http_client
                .post(url)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json");

            if matches!(provider, AnalysisProvider::OpenRouter) {
                req = req
                    .header("HTTP-Referer", "https://xiaoyun.app")
                    .header("X-Title", "Xiaoyun");
            }

            let resp = req
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("API 请求失败: {}", e))?;

            let status = resp.status();
            let text = resp
                .text()
                .await
                .map_err(|e| format!("读取 API 响应失败: {}", e))?;

            if !status.is_success() {
                return Err(format!("API 错误 ({}): {}", status, text));
            }

            let parsed: OpenAiResponse = serde_json::from_str(&text)
                .map_err(|e| format!("解析 API 响应失败: {}", e))?;

            Ok(parsed
                .choices
                .first()
                .map(|c| c.message.content.clone())
                .unwrap_or_default())
        }
    }
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid_briefing_json(evidence_indices: &[usize]) -> String {
        let indices_str = evidence_indices
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            r#"{{
  "format_version": 2,
  "topics": [
    {{
      "id": "topic_1",
      "rank": 1,
      "insight_title": "测试洞察标题",
      "deep_analysis": "测试深度分析",
      "key_findings": ["发现1", "发现2"],
      "suggestion": "测试建议",
      "evidence_indices": [{}],
      "content_count": 5,
      "span_days": 7,
      "trend": "growing",
      "tag": "核心关注"
    }}
  ],
  "meta": {{
    "total_content": 10,
    "window_days": 14,
    "analysis_depth": "deep"
  }}
}}"#,
            indices_str
        )
    }

    #[test]
    fn test_validate_analysis_valid() {
        let json = make_valid_briefing_json(&[0, 1, 2, 3]);
        let result = validate_analysis(&json, 5);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert_eq!(analysis.format_version, 2);
        assert_eq!(analysis.topics.len(), 1);
        assert_eq!(analysis.topics[0].evidence_indices.len(), 4);
    }

    #[test]
    fn test_validate_analysis_out_of_bounds() {
        let json = make_valid_briefing_json(&[0, 1, 5, 10]);
        let result = validate_analysis(&json, 3);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        // index 5 and 10 are out of bounds, only 0 and 1 survive
        assert_eq!(analysis.topics[0].evidence_indices.len(), 2);
        assert_eq!(analysis.topics[0].evidence_indices, vec![0, 1]);
    }

    #[test]
    fn test_validate_analysis_all_out_of_bounds() {
        let json = make_valid_briefing_json(&[5, 6, 7]);
        let result = validate_analysis(&json, 3);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(analysis.topics[0].evidence_indices.is_empty());
    }

    #[test]
    fn test_validate_analysis_invalid_json() {
        let result = validate_analysis("not json at all", 5);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("JSON 解析失败"));
    }

    #[test]
    fn test_validate_analysis_empty_topics() {
        let json = r#"{
            "format_version": 2,
            "topics": [],
            "meta": { "total_content": 10, "window_days": 14, "analysis_depth": "deep" }
        }"#;
        let result = validate_analysis(json, 5);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert!(analysis.topics.is_empty());
    }

    #[test]
    fn test_validate_analysis_caps_at_3_topics() {
        let json = r#"{
            "format_version": 2,
            "topics": [
                { "id": "t1", "rank": 1, "insight_title": "A", "deep_analysis": "", "key_findings": [], "suggestion": null, "evidence_indices": [0], "content_count": 1, "span_days": 1, "trend": "stable", "tag": "核心关注" },
                { "id": "t2", "rank": 2, "insight_title": "B", "deep_analysis": "", "key_findings": [], "suggestion": null, "evidence_indices": [1], "content_count": 1, "span_days": 1, "trend": "stable", "tag": "次要关注" },
                { "id": "t3", "rank": 3, "insight_title": "C", "deep_analysis": "", "key_findings": [], "suggestion": null, "evidence_indices": [2], "content_count": 1, "span_days": 1, "trend": "stable", "tag": "新兴关注" },
                { "id": "t4", "rank": 4, "insight_title": "D", "deep_analysis": "", "key_findings": [], "suggestion": null, "evidence_indices": [3], "content_count": 1, "span_days": 1, "trend": "stable", "tag": "背景关注" }
            ],
            "meta": { "total_content": 10, "window_days": 14, "analysis_depth": "deep" }
        }"#;
        let result = validate_analysis(json, 10);
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert_eq!(analysis.topics.len(), 3);
    }

    #[test]
    fn test_validate_analysis_markdown_wrapped() {
        let json = format!("```json\n{}\n```", make_valid_briefing_json(&[0, 1]));
        let result = validate_analysis(&json, 5);
        assert!(result.is_ok());
    }

    #[test]
    fn test_build_prompt_truncation() {
        // v2 uses fixed 500 char limit
        let items: Vec<(String, Option<String>, Option<String>, String)> = (0..5)
            .map(|i| {
                (
                    format!("id-{}", i),
                    Some("a".repeat(1000)),
                    Some(format!("https://example.com/{}", i)),
                    "2024-03-25".to_string(),
                )
            })
            .collect();

        let (system, user) = build_prompt(&items);
        assert!(!system.is_empty());
        assert!(user.contains("[0]"));
        assert!(user.contains("[4]"));
        assert!(user.contains(&"a".repeat(500)));
        assert!(!user.contains(&"a".repeat(501)));
    }

    #[test]
    fn test_build_prompt_no_text() {
        let items = vec![(
            "id-0".to_string(),
            None,
            None,
            "2024-03-25".to_string(),
        )];
        let (_system, user) = build_prompt(&items);
        assert!(user.contains("[无文本]"));
    }

    #[test]
    fn test_build_prompt_short_text_no_truncation() {
        let items = vec![(
            "id-0".to_string(),
            Some("短文本".to_string()),
            None,
            "2024-03-25".to_string(),
        )];
        let (_system, user) = build_prompt(&items);
        assert!(user.contains("短文本"));
        assert!(!user.contains("..."));
    }
}
