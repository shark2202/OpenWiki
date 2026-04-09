# Design System — OpenWiki

## Product Context
- **What this is:** Mac 桌面端内容捕获 + AI 知识管理工具，自动收集剪贴板/截图/链接，用 AI 生成周报回顾
- **Who it's for:** 中文用户，偏年轻、爱折腾工具的信息工作者（信息收集党、内容创作者、知识管理者）
- **Space/industry:** 剪贴板管理 × 个人知识管理（PKM），竞品包括 Paste、CleanClip、Maccy
- **Project type:** Desktop app (Tauri 2 + React)

## Aesthetic Direction
- **Direction:** Brutally Minimal + 暖色点缀
- **Decoration level:** Minimal — 版式做所有的工作，唯一的装饰是微妙的背景色分层（纯色，非渐变）
- **Mood:** 温暖、克制、有陪伴感。不是冰冷的工具，而是安静的知识助手。像一朵安静的云。
- **Reference sites:** [Paste](https://pasteapp.io/), [CleanClip](https://cleanclip.cc/), [Maccy](https://maccy.app/)
- **Anti-patterns:** 禁止紫色渐变、浮动光球、emoji 图标、decorative blob、uniform bubbly border-radius

## Typography
- **Display/Hero:** Cabinet Grotesk (700, 800) — 几何感强，现代但不冷漠，给标题设计感
- **Body:** Plus Jakarta Sans (400, 500, 600, 700) — 可读性极佳，微圆暖感，中英文混排友好
- **UI/Labels:** Plus Jakarta Sans (500, 600) — same as body
- **Data/Tables:** JetBrains Mono (400, 500) — 等宽对齐，tabular-nums 支持
- **Code:** JetBrains Mono
- **Loading:**
  - Google Fonts: `https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap`
  - Fontshare: `https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800&display=swap`
- **Scale:**
  - 3xl: 56px (hero heading)
  - 2xl: 36px (section heading)
  - xl: 24px (page heading)
  - lg: 18px (large body)
  - md: 15px (body)
  - sm: 13px (small text, descriptions)
  - xs: 11px (labels, meta, timestamps)
  - 2xs: 9px (微标注)

## Color
- **Approach:** Restrained — 1 accent + warm neutrals, color is rare and meaningful
- **Primary/Accent:** `#F97316` (暖橙) — 温暖、有活力，区别于竞品的蓝/紫色。用于 CTA、激活状态、品牌标识
- **Accent hover:** `#EA580C`
- **Accent soft:** `#FFF7ED` (浅橙背景，用于激活态 nav、选中状态)
- **Neutrals (warm gray):**
  - Background: `#FAFAF8`
  - Surface: `#FFFFFF`
  - Surface raised: `#F5F5F0`
  - Border: `#E7E5E4`
  - Text primary: `#1C1917`
  - Text secondary: `#57534E`
  - Text muted: `#A8A29E`
  - Text disabled: `#D6D3D1`
- **Semantic:**
  - Success: `#16A34A`
  - Warning: `#CA8A04`
  - Error: `#DC2626`
  - Info: `#2563EB`
- **Dark mode:**
  - Background: `#0C0A09`
  - Surface: `#1C1917`
  - Surface raised: `#292524`
  - Border: `#3D3935`
  - Text primary: `#FAFAF8`
  - Text secondary: `#A8A29E`
  - Text muted: `#78716C`
  - Accent: `#FB923C` (降饱和 15%)
  - Accent soft: `#431407`

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)
- **Card padding:** 16px (md)
- **Card gap:** 12px
- **Section gap:** 32px (xl)

## Layout
- **Approach:** Grid-disciplined — 严格对齐，可预测的间距，内容卡片统一尺寸
- **Max content width:** 640px (主内容区域)
- **Border radius (hierarchical):**
  - sm: 6px — 按钮、输入框、小元素
  - md: 12px — 卡片、面板
  - lg: 16px — 弹窗、模态框
  - full: 9999px — 圆形元素（头像、状态点）

## Icons
- **Library:** Lucide Icons (`lucide-react`)
- **Style:** Stroke width 2px, consistent sizing
- **Sizes:** 16px (inline), 20px (button), 24px (nav)
- **Rule:** 所有 emoji 图标必须替换为 Lucide 对应图标

## Motion
- **Approach:** Minimal-functional — 只有辅助理解的过渡，无装饰性动画
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:**
  - micro: 50-100ms (hover, toggle)
  - short: 150-200ms (button press, tab switch)
  - medium: 200-300ms (panel expand, bubble appear)
  - long: 400ms (page transition)
- **Rule:** 无浮动光球、无呼吸灯效果、无装饰性渐变动画

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-25 | 暖橙色替代紫色系 | 所有竞品（Paste/CleanClip/Maccy）用蓝/紫，橙色创造品牌辨识度 |
| 2026-03-25 | Cabinet Grotesk 标题字体 | 竞品用系统字体或 Inter，自定义字体增加设计感 |
| 2026-03-25 | Lucide Icons 替换 emoji | emoji 跨平台渲染不一致，Lucide 风格统一且专业 |
| 2026-03-25 | 暖灰色系（非冷灰） | 与暖橙主色协调，营造温暖陪伴感 |
| 2026-03-25 | Minimal 装饰级别 | 去除渐变、光球等 AI slop 元素，版式做所有的工作 |
