# Dev Workflow Skills

基于 **Loop Engineering** 的全流程 AI 自主交付技能套件，为 Claude Code 和 OpenAI Codex 提供从需求到交付的一键闭环能力。

## 什么是 Loop Engineering

传统线性交付（需求→设计→开发→测试）的问题在于：缺陷在下游被发现时，修复成本指数增长。Loop Engineering 用收敛反馈闭环替代线性流程——需求、设计、评估三方迭代直至共识达成，测试先行编写用例再以 TDD 驱动开发，测试与开发形成迭代循环，Bug 数量递减收敛。

```
项目规范(已有) ──► 需求分析 ──► UI/UX设计 ──► 实现评估
                     │              ▲          │  │
                     │    ┌─────────┘          │  │
                     │    │ 评估反馈(需求调整)   │  │
                     │    │                    │  │
                     │    │    ┌───────────────┘  │
                     │    │    │ 评估反馈(设计调整) │
                     │    │    ▼                  │
                     │    │  共识达成 ──► 任务拆分  │
                     │    │                │      │
                     │    │                ▼      │
                     │    │          测试用例编写   │
                     │    │                │      │
                     │    │                ▼      │
                     │    │          TDD开发实现 ──┘
                     │    │                │    (Bug→开发)
                     │    │                ▼
                     │    │           测试验证
                     │    ▼
                     └── 项目规范(新项目) ──► 完成
```

## 技能模块

| 技能 | 指令 | 能力 |
|------|------|------|
| 需求分析 | `/req <描述>` | 将模糊想法转化为结构化需求（FR-xxx + NFR-xxx），输出需求文档 + HTML 原型图，强制澄清不可跳过 |
| UI/UX 设计 | `/design` | 设计令牌、组件规格、页面布局、交互模式，输出 HTML 设计稿 + 交互说明，无障碍默认 WCAG 2.2 AA |
| 实现评估 | `/review` | 需求覆盖、设计一致性、技术可行性三维度评审，驱动三方迭代直至共识达成，输出技术实现文档 |
| 任务拆分 | `/task` | 原子任务分解、依赖图、关键路径、MoSCoW 优先级 |
| 测试用例 | `/test`（用例编写模式） | 共识达成后先编写完整测试用例，覆盖功能/非功能/无障碍/视觉一致性 |
| 开发实现 | `/dev <描述>` | 以测试用例为驱动，Red-Green-Refactor TDD 模式编码，Bug 修复先写失败测试 |
| 测试验证 | `/test`（验证模式） | 功能/非功能/无障碍/安全/视觉一致性全维度验证，Bug 反馈开发修复形成收敛闭环 |
| 项目规范 | `/instruct` | 为 AI 编程工具生成项目规范（CLAUDE.md、AGENTS.md、.cursor/rules/ 等） |
| 全流程 | `/workflow <描述>` | 一键编排以上所有阶段，自动流转，共识闭环 + TDD 闭环双轮驱动 |

## 快速安装

### Windows（PowerShell）

```powershell
iex (irm https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.ps1).TrimStart([char]0xFEFF)
```

### Windows（CMD）

```cmd
powershell -Command "iex (irm https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.ps1).TrimStart([char]0xFEFF)"
```

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.sh | bash
```

安装后重启 Claude Code，即可使用所有 `/req`、`/design`、`/workflow` 等指令。

> **关于 `.TrimStart([char]0xFEFF)`**：install.ps1 保存为 UTF-8 with BOM，确保 Windows PowerShell 5.x 直接执行 `.\install.ps1` 时按 UTF-8 解码（否则按系统码页 GBK 解码导致中文乱码和解析失败）。但 `irm` 把 BOM 字符 `﻿` 带入返回字符串，PS 5.x 的 `iex` 不剥离该字符会导致解析失败，因此管道前显式剥离。PowerShell 7+ 自动剥离 BOM，该调用是 no-op。

### 同时安装到 Claude Code + Codex

```powershell
# PowerShell
iwr https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.ps1 -OutFile install.ps1 -UseBasicParsing
.\install.ps1 -Codex -Project "C:\my-app"
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.sh | bash -s -- --codex --project /path/to/your/project
```

这会在目标项目中生成 `AGENTS.md`，Codex 自动读取。

### 使用内部 GitLab

```powershell
# PowerShell
iwr https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.ps1 -OutFile install.ps1 -UseBasicParsing
.\install.ps1 -Repo "https://gitlab.example.com/skills/dev-workflow-skills.git"
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.sh | bash -s -- --repo https://gitlab.example.com/skills/dev-workflow-skills.git
```

### 卸载

```powershell
# PowerShell
iwr https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.ps1 -OutFile install.ps1 -UseBasicParsing
.\install.ps1 -Uninstall
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.sh | bash -s -- --uninstall
```

## 使用方式

### 单阶段触发

在 Claude Code 中输入对应指令即可触发特定技能：

```
/req 做一个多租户SaaS计费系统
/design
/review
/task
/dev 实现租户管理的CRUD接口
/test
/instruct
```

### 全流程一键执行

```
/workflow 做一个多租户SaaS计费系统
```

全流程会按阶段自动流转，每个阶段有门控条件：

1. **项目规范生成**（已有项目先做，新项目后做）
2. **需求分析** — 澄清 → 分解 → 结构化 → 验证 → 输出需求文档 + HTML 原型图
3. **UI/UX 设计** — 信息架构 → 用户流程 → 设计令牌 → 组件 → 页面 → 交互 → 输出 HTML 设计稿 + 交互说明
4. **实现评估** — 需求覆盖 → 一致性 → 可行性 → 缺口 → 风险 → 驱动需求/设计迭代直至共识达成 → 输出技术实现文档
5. **任务拆分** — 识别 → 映射 → 依赖 → 估算 → 优先级 → 迭代计划
6. **测试用例编写** — 基于共识方案编写完整测试用例，覆盖功能/非功能/无障碍/视觉一致性
7. **TDD 开发实现** — Red-Green-Refactor 循环，以测试用例驱动编码
8. **测试验证** — 功能 → 非功能 → 无障碍 → 安全 → 视觉 → 回归，Bug 反馈开发修复

### 两大闭环

**共识闭环（阶段三）**：评估发现缺口或矛盾时，将结构化反馈分别送回需求分析和设计，三方迭代调整直至共识达成，最多 5 轮。确保开发基于的是需求、设计、评估三方一致同意的方案。

**TDD 闭环（阶段六-七）**：测试先行编写用例，开发以 TDD 模式驱动实现，测试验证发现 Bug 时反馈给开发修复，最多 3 轮收敛：

```
Bug数量: [8] → [3] → [1] → [0]
```

3 轮不收敛则暂停分析根因。

## 输出目录约定

所有技能的输出文档统一存放在项目目录的 `.dws/{项目名}/` 下，按技能类型分类：

```
.dws/{项目名}/
├── instruct/    — 项目规范源文档（工具规范文件直接写入项目对应位置）
├── req/         — 需求文档、追溯矩阵、原型图（HTML）
├── design/      — 设计规范、设计稿（HTML）、交互说明（HTML）
├── review/      — 评审报告、技术实现文档
├── task/        — 任务分解、迭代计划
├── test/        — 测试用例文档、Bug报告、测试总结
└── dev/         — 任务完成报告（代码写入项目源码目录）
```

`{项目名}` 由用户指定或从需求描述中提炼。

## 项目结构

```
dev-workflow-skills/
├── .claude-plugin/
│   ├── plugin.json              # Claude Code 插件注册
│   └── marketplace.json         # 插件市场信息
├── commands/                    # 斜杠指令入口
│   ├── req.md                   # /req
│   ├── design.md                # /design
│   ├── review.md                # /review
│   ├── task.md                  # /task
│   ├── dev.md                   # /dev
│   ├── test.md                  # /test
│   ├── instruct.md              # /instruct
│   └── workflow.md              # /workflow
├── skills/                      # 技能定义
│   ├── req-analysis-skill/
│   │   ├── SKILL.md
│   │   └── references/
│   ├── design-skill/
│   │   ├── SKILL.md
│   │   └── references/
│   ├── review-skill/
│   │   └── SKILL.md
│   ├── task-allocation-skill/
│   │   └── SKILL.md
│   ├── dev-skill/
│   │   └── SKILL.md
│   ├── test-skill/
│   │   ├── SKILL.md
│   │   └── references/
│   ├── instruction-skill/
│   │   ├── SKILL.md
│   │   └── references/
│   └── workflow-skill/          # 主编排器
│       ├── SKILL.md
│       ├── references/          # state-updates / dashboard / sub-skill-state-updates
│       └── dashboard/           # Express + SSE 实时可视化服务器
│           ├── server.mjs       # REST API + SSE 广播 + 文件监视
│           ├── notify-state.mjs # 状态更新统一入口（API fallback 到原子文件写入）
│           ├── dashboard-ask.mjs# 问答推送给用户 + SSE 等待回答
│           ├── serve-preview.mjs# 启停被测项目的 dev/preview 服务器（测试用）
│           ├── export-dashboard.mjs # 导出静态 HTML 留档
│           ├── hooks/           # PreToolUse/PostToolUse hooks
│           ├── lib/             # shared.mjs（共用工具）
│           ├── public/          # 单文件前端（index.html，暗色主题）
│           └── package.json     # express ^4.21.0, chokidar ^4.0.0
├── codex/
│   └── AGENTS.md                # Codex 集成文件
├── install.sh                   # 一键安装脚本（macOS/Linux）
├── install.ps1                  # 一键安装脚本（Windows）
└── README.md                    # 本文档
```

## 核心原则

- **不跳过澄清** — 需求分析中的澄清步骤不可跳过
- **非功能需求是一等公民** — 性能、安全、无障碍与功能需求同等重要
- **共识先于开发** — 需求、设计、评估三方达成共识后才进入开发，而非带着矛盾开工
- **测试先行，TDD 驱动** — 共识达成后先编写测试用例，再以 Red-Green-Refactor 模式驱动开发
- **Bug 修复先写失败测试** — 确保修复可验证、不回归
- **每个设计决策追溯到需求** — 杜绝镀金和范围蔓延
- **收敛而非线性** — 共识闭环 + TDD 闭环双轮驱动，Bug 递减收敛

## 许可证

MIT
