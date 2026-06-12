# Dev Workflow Skills

基于 **Loop Engineering** 的全流程 AI 自主交付技能套件，为 Claude Code 和 OpenAI Codex 提供从需求到交付的一键闭环能力。

## 什么是 Loop Engineering

传统线性交付（需求→设计→开发→测试）的问题在于：缺陷在下游被发现时，修复成本指数增长。Loop Engineering 用收敛反馈闭环替代线性流程——开发与测试形成迭代循环，Bug 数量应递减收敛，而非堆积到最后一刻。

```
需求分析 → UI/UX设计 → 实现评估 → 任务拆分 → 开发实现 ⇄ 测试验证
                                                      ↑______│
                                                    Bug修复闭环
```

## 技能模块

| 技能 | 指令 | 能力 |
|------|------|------|
| 需求分析 | `/req <描述>` | 将模糊想法转化为结构化需求（FR-xxx + NFR-xxx），强制澄清不可跳过 |
| UI/UX 设计 | `/design` | 设计令牌、组件规格、页面布局、交互模式，无障碍默认 WCAG 2.2 AA |
| 实现评估 | `/review` | 需求覆盖、设计一致性、技术可行性三维度评审 |
| 任务拆分 | `/task` | 原子任务分解、依赖图、关键路径、MoSCoW 优先级 |
| 开发实现 | `/dev <描述>` | 按规格编码，同步写测试，Bug 修复先写失败测试 |
| 测试验证 | `/test` | 功能/非功能/无障碍/安全/视觉一致性全维度验证 |
| 项目规范 | `/instruct` | 为 AI 编程工具生成项目规范（CLAUDE.md、AGENTS.md 等） |
| 全流程 | `/workflow <描述>` | 一键编排以上所有阶段，自动流转 |

## 快速安装

### Claude Code（一键安装）

```bash
curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/main/install.sh | bash
```

安装后重启 Claude Code，即可使用所有 `/req`、`/design`、`/workflow` 等指令。

### 同时安装到 Claude Code + Codex

```bash
curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/main/install.sh | bash -s -- --codex --project /path/to/your/project
```

这会在目标项目中生成 `AGENTS.md`，Codex 自动读取。

### 仅安装 Codex

```bash
curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/main/install.sh | bash -s -- --codex --project /path/to/your/project
```

### 使用内部 GitLab

```bash
curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/main/install.sh | bash -s -- --repo https://gitlab.example.com/skills/dev-workflow-skills.git
```

### 卸载

```bash
curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/main/install.sh | bash -s -- --uninstall
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
2. **需求分析** — 澄清 → 分解 → 结构化 → 验证
3. **UI/UX 设计** — 信息架构 → 用户流程 → 设计令牌 → 组件 → 页面 → 交互
4. **实现评估** — 需求覆盖 → 一致性 → 可行性 → 缺口 → 风险
5. **任务拆分** — 识别 → 映射 → 依赖 → 估算 → 优先级 → 迭代计划
6. **开发实现** — 理解 → 探索 → 实现 → 测试 → 自检
7. **测试验证** — 功能 → 非功能 → 无障碍 → 安全 → 视觉 → 回归

开发与测试之间形成收敛闭环，最多 3 轮 Bug 修复循环：

```
Bug数量: [N] → [N/3] → [0]
```

3 轮不收敛则暂停分析根因。

## 项目结构

```
dev-workflow-skills/
├── .claude-plugin/
│   └── plugin.json              # Claude Code 插件注册
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
│   │   └── SKILL.md
│   ├── instruction-skill/
│   │   ├── SKILL.md
│   │   └── references/
│   └── workflow-skill/
│       └── SKILL.md
├── codex/
│   └── AGENTS.md                # Codex 集成文件
└── install.sh                   # 一键安装脚本
```

## 核心原则

- **不跳过澄清** — 需求分析中的澄清步骤不可跳过
- **非功能需求是一等公民** — 性能、安全、无障碍与功能需求同等重要
- **Bug 修复先写失败测试** — 确保修复可验证、不回归
- **每个设计决策追溯到需求** — 杜绝镀金和范围蔓延
- **收敛而非线性** — 开发与测试闭环迭代，Bug 递减收敛

## 许可证

MIT
