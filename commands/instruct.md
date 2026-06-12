---
description: 项目规范生成 — 为AI编程工具生成项目规范文件
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, AskUserQuestion
---

请使用 `instruction-skill` 技能生成项目规范文档。

读取技能文件：`SKILL.md` 位于 `skills/instruction-skill/` 目录下（相对于本插件根目录）。
如需格式详情，读取 `skills/instruction-skill/references/tool-formats.md`。
如需项目模板，读取 `skills/instruction-skill/references/project-templates.md`。

按照技能中的流程执行：
1. 确定项目类型（已有/新建）和目标工具
2. 收集项目信息
3. 编写统一源文档
4. 派生工具特定格式（CLAUDE.md、AGENTS.md、.cursor/rules/等）
5. 验证与输出

项目信息如下：

$ARGUMENTS
