# 雷达 v2 重构任务

## 目标
将小云的雷达功能从"3 个 topic 卡片"改为"7 板块单页滚动报告"，使用已验证的 Phase 2 prompt，支持 DashScope 流式 + thinking 模式。

## 参考文件
- 已验证的 prompt 设计：`/Users/richbook/clawd/xiaoyun-radar-v2-prompt.md`（Phase 2 部分）
- 已验证的千问真实输出：`/tmp/radar-dashscope-report.json`
- 已验证的 HTML 模板效果：`/Users/richbook/clawd/radar-qwen-real.html`
- 设计系统：`DESIGN.md`（warm gray + orange #F97316，Cabinet Grotesk / Plus Jakarta Sans / JetBrains Mono）

## 改动范围

### 🦀 Rust 后端

#### 1. `src-tauri/src/storage/repository.rs` — 扩展数据获取
- `get_recent_content_for_analysis()` 增加返回字段：`summary, tags, user_note, source_app, content_type`
- 用一个结构体 `ContentForAnalysis` 代替现在的 4 元组
- 加一个 `get_content_stats()` 方法，在 Rust 端计算 stats（来源分布、时段分布、类型分布、标注率等）传给 AI

#### 2. `src-tauri/src/ai/attention_analyzer.rs` — 核心改动

**新增数据结构**（对应 /tmp/radar-dashscope-report.json 的 schema）：
```rust
pub struct RadarReport {
    pub meta: RadarMeta,
    pub at_a_glance: Vec<Glance>,
    pub info_diet: InfoDiet,
    pub subconscious: Vec<SubconsciousItem>,
    pub graveyard: Graveyard,
    pub blind_spots: Vec<BlindSpot>,
    pub actions: Vec<Action>,
    pub heatmap: Vec<HeatmapDay>,
    pub topic_cloud: Vec<TopicItem>,
    pub verdict: Verdict,
    pub footer: Footer,
}
```

**新增 `build_prompt_v2()`**：
- 输入：`Vec<ContentForAnalysis>` + stats
- 用 `/Users/richbook/clawd/xiaoyun-radar-v2-prompt.md` 里的 Phase 2 System Prompt
- user message 格式：`{ "stats": {...}, "items": [...] }`
- 每个 item 包含：date, time, source, type, summary(可选), tags(可选), user_note(可选), content_excerpt(截断 500 字)

**改造 `call_analysis_api()`**：
- DashScope provider 改为**流式调用**（SSE），因为 DashScope 要求 `stream: true` 才能用 `enable_thinking: true`
- 需要加 `reqwest-eventsource` 或手动解析 SSE
- 其他 provider（Anthropic/OpenAI/OpenRouter）保持非流式不变
- DashScope 参数：`temperature: 0.7, enable_thinking: true, max_tokens: 8192, stream: true`
- 其他 provider 参数不变

**新增 `validate_radar_report()`**：
- 解析 RadarReport JSON
- 校验必需字段存在

**保留旧代码**：旧的 `BriefingAnalysis`, `build_prompt()`, `validate_analysis()` 标记 `#[deprecated]` 但保留

#### 3. `src-tauri/src/commands/attention.rs` — 适配新流程
- `trigger_attention_analysis()` 调用 `build_prompt_v2` + 新的 API 调用
- 存入 `analysis_json` 时存新版 RadarReport JSON
- 可选：增加 `attention-analysis-progress` 事件（"thinking" / "generating"）

### ⚛️ 前端

#### 4. `src/services/radarService.ts` — 新类型
新增 `RadarReport` TypeScript 类型，对应 Rust 的 RadarReport 结构。保留旧的 `BriefingAnalysis` 类型。

#### 5. `src/stores/radarStore.ts` — 适配
- `normalizeAnalysis()` 增加 v3 检测（有 `at_a_glance` 字段 → v3 RadarReport）
- store 里存 `report: RadarReport | null` 代替旧的 `analysis`
- 去掉 `selectedTopicIndex`（不需要详情页了）

#### 6. `src/features/digest/RadarView.tsx` — **重写**
从 Hero+Grid 改为单页滚动报告，板块依次展示：

1. **Header** — 标题 + meta 信息 + 刷新按钮
2. **AtAGlance** — 3 条洞察高亮卡片（highlight 关键词用 orange 标注）
3. **InfoDiet** — 来源分布条形图 + 深浅比 + 主题偏食度 + 语言比
4. **Subconscious** — 3-4 条潜意识发现（标题 + 正文 + 证据数）
5. **Graveyard** — 坟场预警 + 3 条值得重读的内容（带重读问题引导）
6. **BlindSpots** — 3 条知识盲区
7. **Actions** — 3 条具体行动建议（带 emoji icon + 时间估算）
8. **Heatmap** — 日期热力图（16 天）
9. **TopicCloud** — 主题分布条形图
10. **Verdict** — 一句话终审判决（高亮关键词）
11. **Footer** — 统计数字

**设计要点**：
- 遵循 DESIGN.md：warm gray 背景，orange 强调色，无 emoji 装饰（actions.icon 除外）
- 卡片用 `var(--color-surface)` 背景 + `var(--color-border)` 边框
- 标题用 Cabinet Grotesk，正文 Plus Jakarta Sans，数据 JetBrains Mono
- 板块间距 `mb-6`，卡片圆角 `rounded-xl`（12px）
- 保留 loading skeleton、empty states（no_api_key, not_enough_content）、error state
- 保留刷新按钮和自动触发逻辑

#### 7. `src/features/digest/InsightDetail.tsx`
- 保留文件但不再从 RadarView 引用（旧版兼容）

### Cargo.toml
- 添加 `reqwest-eventsource = "0.6"` 依赖（用于 DashScope SSE 流式）
- 或者如果不想加依赖，可以手动用 reqwest 的 `.bytes_stream()` 解析 SSE `data:` 行

## 不要改的东西
- DB 表结构（`attention_insights` 不变）
- 设置页
- 其他 tab（内容、设置）
- `src/features/digest/DigestCard.tsx` 和 `DigestView.tsx`

## 质量要求
- Rust 代码通过 `cargo check`
- 前端通过 `npx tsc --noEmit`
- 新的 Rust 数据结构必须有 Serialize + Deserialize
- 前端组件保持 DESIGN.md 风格一致性
