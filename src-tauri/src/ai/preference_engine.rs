use crate::storage::database::Database;
use crate::storage::repository::Repository;
use std::collections::HashMap;
use std::sync::Arc;

/// Common Chinese stop words to filter out during keyword extraction.
const CHINESE_STOP_WORDS: &[&str] = &[
    "的",
    "了",
    "在",
    "是",
    "我",
    "有",
    "和",
    "就",
    "不",
    "人",
    "都",
    "一",
    "一个",
    "上",
    "也",
    "很",
    "到",
    "说",
    "要",
    "去",
    "你",
    "会",
    "着",
    "没有",
    "看",
    "好",
    "自己",
    "这",
    "他",
    "她",
    "它",
    "们",
    "那",
    "些",
    "什么",
    "怎么",
    "如何",
    "为什么",
    "可以",
    "能",
    "但",
    "但是",
    "而",
    "而且",
    "或",
    "或者",
    "如果",
    "因为",
    "所以",
    "虽然",
    "然后",
    "还",
    "又",
    "再",
    "已经",
    "正在",
    "将",
    "把",
    "被",
    "让",
    "给",
    "从",
    "向",
    "对",
    "于",
    "以",
    "为",
    "与",
    "及",
    "等",
    "中",
    "里",
    "外",
    "内",
    "前",
    "后",
    "左",
    "右",
    "大",
    "小",
    "多",
    "少",
    "长",
    "短",
    "高",
    "低",
    "新",
    "旧",
    "这个",
    "那个",
    "这些",
    "那些",
    "其他",
    "另外",
    "之",
    "其",
    "次",
    "第",
    "更",
    "最",
    "比",
    "非常",
    "十分",
    "特别",
    "相当",
    "越来越",
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "need",
    "must",
    "ought",
    "dare",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "and",
    "or",
    "but",
    "not",
    "no",
    "nor",
    "so",
    "yet",
    "both",
    "either",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "he",
    "she",
    "they",
    "we",
];

/// When user marks content as "interested", extract keywords/topics from the
/// content text and update their preference weights in the database.
pub fn update_preferences(
    db: Arc<Database>,
    content_id: &str,
    feedback: &str,
) -> Result<(), String> {
    let repo = Repository::new(db.clone());

    // Get the content item
    let content = repo
        .get_content_by_id(content_id)
        .map_err(|e| format!("获取内容失败: {}", e))?
        .ok_or_else(|| format!("未找到内容: {}", content_id))?;

    let raw_text = content.raw_text.unwrap_or_default();
    if raw_text.is_empty() {
        log::info!(
            "Content {} has no text, skipping preference update",
            content_id
        );
        return Ok(());
    }

    // Determine weight delta based on feedback type
    let weight_delta = match feedback {
        "interested" | "bookmarked" => 1.0,
        "dismissed" => -0.5,
        _ => 0.0,
    };

    if weight_delta == 0.0 {
        return Ok(());
    }

    // Extract keywords from the content
    let keywords = extract_keywords(&raw_text);

    log::info!(
        "Extracted {} keywords from content {}: {:?}",
        keywords.len(),
        content_id,
        keywords
    );

    // Update each keyword as a topic preference
    for keyword in &keywords {
        if let Err(e) = repo.update_preference(keyword, weight_delta) {
            log::error!("更新偏好失败 ({}): {}", keyword, e);
        }
    }

    Ok(())
}

/// Build a text summary of the user's top interests for inclusion in prompts.
pub fn get_preference_summary(db: Arc<Database>) -> String {
    let repo = Repository::new(db);

    let preferences = match repo.get_all_preferences() {
        Ok(prefs) => prefs,
        Err(e) => {
            log::error!("获取用户偏好失败: {}", e);
            return String::new();
        }
    };

    if preferences.is_empty() {
        return String::new();
    }

    // Take top 10 preferences with positive weight
    let top_prefs: Vec<_> = preferences
        .into_iter()
        .filter(|p| p.weight > 0.0)
        .take(10)
        .collect();

    if top_prefs.is_empty() {
        return String::new();
    }

    let mut summary = String::from("用户感兴趣的主题（按权重排序）：\n");
    for pref in &top_prefs {
        summary.push_str(&format!(
            "- {} (权重: {:.1}, 出现: {}次)\n",
            pref.topic, pref.weight, pref.occurrence_count
        ));
    }

    summary
}

/// Simple keyword extraction: tokenize by common delimiters,
/// filter stop words, and return keywords that appear with notable frequency.
fn extract_keywords(text: &str) -> Vec<String> {
    let stop_words: std::collections::HashSet<&str> = CHINESE_STOP_WORDS.iter().copied().collect();

    // Split by common delimiters: spaces, punctuation, newlines
    let delimiters: &[char] = &[
        ' ', '\t', '\n', '\r', '，', '。', '！', '？', '；', '：', '"', '"', '（', '）', '【',
        '】', '《', '》', '、', '·', '…', '—', '\u{3000}', ',', '.', '!', '?', ';', ':', '"', '\'',
        '(', ')', '[', ']', '{', '}', '<', '>', '/', '\\', '|', '-', '_', '+', '=', '#', '@', '&',
        '*', '^', '~', '`',
    ];

    let tokens: Vec<&str> = text
        .split(|c: char| delimiters.contains(&c) || c.is_ascii_whitespace())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    // Count frequencies, filtering out stop words and very short tokens
    let mut freq: HashMap<String, usize> = HashMap::new();
    for token in &tokens {
        let lower = token.to_lowercase();
        // Skip if it's a stop word
        if stop_words.contains(lower.as_str()) {
            continue;
        }
        // Skip single ASCII characters or tokens that are purely digits
        if lower.len() == 1 && lower.is_ascii() {
            continue;
        }
        if lower.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        // For Chinese text, skip single characters (too generic)
        let char_count = lower.chars().count();
        if char_count < 2 {
            continue;
        }

        *freq.entry(lower).or_insert(0) += 1;
    }

    // Sort by frequency descending, take top keywords
    let mut keywords: Vec<(String, usize)> = freq.into_iter().collect();
    keywords.sort_by(|a, b| b.1.cmp(&a.1));

    // Return top 5-10 keywords
    keywords
        .into_iter()
        .take(10)
        .map(|(word, _)| word)
        .collect()
}
