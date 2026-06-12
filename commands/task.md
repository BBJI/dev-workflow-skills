---
description: 任务拆分 — 将评审通过的方案分解为可实施任务并排期
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, AskUserQuestion
---

请使用 `task-allocation-skill` 技能执行任务拆分与排期。

读取技能文件：`SKILL.md` 位于 `skills/task-allocation-skill/` 目录下（相对于本插件根目录）。

按照技能中的流程执行：
1. 识别工作单元
2. 映射任务到需求和设计
3. 构建依赖图
4. 估算工作量
5. 分配优先级
6. 创建迭代计划
7. 设置进度跟踪

输出任务分解、迭代计划和进度跟踪器。

待拆分的内容如下：

$ARGUMENTS
