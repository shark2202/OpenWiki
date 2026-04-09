/// Prompt templates for wiki knowledge base operations.

/// System prompt for assessing whether content has knowledge value.
pub fn assessment_system_prompt() -> String {
    r#"你是「OpenWiki」知识库的守门人。你的任务是判断一条捕获的内容是否包含值得长期保存的知识。

## 判断标准（值得入库的）：
- 具体的概念、方法论、框架解释
- 人物、公司、产品的重要信息
- 技术原理、架构决策、实现细节
- 有深度的观点、分析、比较
- 教程、指南、最佳实践
- 数据、统计、研究发现
- 用户主动附加了备注（user_note），说明用户认为这条内容重要

## 判断标准（不值得入库的）：
- 纯粹的闲聊、情绪表达
- 临时性信息（天气、快递单号、验证码）
- 过短且无上下文的片段（少于 20 字且无 user_note）
- 纯代码片段（无解释上下文）
- 重复内容、广告

## 输出格式（纯 JSON，不要 markdown 代码块）：
{"should_compile":true,"knowledge_score":0.75,"reason":"简短判断理由（20字以内）"}"#
        .to_string()
}

/// User message for assessment.
pub fn assessment_user_message(
    content_type: &str,
    raw_text: &str,
    summary: &str,
    user_note: &str,
    source_url: &str,
    source_app: &str,
) -> String {
    let mut parts = Vec::new();
    parts.push(format!("内容类型: {}", content_type));
    parts.push(format!("来源应用: {}", source_app));
    if !source_url.is_empty() {
        parts.push(format!("来源URL: {}", source_url));
    }
    if !user_note.is_empty() {
        parts.push(format!("用户备注: {}", user_note));
    }
    if !summary.is_empty() {
        parts.push(format!("AI摘要: {}", summary));
    }
    if !raw_text.is_empty() {
        let truncated: String = raw_text.chars().take(2000).collect();
        parts.push(format!("原文（前2000字）:\n{}", truncated));
    }
    parts.join("\n\n")
}

/// System prompt for the discovery stage of compilation (Stage 1).
/// Given new content + existing page index, decide which pages to create/update.
pub fn compile_discover_system_prompt() -> String {
    r#"你是「OpenWiki」知识库的编辑。你的任务是分析一条新内容，决定需要创建或更新哪些知识页面。

## 页面类型：
- concept: 概念、方法论、技术原理（如"RAG技术"、"间歇性断食"）
- entity: 人物、公司、产品、项目（如"Karpathy"、"OpenAI"）
- source: 信息来源的结构化笔记（某篇文章、某本书）
- comparison: 对比分析（A vs B）
- overview: 领域综述、主题汇总

## 核心原则：
- 优先更新已有页面，只在确实需要时创建新页面
- 一条内容通常触及 1-5 个页面
- 不要为琐碎信息创建页面

## 输出格式（纯 JSON，不要 markdown 代码块）：
{
  "creates": [
    {"title":"页面标题","page_type":"concept","reason":"为什么需要新建"}
  ],
  "updates": [
    {"page_id":"已有页面ID","title":"页面标题","reason":"为什么需要更新"}
  ]
}"#
    .to_string()
}

/// User message for the discovery stage.
pub fn compile_discover_user_message(
    content_text: &str,
    content_summary: &str,
    content_tags: &str,
    user_note: &str,
    existing_pages: &[(String, String, String)], // (id, title, summary)
) -> String {
    let mut parts = Vec::new();

    // New content
    parts.push("=== 新内容 ===".to_string());
    if !content_summary.is_empty() {
        parts.push(format!("摘要: {}", content_summary));
    }
    if !content_tags.is_empty() {
        parts.push(format!("标签: {}", content_tags));
    }
    if !user_note.is_empty() {
        parts.push(format!("用户备注: {}", user_note));
    }
    let truncated: String = content_text.chars().take(3000).collect();
    parts.push(format!("全文:\n{}", truncated));

    // Existing pages index
    parts.push("\n=== 现有知识页面索引 ===".to_string());
    if existing_pages.is_empty() {
        parts.push("（知识库为空，这是第一条内容）".to_string());
    } else {
        for (id, title, summary) in existing_pages {
            let s = if summary.is_empty() {
                format!("[{}] {}", id, title)
            } else {
                format!("[{}] {} — {}", id, title, summary)
            };
            parts.push(s);
        }
    }

    parts.join("\n")
}

/// System prompt for the execute stage of compilation (Stage 2).
/// Generate or update a single wiki page with full context.
pub fn compile_execute_system_prompt() -> String {
    r##"你是「OpenWiki」知识库的编辑。你的任务是基于新内容来创建或更新一个知识页面。

## 核心原则：
- 你是编辑，不是作者——所有知识必须来源于提供的内容，不要发明信息
- 如果是更新已有页面，保留已有内容中仍然有效的部分，整合新信息
- 如果是更新已有页面，注意多来源聚合：不要只反映最新一条内容，要综合所有来源
- 用中文写作，专有名词保留原文
- Markdown 格式，结构清晰（标题、列表、重点加粗）
- 页面应该自包含，读者不需要看原始内容就能理解

## 输出格式（纯 JSON，不要 markdown 代码块）：
{
  "title": "页面标题",
  "page_type": "concept",
  "body_markdown": "完整的页面内容，Markdown格式",
  "summary": "一句话摘要，30字以内",
  "tags": ["标签1", "标签2"],
  "edges": [
    {"target_title": "相关页面标题", "relation": "related"}
  ]
}"##
    .to_string()
}

/// User message for execute stage — creating a new page.
pub fn compile_execute_create_message(
    content_text: &str,
    content_summary: &str,
    user_note: &str,
    title: &str,
    page_type: &str,
) -> String {
    let truncated: String = content_text.chars().take(4000).collect();
    let mut parts = vec![
        format!("操作: 创建新页面"),
        format!("标题: {}", title),
        format!("类型: {}", page_type),
    ];
    if !content_summary.is_empty() {
        parts.push(format!("内容摘要: {}", content_summary));
    }
    if !user_note.is_empty() {
        parts.push(format!("用户备注: {}", user_note));
    }
    parts.push(format!("\n原文:\n{}", truncated));
    parts.join("\n")
}

/// User message for execute stage — updating an existing page.
pub fn compile_execute_update_message(
    content_text: &str,
    content_summary: &str,
    user_note: &str,
    existing_body: &str,
    existing_title: &str,
    active_source_count: usize,
    stale_source_count: usize,
) -> String {
    let content_truncated: String = content_text.chars().take(3000).collect();
    let body_truncated: String = existing_body.chars().take(4000).collect();
    let mut parts = vec![
        format!("操作: 更新已有页面「{}」", existing_title),
        format!("当前来源状态: {} 个活跃来源, {} 个过时来源", active_source_count, stale_source_count),
    ];
    if !content_summary.is_empty() {
        parts.push(format!("新内容摘要: {}", content_summary));
    }
    if !user_note.is_empty() {
        parts.push(format!("用户备注: {}", user_note));
    }
    parts.push(format!("\n新内容原文:\n{}", content_truncated));
    parts.push(format!("\n当前页面正文:\n{}", body_truncated));
    parts.push("\n请基于新内容更新页面，保留已有内容中仍然有效的部分。".to_string());
    parts.join("\n")
}

/// System prompt for Q&A stage 1: retrieve relevant page IDs from index.
pub fn query_retrieve_system_prompt() -> String {
    r#"你是「OpenWiki」知识库的检索助手。用户提出一个问题，你需要从知识库页面索引中找出相关的页面。

## 任务：
- 从下方的页面索引中，找出与问题相关的页面
- 理解语义关联，不要只做关键词匹配（如"巴菲特的投资理念"应该匹配"投资第一性原理"）
- 最多返回 5 个最相关的页面 ID
- 如果没有任何相关页面，返回空数组

## 输出格式（纯 JSON，不要 markdown 代码块）：
{"page_ids": ["id1", "id2"]}"#
        .to_string()
}

/// User message for Q&A stage 1: retrieval.
pub fn query_retrieve_user_message(
    question: &str,
    conversation_context: &str,
    page_index: &[(String, String, String)], // (id, title, summary)
) -> String {
    let mut parts = Vec::new();
    if !conversation_context.is_empty() {
        parts.push(format!("对话上下文:\n{}", conversation_context));
    }
    parts.push(format!("问题: {}", question));
    parts.push("\n=== 知识库页面索引 ===".to_string());
    if page_index.is_empty() {
        parts.push("（知识库为空）".to_string());
    } else {
        for (id, title, summary) in page_index {
            parts.push(format!("[{}] {} — {}", id, title, summary));
        }
    }
    parts.join("\n")
}

/// System prompt for Q&A stage 2: answer the question.
pub fn query_answer_system_prompt() -> String {
    r##"你是「OpenWiki」知识库的问答助手。用户根据自己积累的知识库向你提问。

## 核心原则：
- 你会收到两部分知识库内容：
  1. 「相关知识页面」：与问题直接相关的页面全文（如果有的话）
  2. 「知识库概览」：所有页面的标题和摘要索引，帮你了解用户知识库的全貌
- 优先使用「相关知识页面」的全文回答具体问题
- 对于综合性问题（如"我关注什么"、"最重要的事"），结合「知识库概览」进行全局分析
- 引用知识库内容时标注来源页面标题（如"根据「RAG技术」页面..."）
- 如果用自己的知识补充，标注"[AI 补充]"
- 用中文回答，简洁清晰，Markdown 格式

## 输出格式（纯 JSON，不要 markdown 代码块）：
{
  "answer": "回答内容（Markdown格式）",
  "page_ids_used": ["实际引用的页面ID"],
  "source_mode": "knowledge_base 或 mixed 或 ai_only",
  "confidence": 0.8
}

source_mode 取值：
- "knowledge_base": 回答完全基于知识库内容
- "mixed": 主要基于知识库，部分由 AI 补充
- "ai_only": 知识库无相关内容，完全由 AI 回答"##
    .to_string()
}

/// User message for Q&A stage 2: answer with full page content + overview.
pub fn query_answer_user_message(
    question: &str,
    conversation_context: &str,
    relevant_pages: &[(String, String, String)], // (id, title, body_markdown)
    page_overview: &[(String, String, String)],  // (id, title, summary) — all pages
) -> String {
    let mut parts = Vec::new();
    if !conversation_context.is_empty() {
        parts.push(format!("对话上下文:\n{}", conversation_context));
    }
    parts.push(format!("问题: {}", question));

    // Detailed content of specifically retrieved pages
    if !relevant_pages.is_empty() {
        parts.push("\n=== 相关知识页面（全文） ===".to_string());
        let mut budget = 8000i64;
        for (id, title, body) in relevant_pages {
            if budget <= 0 { break; }
            let take = (budget as usize).min(body.chars().count());
            let body_truncated: String = body.chars().take(take).collect();
            parts.push(format!("\n--- [{}] {} ---\n{}", id, title, body_truncated));
            budget -= body_truncated.len() as i64;
        }
    }

    // Overview of entire knowledge base
    if !page_overview.is_empty() {
        parts.push("\n=== 知识库概览（全部页面标题与摘要） ===".to_string());
        for (id, title, summary) in page_overview {
            if summary.is_empty() {
                parts.push(format!("[{}] {}", id, title));
            } else {
                parts.push(format!("[{}] {} — {}", id, title, summary));
            }
        }
    } else {
        parts.push("\n（知识库为空）".to_string());
    }

    parts.join("\n")
}

/// System prompt for query rewriting (multi-turn).
pub fn query_rewrite_system_prompt() -> String {
    r#"你是查询改写助手。用户在对话中提出了一个后续问题，这个问题可能依赖之前的对话上下文。
请将这个问题改写为一个独立的、完整的搜索查询，使其无需上下文也能被理解。
只返回改写后的查询文本，不要JSON，不要解释。"#
        .to_string()
}

/// User message for query rewriting.
pub fn query_rewrite_user_message(
    current_question: &str,
    recent_turns: &str,
) -> String {
    format!(
        "最近的对话:\n{}\n\n用户的后续问题: {}\n\n请将这个后续问题改写为独立的搜索查询：",
        recent_turns, current_question
    )
}

/// System prompt for wiki lint — health check.
pub fn lint_system_prompt() -> String {
    r#"你是「OpenWiki」知识库的健康检查员。你的任务是检查知识库的一致性和完整性。

## 检查项：
- 矛盾：不同页面之间是否有相互矛盾的说法
- 知识空白：现有主题中是否有明显缺失的子主题或关联概念
- 过时风险：哪些页面的内容可能已经过时（基于领域常识判断）

## 输出格式（纯 JSON，不要 markdown 代码块）：
{
  "findings": [
    {
      "lint_type": "contradiction|gap|stale",
      "severity": "info|warning|critical",
      "title": "问题标题",
      "description": "问题描述",
      "page_ids": ["涉及的页面ID"]
    }
  ]
}"#
    .to_string()
}

/// User message for lint.
pub fn lint_user_message(
    pages: &[(String, String, String, String)], // (id, title, summary, page_type)
) -> String {
    let mut parts = vec!["=== 知识库全部页面 ===".to_string()];
    for (id, title, summary, page_type) in pages {
        parts.push(format!("[{}] ({}) {} — {}", id, page_type, title, summary));
    }
    parts.join("\n")
}
