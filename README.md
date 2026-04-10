<p align="center">
  <img src="docs/banner.svg" alt="OpenWiki Banner" width="100%"/>
</p>

<p align="center">
  <a href="https://github.com/kdsz001/xiaoyun/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-F97316?style=flat-square" alt="License"></a>
  <a href="https://github.com/kdsz001/xiaoyun/releases"><img src="https://img.shields.io/github/v/release/kdsz001/xiaoyun?style=flat-square&color=F97316" alt="Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS-F97316?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/PRs-welcome-F97316?style=flat-square" alt="PRs Welcome">
</p>

<p align="center">
  复制任何内容 → 桌面弹出浮窗 → 选择收藏 → AI 自动整理成知识库<br>
  <b>你决定留什么，AI 帮你理清楚。</b>
</p>

<p align="center">
  隐私优先 — 所有数据存储在本地 SQLite，不上传任何云端。
</p>

## 📸 截图

| 内容捕获 | 知识库 |
|:---:|:---:|
| ![内容](docs/screenshots/content.png) | ![知识库](docs/screenshots/wiki.png) |

| 知识图谱 | 深度洞察 |
|:---:|:---:|
| ![图谱](docs/screenshots/graph.png) | ![洞察](docs/screenshots/insights.png) |

## 核心功能

### 📋 捕获浮窗
- 复制内容时桌面弹出浮窗（默认 10 秒后消失）
- **只有你主动选择收藏的内容才会保存**，不会偷偷囤积
- 支持文本、图片、URL，自动识别来源应用
- 支持抓取微信公众号、X/Twitter 等 URL 的正文内容
- `⌘⇧C` 全局快捷键可随时手动呼出捕获窗口

### 📂 内容管理
- 按类型（文本 / 图片 / 链接）和时间范围过滤
- 全局搜索，跨内容和知识库同时检索
- 日历时间线视图，按天浏览历史
- 一键导出为 Markdown 文件

### 🧠 AI 知识库
- AI 自动将捕获内容编译为 Wiki 页面（概念、实体、主题）
- 知识图谱可视化，看见概念之间的关联
- **Ask 侧栏** — 向你的知识库提问，AI 基于你的内容回答
- 自动检测孤立页面、断裂链接等结构问题

### 📊 洞察报告
- 一键生成 AI 周报，汇总本周捕获内容
- **注意力分析** — 7 维度洞察你的信息习惯：
    - 一瞥总览 / 潜意识 / 遗忘墓地 / 盲区 / 热点 / 热力图 / 行动建议
- 对报告内容点赞或忽略，AI 学习你的偏好

### ⚙️ AI 提供商
- 支持 **Anthropic (Claude)** / **OpenAI** / **Google Gemini**
- API Key 或 OAuth 登录，两种接入方式
- 可为每个提供商选择不同模型

### 🖥 桌面体验
- 系统托盘常驻，关闭窗口不退出
- 全局快捷键 `⌘⇧Y` 唤起主窗口
- 深色 / 浅色 / 跟随系统主题
- MCP 协议集成，可连接 Claude Desktop

## 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | Tauri 2 |
| 前端 | React 19 + TypeScript |
| 样式 | Tailwind CSS 4 |
| 状态 | Zustand |
| 动效 | Framer Motion |
| 后端 | Rust |
| 存储 | SQLite (本地) |

## 下载安装

🍏 macOS (Apple Silicon): 下载下方的 `OpenWiki_0.1.0_aarch64.dmg`

👉 [前往 Release 页面下载](https://github.com/kdsz001/xiaoyun/releases)

### ⚠️ 首次打开指南（重要）

由于应用未经 Apple 签名，macOS 会拦截。请按以下步骤操作：

1. 打开 `.dmg`，将 OpenWiki 拖入「应用程序」文件夹
2. 第一次打开时会弹窗提示"无法打开"——**这是正常的**，点击「好」关掉弹窗
3. 打开 **系统设置 → 隐私与安全性**，向下滚动找到"已阻止使用 OpenWiki"，点击「仍要打开」
4. 再次确认后即可正常使用，以后不会再弹窗

### 已知的外部依赖

以下功能需要额外安装工具，不影响其他功能使用：

| 功能 | 需要安装 | 安装方式 |
|---|---|---|
| YouTube 字幕抓取 | yt-dlp + Node.js | `pip3 install yt-dlp` + [nodejs.org](https://nodejs.org) |
| 图片文字识别 (OCR) | Xcode Command Line Tools | `xcode-select --install` |

## 开发指南

### 前置要求
- Node.js 18+
- Rust (最新 stable)
- macOS

### 开始

```bash
# 克隆仓库
git clone https://github.com/kdsz001/xiaoyun.git
cd xiaoyun

# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建应用
npm run tauri build
```

### AI 配置

复制环境变量模板并填入你的 API Key：

```bash
cp .env.example .env
```

也可以在应用内的 设置 → AI 提供商 中直接配置（支持 OAuth 登录）。

## Roadmap

- [ ] 多语言支持 (i18n)
- [ ] 云端同步
- [ ] 浏览器插件捕获
- [ ] 团队协作版本

## 参与贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发流程和规范。

## 致谢

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — YouTube 字幕提取

## License

[MIT](LICENSE)
