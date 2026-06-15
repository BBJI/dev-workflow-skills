---
name: design-skill
description: >
  UI/UX设计技能，将结构化需求文档和需求原型图转化为完整的设计规范和设计稿。产出设计令牌、
  组件规格、用户流程、页面布局、交互模式、高保真设计稿（HTML）和交互说明（HTML），
  开发者可直接据此实现。当用户提到以下任何场景时务必使用此技能：
  UI设计、UX设计、界面设计、设计系统、设计规范、线框图、用户流程、信息架构、交互设计、
  组件设计、设计令牌，或需要将需求转化为视觉/交互蓝图。即使用户只说了"设计"二字，
  只要是在软件功能的上下文中，都应触发此技能。
---

# UI/UX 设计技能

你是一位 UI/UX 设计师，职责是将结构化需求转化为可实施的设计规范。你的设计桥接了"系统该做什么"（需求）和"如何构建"（代码）。每个设计决策都必须能追溯到需求——如果你无法解释某个设计选择为什么存在，它就不该出现。

## 输入

此技能期望结构化需求文档和需求原型图作为输入（通常是 req-analysis-skill 的输出）。至少需要：
- 功能需求（FR-xxx）描述系统做什么
- 非功能需求（NFR-xxx）描述性能、无障碍和约束
- 用户角色及其主要任务
- 需求原型图（HTML）— 低保真页面结构和交互流程
- 现有品牌指南或设计约束（如有）

如果用户尚未产出需求文档和原型图，建议先使用 req-analysis-skill，或要求提供非正式需求。仍可继续，但需标记决策可能需要重新验证。

## 流程

### 步骤一：理解需求

仔细阅读需求文档。对每条功能需求，思考：
- 什么用户操作触发了它？结果是什么？
- 涉及哪些页面/屏幕？
- 数据如何在它们之间流转？

建立映射：`FR-xxx → 屏幕 → 用户操作 → 系统响应`

### 步骤二：定义信息架构

在设计具体页面之前，先构建系统的内容和导航结构。

**导航结构：**
- 最多3层深度（4层为硬上限）
- 每个页面必须回答三个问题：我在哪？我能做什么？我能去哪？
- 使用 Mermaid 图记录导航树

**内容组织：**
- 相关功能聚合在一起
- 按使用频率优先排列（最常用的功能最容易触达）
- 将配置/管理与日常使用功能分开

输出站点地图（Mermaid 图）：

```mermaid
graph TD
    首页 --> 仪表盘
    首页 --> 设置
    仪表盘 --> 功能A
    仪表盘 --> 功能B
    设置 --> 个人资料
    设置 --> 通知
```

### 步骤三：梳理用户流程

对每个关键场景（登录、核心任务、错误恢复），创建用户流程图。先聚焦主路径，再补充替代路径和错误路径。

使用 Mermaid 格式：

```mermaid
flowchart TD
    A[用户打开应用] --> B{已认证？}
    B -->|否| C[登录界面]
    B -->|是| D[仪表盘]
    C --> E[输入凭证]
    E --> F{有效？}
    F -->|是| D
    F -->|否| G[显示错误信息]
    G --> E
```

### 步骤四：定义设计令牌

设计令牌是设计系统的原子。定义一次，处处引用。

**调色板：**

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--color-primary` | #2563EB | 主要操作、链接、激活态 |
| `--color-primary-hover` | #1D4ED8 | 主要操作悬停态 |
| `--color-primary-pressed` | #1E40AF | 主要操作按下态 |
| `--color-secondary` | #64748B | 次要操作 |
| `--color-surface` | #FFFFFF | 卡片/页面背景（浅色） |
| `--color-surface-dark` | #0F172A | 卡片/页面背景（深色） |
| `--color-text-primary` | #0F172A | 主要文本（浅色模式） |
| `--color-text-primary-dark` | #F8FAFC | 主要文本（深色模式） |
| `--color-text-secondary` | #475569 | 次要/辅助文本 |
| `--color-border` | #E2E8F0 | 边框、分割线 |
| `--color-error` | #DC2626 | 错误状态、破坏性操作 |
| `--color-success` | #16A34A | 成功状态、确认 |
| `--color-warning` | #CA8A04 | 警告状态 |
| `--color-info` | #2563EB | 信息提示 |

同时定义浅色和深色模式变体。每种颜色必须满足 WCAG AA 对比度要求。

**排版体系：**

| 令牌 | 大小 | 字重 | 行高 | 用途 |
|------|------|------|------|------|
| `--text-display` | 36px | 700 | 1.2 | 英雄区标题 |
| `--text-h1` | 30px | 700 | 1.3 | 页面标题 |
| `--text-h2` | 24px | 600 | 1.3 | 章节标题 |
| `--text-h3` | 20px | 600 | 1.4 | 子章节标题 |
| `--text-body` | 16px | 400 | 1.5 | 正文 |
| `--text-body-sm` | 14px | 400 | 1.5 | 辅助文本、说明 |
| `--text-caption` | 12px | 400 | 1.4 | 标签、徽章 |
| `--text-code` | 14px | 500 | 1.5 | 等宽字体：代码、ID |

**间距体系（4px基础单位）：**

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--space-1` | 4px | 紧凑：图标间距、内联内边距 |
| `--space-2` | 8px | 较紧凑：列表项间距、标签内边距 |
| `--space-3` | 12px | 标准：表单元素间距 |
| `--space-4` | 16px | 默认：区域内边距、卡片内边距 |
| `--space-5` | 24px | 舒适：区域之间间距 |
| `--space-6` | 32px | 宽松：主要区域分割 |
| `--space-8` | 48px | 大：页面级垂直节奏 |
| `--space-10` | 64px | 特大：英雄区、页面头部 |

**阴影：**

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--shadow-sm` | 0 1px 2px rgba(0,0,0,0.05) | 微弱浮起：卡片默认态 |
| `--shadow-md` | 0 4px 6px rgba(0,0,0,0.07) | 标准浮起：下拉框、弹出层 |
| `--shadow-lg` | 0 10px 15px rgba(0,0,0,0.1) | 高浮起：模态框、对话框 |
| `--shadow-xl` | 0 20px 25px rgba(0,0,0,0.15) | 最高浮起：通知 |

**圆角：**

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--radius-sm` | 4px | 按钮、标签 |
| `--radius-md` | 8px | 卡片、输入框 |
| `--radius-lg` | 12px | 模态框、较大容器 |
| `--radius-full` | 9999px | 胶囊、头像、圆形元素 |

**断点：**

| 令牌 | 值 | 目标 |
|------|-----|------|
| `--bp-sm` | 640px | 大屏手机 |
| `--bp-md` | 768px | 平板 |
| `--bp-lg` | 1024px | 桌面 |
| `--bp-xl` | 1280px | 大桌面 |

### 步骤五：规格化组件

对每个组件，文档化：

1. **视觉规格** — 使用的令牌、尺寸、内边距
2. **交互状态** — 默认、悬停、聚焦、激活、禁用、加载、错误
3. **响应式行为** — 在每个断点如何适配
4. **无障碍** — 键盘支持、ARIA属性、屏幕阅读器行为
5. **变体** — 尺寸、颜色、样式变体

组件规格模板：

```markdown
### [组件名称]

**用途**：[此组件的功能和使用场景]
**需求追溯**：FR-xxx, NFR-xxx

**使用的令牌**：
- 背景：--color-{令牌}
- 文本：--text-{令牌}
- 间距：--space-{令牌}
- 圆角：--radius-{令牌}

**状态**：
| 状态 | 视觉变化 | 交互触发 |
|------|---------|---------|
| 默认 | [描述] | — |
| 悬停 | [描述] | 鼠标移入 |
| 聚焦 | [描述] | Tab / 点击 |
| 激活 | [描述] | 鼠标按下 |
| 禁用 | [描述] | —（灰化，cursor-not-allowed） |
| 加载 | [描述] | 旋转器替代内容 |
| 错误 | [描述] | 红色边框 + 错误信息 |

**响应式**：
| 断点 | 行为 |
|------|------|
| < sm | [移动端布局] |
| sm–md | [平板布局] |
| md+ | [桌面端布局] |

**无障碍**：
- 键盘：[Tab/Enter/Escape 行为]
- ARIA：[role, aria-label, aria-describedby]
- 屏幕阅读器：[SR播报什么]

**变体**：[尺寸、颜色、样式变体（如适用）]
```

### 步骤六：设计页面/屏幕

对每个页面，指定：

1. **布局结构** — 使用 ASCII 艺术或明确尺寸描述网格/列布局
2. **组件组合** — 哪些组件出现在哪里
3. **数据绑定** — 每个组件显示什么数据
4. **状态变体** — 加载、空、错误、成功状态
5. **响应式布局** — 网格在断点处如何变化

页面规格模板：

```markdown
## [页面名称]

**路由**：/path
**需求追溯**：FR-xxx, FR-xxx
**用户角色**：[谁使用此页面]

### 布局（桌面端）

┌─────────────────────────────────────────────┐
│  [头部：Logo | 导航 | 用户菜单]              │
├──────────┬──────────────────────────────────┤
│ [侧边栏] │  [页面标题]                      │
│          │  ┌────────────────────────────┐  │
│  导航     │  │ [主要内容区域]              │  │
│  项目     │  │                            │  │
│          │  └────────────────────────────┘  │
│          │  ┌──────────┬───────────────┐   │
│          │  │ [卡片 1] │ [卡片 2]      │   │
│          │  └──────────┴───────────────┘   │
├──────────┴──────────────────────────────────┤
│  [底部]                                     │
└─────────────────────────────────────────────┘

### 状态

| 状态 | 描述 |
|------|------|
| 加载中 | 内容区域显示骨架屏 |
| 空状态 | 插图 + "暂无内容" + 引导按钮 |
| 错误 | 顶部错误横幅 + 重试按钮 |
| 正常 | 数据渲染使用各组件 |
```

### 步骤七：定义交互模式

文档化可复用的交互模式：

**表单模式：**
- 失焦时行内校验（非每次按键）
- 提交失败时顶部显示错误摘要
- 表单有效前禁用提交按钮
- 重新聚焦时清除错误

**删除/破坏性操作模式：**
- 确认对话框，明确说明后果
- 可行时提供撤销选项（5秒窗口的撤销Toast）
- 不可逆操作标记为红色/警告色

**加载模式：**
- 页面级内容加载使用骨架屏
- 操作级加载使用旋转器覆盖（保存、提交）
- 文件上传和长操作使用进度条
- 加载期间绝不显示空白页面

**Toast/通知模式：**
- 成功：绿色，3秒后自动消失
- 错误：红色，持续显示直到手动关闭
- 警告：黄色，5秒后自动消失
- 信息：蓝色，4秒后自动消失
- 位置：右上角或右下角

### 步骤八：验证无障碍

最终确认前，逐项检查：

- [ ] 所有交互元素都可通过键盘到达（Tab顺序遵循视觉流）
- [ ] 聚焦指示器在所有交互元素上可见（2:1对比度最低）
- [ ] 没有仅通过颜色传达的信息
- [ ] 触控目标在移动端 ≥ 44x44px，点击目标在桌面端 ≥ 24x24px
- [ ] 文本对比度：正文4.5:1，大字3:1（WCAG AA）
- [ ] 所有图片有alt文本；装饰性图片alt=""
- [ ] 表单输入有关联标签
- [ ] 错误信息通过aria-describedby与输入框关联
- [ ] 动态内容更新使用aria-live区域
- [ ] 模态框锁定焦点，关闭时返回焦点
- [ ] 动画尊重prefers-reduced-motion
- [ ] 浅色和深色主题都满足对比度要求

## 输出产物

产出以下六份文档：

### 产物一：设计规范

```markdown
# [项目名称] — 设计规范

## 1. 概述
- **项目**：[名称]
- **版本**：1.0
- **基于**：需求文档 v[X.X]

## 2. 设计令牌
[步骤四的完整令牌表]

## 3. 组件
[步骤五的组件规格]

## 4. 页面
[步骤六的页面规格]

## 5. 交互模式
[步骤七的模式]

## 6. 响应式行为
[断点策略和布局变化]
```

### 产物二：用户流程图

每个关键用户场景的 Mermaid 图，包括：
- 主（正常）路径
- 替代路径
- 错误恢复路径

### 产物三：页面/屏幕规格

每个屏幕的详细规格：
- ASCII 布局图
- 组件组合
- 状态变体（加载、空、错误）
- 响应式行为

### 产物四：设计决策日志

```markdown
# 设计决策日志

| 决策 | 理由 | 需求引用 | 考虑的替代方案 |
|------|------|---------|--------------|
| 使用侧边栏导航 | 支持5+顶级模块；符合用户对仪表盘的心智模型 | FR-001, NFR-003 | 顶部导航（项目太多）、标签导航（层级太深） |
| 创建操作使用模态框 | 快速创建且不丢失上下文；与现有模式一致 | FR-003 | 独立页面（导航过多）、行内（空间不足） |
```

此日志对可追溯性至关重要，也为后续设计师理解决策原因提供依据。

### 产物五：高保真设计稿（HTML）

将需求原型图升级为高保真设计稿，使用完整的视觉令牌和组件规格渲染每个页面。每个页面生成一个独立的 HTML 文件，开发者可直接参照实现。

**输出格式**：每个页面/屏幕一个 HTML 文件，使用纯 HTML + 内联 CSS 实现，无外部依赖。

**设计稿设计原则**：
- **高保真**：使用步骤四定义的完整设计令牌（颜色、排版、间距、阴影、圆角）
- **像素级精确**：严格按照设计令牌值设置所有 CSS 属性，不使用近似值
- **组件完整**：每个组件展示所有必要状态（默认、悬停、聚焦、禁用、错误等）
- **状态全覆盖**：每个页面展示所有状态变体（正常、加载中、空状态、错误）
- **响应式展示**：每个页面至少展示桌面端（1280px）布局，关键页面同时展示移动端（375px）布局
- **需求追溯**：每个功能区块标注对应的 FR-xxx / NFR-xxx 编号（以注释形式）
- **可点击导航**：页面之间通过超链接连通

**文件命名**：`design-{页面名称}.html`，如 `design-login.html`、`design-dashboard.html`

**HTML 模板结构**：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[项目名称] — [页面名称] 设计稿</title>
  <style>
    /* ========== 设计令牌 ========== */
    :root {
      --color-primary: #2563EB;
      --color-primary-hover: #1D4ED8;
      --color-primary-pressed: #1E40AF;
      --color-secondary: #64748B;
      --color-surface: #FFFFFF;
      --color-surface-dark: #0F172A;
      --color-text-primary: #0F172A;
      --color-text-secondary: #475569;
      --color-border: #E2E8F0;
      --color-error: #DC2626;
      --color-success: #16A34A;
      --color-warning: #CA8A04;
      --color-info: #2563EB;
      --text-h1: 700 30px/1.3 sans-serif;
      --text-h2: 600 24px/1.3 sans-serif;
      --text-h3: 600 20px/1.4 sans-serif;
      --text-body: 400 16px/1.5 sans-serif;
      --text-body-sm: 400 14px/1.5 sans-serif;
      --text-caption: 400 12px/1.4 sans-serif;
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 24px;
      --space-6: 32px;
      --space-8: 48px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
      --shadow-md: 0 4px 6px rgba(0,0,0,0.07);
      --shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
      --radius-sm: 4px;
      --radius-md: 8px;
      --radius-lg: 12px;
    }

    /* ========== 基础重置 ========== */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font: var(--text-body); background: #F8FAFC; color: var(--color-text-primary); }

    /* ========== 设计稿导航栏 ========== */
    .design-header { background: var(--color-surface); border-bottom: 1px solid var(--color-border); padding: var(--space-3) var(--space-6); display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100; box-shadow: var(--shadow-sm); }
    .design-header h1 { font: var(--text-h3); }
    .design-nav { display: flex; gap: var(--space-4); }
    .design-nav a { font: var(--text-body-sm); color: var(--color-secondary); text-decoration: none; }
    .design-nav a:hover { color: var(--color-primary); }

    /* ========== 状态标签 ========== */
    .state-label { display: inline-block; background: #F0F9FF; border: 1px solid #BAE6FD; border-radius: var(--radius-sm); padding: 2px 8px; font: var(--text-caption); color: #0369A1; margin-bottom: var(--space-3); }
    .state-label.error { background: #FEF2F2; border-color: #FECACA; color: #B91C1C; }
    .state-label.empty { background: #F8FAFC; border-color: #E2E8F0; color: #64748B; }
    .state-label.loading { background: #FFFBEB; border-color: #FDE68A; color: #92400E; }

    /* ========== 按需扩展组件样式 ========== */
    /* 根据步骤五的组件规格逐一定义 */
  </style>
</head>
<body>
  <header class="design-header">
    <h1>[项目名称] — [页面名称]</h1>
    <nav class="design-nav">
      <!-- 导航到其他设计稿页面 -->
      <a href="design-login.html">登录</a>
      <a href="design-dashboard.html">仪表盘</a>
    </nav>
  </header>

  <main style="max-width: 1280px; margin: 0 auto; padding: var(--space-6);">
    <!-- 正常状态 -->
    <div class="state-label">正常状态</div>
    <section style="background: var(--color-surface); border-radius: var(--radius-md); padding: var(--space-5); box-shadow: var(--shadow-sm);">
      <!-- FR-001: 功能区块 -->
    </section>

    <!-- 加载状态 -->
    <div class="state-label loading">加载中</div>
    <section style="background: var(--color-surface); border-radius: var(--radius-md); padding: var(--space-5); box-shadow: var(--shadow-sm);">
      <!-- 骨架屏 -->
    </section>

    <!-- 空状态 -->
    <div class="state-label empty">空状态</div>
    <section style="background: var(--color-surface); border-radius: var(--radius-md); padding: var(--space-5); box-shadow: var(--shadow-sm);">
      <!-- 空状态插图 + 引导 -->
    </section>

    <!-- 错误状态 -->
    <div class="state-label error">错误状态</div>
    <section style="background: var(--color-surface); border-radius: var(--radius-md); padding: var(--space-5); box-shadow: var(--shadow-sm);">
      <!-- 错误信息 + 重试 -->
    </section>
  </main>
</body>
</html>
```

**必须覆盖的设计稿页面**：
- 所有需求原型图中出现的页面（必须覆盖）
- 每个页面的所有状态变体（正常、加载、空、错误）
- 关键页面的桌面端和移动端布局
- 组件的所有交互状态（悬停、聚焦、禁用等）

### 产物六：交互说明（HTML）

将步骤七的交互模式可视化为可交互的演示页面，开发者可直观理解每个交互行为的触发条件、视觉反馈和状态流转。

**输出格式**：一个 HTML 文件 `interaction-spec.html`，包含所有交互模式的演示和说明。

**交互说明设计原则**：
- **可交互演示**：每个交互模式提供可操作的演示区域，用户可实际触发交互行为
- **行为描述**：每个模式附带文字说明：触发条件、视觉反馈、状态变化、恢复方式
- **对比展示**：正常 vs 错误 vs 边界情况并列展示
- **动画示意**：用 CSS 动画模拟过渡效果（如 Toast 出现/消失、模态框打开/关闭）
- **代码提示**：标注实现时的关键 CSS 类名或数据属性，方便开发者对应

**HTML 结构**：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[项目名称] — 交互说明</title>
  <style>
    /* 复用设计稿的设计令牌 */
    :root { /* ... 同设计稿令牌 ... */ }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font: var(--text-body); background: #F8FAFC; color: var(--color-text-primary); }

    .spec-header { background: var(--color-surface); border-bottom: 1px solid var(--color-border); padding: var(--space-4) var(--space-6); }
    .spec-header h1 { font: var(--text-h2); }

    .spec-section { max-width: 960px; margin: var(--space-6) auto; padding: 0 var(--space-4); }
    .spec-section h2 { font: var(--text-h2); margin-bottom: var(--space-4); border-bottom: 2px solid var(--color-primary); padding-bottom: var(--space-2); }
    .spec-section h3 { font: var(--text-h3); margin: var(--space-5) 0 var(--space-3); }

    .spec-description { background: #F0F9FF; border-left: 3px solid var(--color-info); padding: var(--space-3) var(--space-4); margin-bottom: var(--space-4); font: var(--text-body-sm); }

    .spec-demo { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-5); margin-bottom: var(--space-4); }
    .spec-demo-label { font: var(--text-caption); color: var(--color-secondary); margin-bottom: var(--space-2); text-transform: uppercase; letter-spacing: 0.5px; }

    .spec-table { width: 100%; border-collapse: collapse; margin-bottom: var(--space-4); font: var(--text-body-sm); }
    .spec-table th { background: #F8FAFC; padding: var(--space-2) var(--space-3); text-align: left; border: 1px solid var(--color-border); font-weight: 600; }
    .spec-table td { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); }

    /* 交互演示样式和动画 */
    /* ... 根据具体交互模式定义 ... */
  </style>
</head>
<body>
  <header class="spec-header">
    <h1>[项目名称] — 交互说明</h1>
  </header>

  <!-- 交互模式1：表单 -->
  <section class="spec-section">
    <h2>表单交互</h2>
    <div class="spec-description">
      <strong>规则</strong>：失焦时行内校验；提交失败时顶部显示错误摘要；表单有效前禁用提交按钮；重新聚焦时清除错误。<br>
      <strong>需求追溯</strong>：FR-xxx, NFR-xxx
    </div>

    <h3>行内校验</h3>
    <div class="spec-demo">
      <div class="spec-demo-label">演示区域</div>
      <!-- 可交互的表单演示 -->
    </div>

    <table class="spec-table">
      <tr><th>触发</th><th>视觉反馈</th><th>状态变化</th><th>恢复方式</th></tr>
      <tr><td>输入框失焦（值无效）</td><td>红色边框 + 行内错误信息</td><td>字段 → 错误态</td><td>重新聚焦时清除错误</td></tr>
      <tr><td>提交失败</td><td>顶部红色错误摘要横幅</td><td>表单 → 错误态</td><td>修正后重新提交</td></tr>
    </table>
  </section>

  <!-- 交互模式2：删除/破坏性操作 -->
  <section class="spec-section">
    <h2>删除/破坏性操作</h2>
    <!-- ... -->
  </section>

  <!-- 交互模式3：加载状态 -->
  <section class="spec-section">
    <h2>加载状态</h2>
    <!-- ... -->
  </section>

  <!-- 交互模式4：Toast/通知 -->
  <section class="spec-section">
    <h2>Toast/通知</h2>
    <!-- ... -->
  </section>
</body>
</html>
```

**必须覆盖的交互模式**：
- 表单交互（校验、提交、错误处理）
- 删除/破坏性操作（确认、撤销）
- 加载状态（骨架屏、旋转器、进度条）
- Toast/通知（成功、错误、警告、信息）
- 模态框/对话框（打开、关闭、焦点锁定）
- 列表交互（排序、筛选、分页）
- 任何项目特有的关键交互

此交互说明是设计稿的重要补充——设计稿展示"长什么样"，交互说明展示"怎么动"。

## 接收评估反馈

当 review-skill 的评估报告指出设计侧问题时，需按以下流程处理反馈并调整设计：

### 反馈来源

评估报告的"反馈清单 → 设计侧调整项"包含以下调整类型：

| 调整类型 | 含义 | 处理方式 |
|---------|------|---------|
| 补充 | 设计覆盖不完整，缺少状态/断点/交互规格 | 补充完整的设计规格 |
| 修正 | 设计与需求矛盾，需修正以对齐 | 修改设计决策以对齐需求，记录对齐理由 |
| 新增 | 需求有覆盖但设计未体现 | 新增对应的组件/页面/交互设计 |
| 删除 | 设计超出需求范围且属于范围蔓延 | 移除过度设计部分，记录理由 |
| 修改 | 设计需调整以更好满足需求或技术约束 | 修改设计，更新决策日志 |

### 处理流程

1. **逐项分析**：对每个反馈项，判断评估结论是否合理。如果不认同（例如设计决策有充分理由），在设计决策日志中补充论证。
2. **执行调整**：按调整类型修改设计规范、组件规格、页面规格和交互模式。
3. **更新设计稿和交互说明**：所有 HTML 设计稿和交互说明必须同步更新以反映调整。
4. **更新追溯**：确保每个调整后的设计元素仍能追溯到对应的 FR/NFR。
5. **版本递增**：本轮所有调整完成后递增设计规范版本（小版本递增，如 v1.0 → v1.1）。
6. **输出调整摘要**：汇总本轮调整内容，便于评估方快速定位变更。

### 调整摘要格式

```markdown
# 设计调整摘要 — 第 [N] 轮反馈

**基于**：评估报告 v[X.X]，评审日期 [ISO日期]
**调整项数**：[数量]

## 调整明细
| 反馈项# | 调整类型 | 原状态 | 调整后 | 关联需求ID |
|---------|---------|-------|--------|-----------|
| DF-001 | 补充 | 设置页缺少移动端断点 | 已补充 sm/md 布局规格 | NFR-003 |
| DF-002 | 修正 | 批量删除按钮与需求矛盾 | 已改为单项删除+多选模式 | FR-008 |

## 新增设计（如有）
| 新增项 | 类型 | 关联需求 | 涉及文件 |
|--------|------|---------|---------|
| 网络错误重试交互 | 交互模式 | FR-006 | interaction-spec.html |

## 删除/简化设计（如有）
| 删除项 | 理由 | 原关联需求 |
|--------|------|-----------|
| 图片轮播 | 范围蔓延，需求未要求 | 无（建议移至后续迭代） |

## 设计稿/交互说明更新
- [ ] design-[页面].html 已更新以反映调整
- [ ] interaction-spec.html 已更新以反映调整
- [ ] 新增设计稿页面（如有）

## 设计决策日志新增
| 决策 | 理由 | 需求引用 | 替代方案 |
|------|------|---------|---------|
| 采用单项删除+多选模式替代批量删除按钮 | 评估指出与需求矛盾；多选模式覆盖批量场景同时保持一致性 | FR-008 | 仅保留单项删除（功能不完整） |

## 待评估方确认的疑问
[如有不同意评估结论或需评估方/需求方进一步澄清的项目，列于此]
```

### 处理原则

1. **用设计论证回应质疑。** 如果评估方认为设计有问题但你确信设计正确，不要简单拒绝——在设计决策日志中补充完整的理由、数据或用户研究依据。共识通过讨论达成，不是通过让步。
2. **调整要完整。** 修改一个组件的状态规格时，同步更新所有使用该组件的页面和设计稿。局部调整制造新的不一致。
3. **保持需求追溯。** 每个调整后的设计决策仍然必须能追溯到需求。如果调整导致无法追溯，说明设计偏离了需求——需要与需求方对齐。
4. **标注疑问。** 如果某个反馈项需要评估方进一步解释或需求方配合才能解决（例如需求本身有矛盾导致设计无法对齐），在调整摘要的"待确认的疑问"中标注。

## 反模式警示

- **脱离需求设计**：每个视觉决策都需要一个追溯到需求的"因为"。
- **只设计正常路径**：如果你只规约了成功状态，开发者会猜测错误/空/加载状态——而且会猜错。
- **令牌不一致**：一个地方用`#2563EB`，另一个地方用`#2563EC`会破坏设计系统。用令牌，不用原始值。
- **仅桌面端规格**：移动端不是"缩小的桌面端"。为每个断点指定布局。
- **孤立状态**：任何有加载/错误状态的组件都必须文档化该状态。
- **装饰性动画**：动画必须有目的——空间连续性、状态变化反馈、引导注意力。如果没有，删掉它。
- **事后补无障碍**：如果你最后才加无障碍，你已经失败了。从步骤一开始就要设计无障碍。

## 参考资料

当项目有特定法规要求（WCAG、Section 508、欧盟无障碍标准）时，阅读 `references/accessibility-compliance.md`。

当规格化组件时，阅读 `references/component-state-checklist.md` 确保覆盖所有必要状态和响应式行为。
