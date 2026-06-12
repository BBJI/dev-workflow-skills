---
description: 需求调研分析 — 将模糊想法转化为结构化需求文档
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, AskUserQuestion
---

请使用 `req-analysis-skill` 技能执行需求调研分析。

读取技能文件：`SKILL.md` 位于 `skills/req-analysis-skill/` 目录下（相对于本插件根目录）。

按照技能中的流程执行：
1. 接收用户的需求描述
2. 提出澄清问题（不可跳过）
3. 分解为功能需求(FR-xxx)和非功能需求(NFR-xxx)
4. 结构化并验证
5. 输出需求文档、追溯矩阵和待决问题/风险

用户的需求描述如下，请开始分析：

$ARGUMENTS
