---
name: instruction-skill
description: >
  项目规范文档生成技能，为主流AI编程工具（Claude Code、OpenAI Codex、Cursor、GitHub Copilot、
  Windsurf等）生成项目级规范文件。支持从已有项目分析生成规范，或从新项目交付结果生成规范。
  当用户提到以下任何场景时务必使用此技能：生成规范、项目规范、CLAUDE.md、AGENTS.md、
  cursorrules、copilot-instructions、AI编程规范、项目指令、代码规范文档、AI上下文文件、
  项目配置文件，或需要为AI编程工具创建项目上下文文件。即使用户只说了"写个规范"或
  "生成CLAUDE.md"，也应触发此技能。在workflow-skill全流程交付中，已有项目在流程开始前
  生成规范，新项目在流程完成后生成规范。
---

# 项目规范文档生成技能

你是一位项目规范文档专家，职责是为 AI 编程工具生成结构化的项目规范文件。这些文件让 AI 工具理解项目上下文、遵守项目约定、避免破坏性操作，从而显著提升 AI 辅助编码的质量。

## 输出目录约定

所有输出文档统一存放在当前项目目录的 `.dws/{项目名}/instruct/` 下。包括：
- 统一源文档 → `.dws/{项目名}/instruct/source-spec.md`
- 各工具规范文件 → 生成到项目对应位置（如 `CLAUDE.md` 放项目根目录、`.cursor/rules/` 放 `.cursor/` 目录）

注意：工具规范文件本身需要放在项目约定的位置才能生效，因此不存放于 `.dws/`，而是直接写入项目对应目录。`.dws/{项目名}/instruct/` 仅存放统一源文档等中间产物。

其中 `{项目名}` 由用户指定或从需求描述中提炼。

## 核心理念

项目规范文件是代码库的"入职文档"——就像新成员加入团队时需要了解的项目约定一样，AI 工具也需要同样的上下文。好的规范文件不是把代码重复一遍，而是写出代码中看不出来的隐含约定、架构决策和操作边界。

## 时机策略

### 已有项目：先规范，再开发
对已有代码库，规范文件应在全流程交付开始**之前**生成。AI 工具在开发过程中需要项目上下文，没有规范的 AI 会凭猜测行事，往往猜测错误。

生成方式：分析现有代码库的结构、模式、约定和配置，提炼成规范文档。

### 新项目：先交付，再规范
对新项目，规范文件应在全流程交付**完成之后**生成。此时已有实际代码、设计决策和架构模式可供提炼，规范更准确。

生成方式：基于需求文档、设计规范、实际实现代码和开发过程中的决策日志，提炼成规范文档。

## 流程

### 步骤一：确定项目类型和目标工具

询问用户：
1. 这是已有项目还是新项目？
2. 需要为哪些 AI 工具生成规范？（可多选）

| 工具 | 规范文件 | 位置 |
|------|---------|------|
| Claude Code | `CLAUDE.md` | 项目根目录（支持子目录层级） |
| OpenAI Codex | `AGENTS.md` | 项目根目录（支持子目录层级） |
| Cursor | `.cursor/rules/*.mdc` | `.cursor/rules/` 目录 |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/` 目录 |
| Windsurf | `.windsurfrules` | 项目根目录 |

默认为所有工具生成规范。如用户未指定，生成全部。

### 步骤二：收集项目信息

**已有项目**——分析代码库：

- 读取 `package.json`/`pyproject.toml`/`Cargo.toml` 等确认技术栈
- 读取项目目录结构，识别关键目录和入口文件
- 读取现有代码，提炼命名规范、代码模式、错误处理模式
- 读取现有配置文件（ESLint、Prettier、tsconfig、pytest 等）
- 读取现有测试，识别测试框架和约定
- 读取 Git 历史，了解分支和提交约定
- 读取 CI/CD 配置，了解部署流程

**新项目**——基于交付物：

- 阅读需求文档 — 理解项目目标和约束
- 阅读设计规范 — 理解技术选型和架构决策
- 阅读实现代码 — 提炼实际使用的模式
- 阅读设计决策日志 — 理解为什么选择某种方案
- 阅读任务分解 — 理解模块边界

### 步骤三：编写统一源文档

先生成一份统一源文档，包含所有工具通用的核心内容。然后再从此源文档派生各工具特定格式。

统一源文档结构：

```markdown
# [项目名称] — AI 编程规范

## 1. 项目概述
[一两段话：项目是什么、做什么、核心架构是什么]
[关键技术栈列表：语言、框架、主要库及版本]

## 2. 常用命令
| 操作 | 命令 |
|------|------|
| 安装依赖 | `npm install` |
| 启动开发 | `npm run dev` |
| 构建 | `npm run build` |
| 运行测试 | `npm test` |
| 代码检查 | `npm run lint` |
| 格式化 | `npm run format` |
| 部署 | `npm run deploy` |

## 3. 项目结构
[目录树 + 每个目录的用途说明]

## 4. 代码约定
### 命名规范
[文件命名、变量命名、函数命名、组件命名规则]

### 代码模式
**推荐：**
[Do 示例代码]

**不推荐：**
[Don't 示例代码]

### 错误处理
[项目使用的错误处理模式]

### 状态管理
[如果适用，状态管理模式]

## 5. 架构决策
| 决策 | 选择 | 原因 |
|------|------|------|
| 数据获取 | React Server Components | 减少客户端JS，提升首屏性能 |
| 状态管理 | Zustand | 轻量，TypeScript友好，适合中等复杂度 |

## 6. 规则与约束
### 绝对不要
- 不要修改 `src/generated/` 目录下的文件（自动生成）
- 不要在生产代码中使用 `any` 类型
- 不要直接使用 `fetch`，使用 `src/api/client.ts` 中封装的请求方法
- 不要在组件中直接调用 API，通过自定义 Hook 调用
- 不要提交包含密钥或凭证的代码

### 必须遵守
- 新增工具函数必须添加单元测试
- 修改共享组件必须检查所有消费者
- 数据库变更必须编写迁移脚本
- PR 必须通过 CI 检查后才能合并

## 7. 测试指南
- 测试框架：[Vitest / Jest / pytest / 等]
- 测试文件位置：[与源文件同目录 / 独立 __tests__ 目录]
- 命名约定：`[filename].test.[ext]`
- 覆盖率要求：[最低百分比]
- 运行单个测试：`npm test -- path/to/test`

## 8. Git 约定
### 提交消息格式
[Conventional Commits 或其他格式，附示例]

### 分支命名
[格式：feature/xxx, fix/xxx, 等]

### PR 规范
[PR 描述模板或关键要素]

## 9. 术语表
| 术语 | 含义 |
|------|------|
| [项目特有术语] | [解释] |
```

### 步骤四：派生工具特定格式

从统一源文档派生各工具的特定格式：

#### CLAUDE.md（Claude Code）

直接使用统一源文档内容，放置于项目根目录。如有复杂子模块，在子目录创建补充 CLAUDE.md：

```
项目根/
├── CLAUDE.md              ← 主规范（统一源文档）
├── src/
│   ├── CLAUDE.md          ← src目录补充规范（如有需要）
│   ├── components/
│   │   └── CLAUDE.md      ← 组件补充规范（如有需要）
```

子目录 CLAUDE.md 只写该目录特有的约定，不重复根级内容。

#### AGENTS.md（OpenAI Codex）

同 CLAUDE.md，直接使用统一源文档。Codex 支持层级加载，子目录可放补充 AGENTS.md。

#### .cursor/rules/（Cursor）

Cursor 使用目录化的规则文件，支持四种规则类型：

```
.cursor/
└── rules/
    ├── general.mdc         ← Always 类型：通用编码标准
    ├── frontend.mdc        ← Auto Attached：匹配 *.tsx, *.css
    ├── backend.mdc         ← Auto Attached：匹配 *.py, *.go
    └── database.mdc        ← Agent Requested：涉及数据库变更时
```

每个 .mdc 文件头部声明规则类型和匹配模式：

```markdown
---
description: 前端组件开发规范
globs: ["src/components/**/*.tsx", "src/components/**/*.css"]
alwaysApply: false
---

[规则内容]
```

规则类型说明：
- **Always**：每次对话都加载，仅用于真正通用的规则
- **Auto Attached**：当引用的文件匹配 glob 模式时自动加载
- **Agent Requested**：AI 根据描述自行决定是否加载
- **Manual**：仅当用户用 @RuleName 显式引用时加载

将统一源文档拆分为 Cursor 规则文件：
- 通用规则（项目概述、命令、约束、Git约定）→ `general.mdc`（Always）
- 前端相关（组件约定、状态管理、样式）→ `frontend.mdc`（Auto Attached）
- 后端相关（API约定、数据访问、错误处理）→ `backend.mdc`（Auto Attached）
- 专项领域（数据库、测试等）→ `database.mdc` / `testing.mdc`（Agent Requested）

#### .github/copilot-instructions.md（GitHub Copilot）

从统一源文档提取核心内容，保持简洁。Copilot 规范不宜过长，聚焦最重要的约定和约束。

#### .windsurfrules

从统一源文档提取内容，以简洁的 Markdown 格式放置于项目根目录。

### 步骤五：验证与输出

检查生成的规范文件：
- [ ] 命令可实际运行（不是假设的命令）
- [ ] 代码示例与项目实际模式一致
- [ ] 约束规则具体且可操作（非模糊的"写好代码"）
- [ ] 目录结构与实际项目匹配
- [ ] 技术栈版本与实际一致
- [ ] 没有包含敏感信息（密钥、凭证、内部URL）

输出所有生成的规范文件到项目对应位置。

## 写作原则

1. **祈使句，不商量。** 用"始终使用 TypeScript 严格模式"而非"我们倾向于使用严格模式"。AI 工具对祈使指令的遵从度更高。

2. **具体胜过模糊。** "函数名使用 camelCase" 比 "使用合理的命名" 有用一百倍。

3. **命令要可复制粘贴。** `npm test -- --watch` 比 "运行测试监视模式" 好，AI 可以直接执行。

4. **示例是最强的规范。** 一段 Do/Don't 代码示例比十行文字描述更有效。

5. **说明为什么。** "不要直接使用 fetch，使用 api/client.ts 封装——它处理了认证、重试和错误统一格式" 比 "不要直接 fetch" 更容易被遵守。

6. **保持精简。** 根级文件控制在 200 行以内。域特定规则放到子目录文件。AI 的上下文窗口有限，冗长 = 被忽略。

7. **定义边界。** 明确哪些文件/目录 AI 不应修改。没有边界的 AI 会"热心"地修改自动生成代码或配置文件。

8. **当活文档对待。** 规范随代码演进而更新。每次添加新的架构决策或修改核心约定时，同步更新规范文件。

## 反模式警示

- **照搬代码写规范**：规范写的是代码中看不出来的隐含约定，不是把代码用文字复述一遍。
- **过于冗长**：500行的规范文件会被 AI 工具截断或忽略。精简到核心内容，细节放子目录。
- **模糊指令**："遵循最佳实践"不是指令。"使用 React Server Components 获取数据，客户端组件仅用于交互"是指令。
- **过时内容**：规范文件与代码不同步比没有规范更危险——AI 会遵循错误的约定。
- **遗漏命令**：如果 AI 不知道怎么跑测试，它就不会跑测试。
- **缺少负面约束**：告诉 AI 不要做什么和告诉它要做什么一样重要。

## Dashboard 状态更新

当本技能在 workflow-skill 编排下运行时，`.dws/{项目名}/workflow-state.json` 存在。此时需在每个步骤的开始和完成时更新状态文件，使仪表盘能实时反映进度。

**如果 `workflow-state.json` 不存在，跳过本节所有操作，不影响技能正常执行。**

### 阶段映射

本技能对应阶段 ID = 0。

### 步骤映射

| 步骤 | 状态文件步骤 ID |
|------|----------------|
| 步骤一：确定项目类型和目标工具 | `instruct-step-1` |
| 步骤二：收集项目信息 | `instruct-step-2` |
| 步骤三：编写统一源文档 | `instruct-step-3` |
| 步骤四：派生工具特定格式 | `instruct-step-4` |
| 步骤五：验证与输出 | `instruct-step-5` |

### 更新规则

通过 `notify-state.mjs` 辅助脚本更新状态（Dashboard 运行时走 API 即时广播，未运行时 fallback 到原子文件写入）。

**定位脚本**：
```bash
SKILL_DIR="$(dirname "$(find ~/.claude/plugins/cache -path '*/workflow-skill/SKILL.md' -print -quit 2>/dev/null || echo /dev/null)")"
```

**步骤开始时**：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id 0 --step-id {步骤ID} --status in-progress --detail "简要描述"
```

**步骤完成时**：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id 0 --step-id {步骤ID} --status completed --result "步骤执行结果摘要"
```

**追加活动日志**（步骤开始/完成时可选附加）：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type activity --phase 0 --action step-started --message "{步骤名}" --level info
```

## 参考资料

各工具的规范文件详细格式说明，阅读 `references/tool-formats.md`。

各类型项目的规范模板，阅读 `references/project-templates.md`。
