---
description: 全流程交付 — Loop Engineering闭环从需求到交付一键执行
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, AskUserQuestion, LSP, Agent, Skill
---

请使用 `workflow-skill` 技能执行全流程交付。

读取技能文件：`SKILL.md` 位于 `skills/workflow-skill/` 目录下（相对于本插件根目录）。

## 执行流程

### 1. 判断项目类型
- 已有代码库 → 先执行阶段零（项目规范生成），再进入需求分析
- 全新项目 → 直接进入需求分析，最后执行阶段零

### 2. 按阶段顺序执行

**阶段零**（已有项目先做，新项目后做）：使用 `instruction-skill`
**阶段一**：使用 `req-analysis-skill` — 需求分析
**阶段二**：使用 `design-skill` — UI/UX设计
**阶段三**：使用 `review-skill` — 实现评估
**阶段四**：使用 `task-allocation-skill` — 任务拆分
**阶段五**：使用 `test-skill`（用例编写模式）— 测试用例编写
**阶段六**：使用 `dev-skill`（TDD模式）— TDD开发实现（含测试反馈的Bug修复循环）
**阶段七**：使用 `test-skill`（验证模式）— 测试验证

每个阶段的门控条件必须满足才能进入下一阶段。共识达成后先编写测试用例，再以TDD模式开发，测试验证发现Bug时反馈给开发修复，形成收敛闭环。

### 3. 检查点
在半自主模式下，每个阶段完成后暂停等待用户确认。

---

用户的需求/项目描述：

$ARGUMENTS
