# Changelog

本文件记录 OpenWiki 的版本变化。

## [0.1.4] - 2026-04-11

### 新增

- **自动化权限预告弹窗** — 首次启动时弹出一个友好的中文对话框，解释为什么需要「自动化」权限（识别剪贴板来源 App），让用户有心理准备再触发系统的授权对话框。告别"想要控制 System Events"的生硬提示
- **Info.plist 中文描述** — 即使系统弹窗意外先触发，它显示的解释也是我们写的中文文案，而非 macOS 默认的警告语
- **设置页「诊断」分类** — 显示当前自动化权限状态（已授权 / 被拒绝 / 未设置），提供「开始授权」「重新授权」「打开系统设置」按钮
- **权限拒绝红色横幅** — 如果用户点了系统弹窗的「不允许」，主窗口顶部自动出现红色横幅，一键跳转到系统设置的自动化面板修复
- **授权成功绿色 Toast** — 右下角短暂显示"授权成功，以后剪贴板会显示内容来源应用"

### 技术细节

- 新增 `src-tauri/src/automation/mod.rs`：权限状态机 (unknown/granted/denied/dismissed)、probe_status 探针、4 个 Tauri 命令
- 新增 `src-tauri/Info.plist` 通过 `bundle.macOS.infoPlist` 配置自动合并到 app bundle
- 前端新增 `PreAuthModal`、`AutomationNotices`（复用横幅架构）、`automationService.ts`
- 状态持久化到现有 `app_settings` 表的两个 key：`automation.initial_prompt_shown` / `automation.last_status`

## [0.1.3] - 2026-04-11

### 新增

- **应用内更新提醒** — 启动时静默查询 GitHub Releases 最新版。发现新版时在主窗口顶部显示橙色横幅（OpenWiki vX.Y.Z 已发布 + 查看更新/稍后），点「查看更新」跳浏览器到 Release 页。所有失败（网络/API/解析）静默处理，永不打扰用户
- **设置页 → 软件更新分类** — 显示当前版本 / 最新版本，「启动时自动检查更新」开关（默认开），「立即检查更新」按钮绕过忽略状态始终反馈，「查看发布记录」跳转 GitHub Releases

### 技术细节

- 新增 `src-tauri/src/update/mod.rs`：GitHub API 轮询、semver 解析、14 个单元测试覆盖版本对比边界
- 设置持久化到现有 `app_settings` 表（key: `update.check_enabled` / `update.dismissed_version`）
- 用户点「稍后」后只忽略这一个版本号，下个版本发布时仍会提醒
- 无需额外密钥、无需 CI 变更、GitHub API 免认证 60 次/小时限额足够覆盖所有用户

### 修复

- 设置页侧边栏的版本号不再硬编码为 `v0.1.0`，改为从后端读取

## [0.1.2] - 2026-04-11

本次发布聚焦「下载即用」——去掉安装过程中对开发工具的依赖，让非技术用户也能顺利装上。

### 改进

- **OCR 预编译** — Swift OCR 辅助程序改为在构建时预编译并打包进 `.app`，用户不再需要安装 Xcode Command Line Tools（原先 OCR 首次使用会在用户机器上调用 `swiftc` 编译）
- **Ad-hoc 代码签名** — 应用现在使用 Ad-hoc 签名。用户首次打开不再看到「已损坏，无法打开」的死锁提示，改为可通过右键→打开 / 系统设置→仍要打开 放行一次即可
- **DMG 自定义背景** — 打开 DMG 后直接看到安装指引（拖入 Applications + 首次打开提示），不用再看文档
- **Release 说明重写** — GitHub Release 的安装说明同步更新，去掉了 `xattr -cr` 终端命令步骤

### 未变的外部依赖

- YouTube 字幕功能仍依赖用户系统上安装的 `yt-dlp` 和 Node.js（将在后续版本改为自动下载）

## [0.1.1] - 2026-04-10

### 新增

- **国际化（i18n）** — 前端和 Rust 错误提示接入 i18next/本地化，支持中英文切换
- **GitHub Actions 自动发版流程** — 推送 `v*` tag 自动构建 Apple Silicon + Intel 双版本并创建 Release

### 修复

- 内容摘要、标签、消化状态、URL 抓取的 locale 适配
- AI 客户端、Provider API 模块中的硬编码中文翻译

## [0.1.0] - 2026-04-10

首次开源发布 🎉

### 核心功能

- **剪贴板捕获** — 后台监听剪贴板，自动保存文本、图片、URL，识别来源应用
- **Spotlight 快捷捕获** — `⌘⇧C` 全局快捷键呼出浮窗，快速标注并保存
- **内容管理** — 按类型/时间过滤，全局搜索，日历时间线视图
- **Markdown 导出** — 按天/按范围/全量导出为 Markdown 文件

### AI 知识库

- **Wiki 编译引擎** — AI 自动将捕获内容编译为结构化知识页面（概念、实体、主题）
- **知识图谱** — D3 力导向图可视化，展示知识之间的关联
- **Ask Q&A** — 3 阶段检索 + 多轮对话，向知识库提问
- **标签关联** — NLP 自动标签 + 双向 edge 链接
- **Lint 健康检查** — 检测孤立页面、断裂链接等结构问题

### 深度洞察

- **AI 周报** — 一键生成本周内容总结，自动归类提炼
- **7 维度注意力分析** — 一瞥总览、潜意识、遗忘墓地、盲区、热点、热力图、行动建议
- **反馈学习** — 点赞/忽略内容，AI 学习用户偏好

### AI 提供商

- **Anthropic (Claude)** — API Key 接入
- **OpenAI** — API Key + OAuth (Codex) 双模式
- **Google Gemini** — API Key + OAuth (Antigravity) 双模式
- **Auto 智能选模** — 摘要用快速模型，洞察用高级模型

### URL 内容抓取

- 微信公众号文章正文提取
- X/Twitter 内容提取
- YouTube 字幕抓取（via yt-dlp）
- 通用网页正文提取（via Jina Reader）

### 桌面体验

- 系统托盘常驻 + 后台静默运行
- `⌘⇧Y` 全局快捷键唤起主窗口
- 深色/浅色/跟随系统主题
- MCP 协议集成（Claude Desktop / OpenClaw）
