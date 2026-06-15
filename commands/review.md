---
description: 实现评估 — 从需求、设计、技术三维度评审方案可行性，反馈至需求和设计调整直至三方共识
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, AskUserQuestion
---

请使用 `review-skill` 技能执行三维度实现评估。

读取技能文件：`SKILL.md` 位于 `skills/review-skill/` 目录下（相对于本插件根目录）。

按照技能中的流程执行：
1. 需求覆盖审计
2. 设计-需求一致性检查
3. 技术可行性评估
4. 跨维度缺口分析
5. 风险评估
6. 输出评审报告与反馈

评估完成后判定共识状态。如共识未达成，将反馈清单分别传递给 `req-analysis-skill` 和 `design-skill` 执行调整，再进行下一轮评估，直至三方达成共识。

共识收敛规则：
- 每轮致命问题必须递减
- 最大5轮评估，超出后向用户升级
- 共识达成条件：无致命问题 + 高优先级问题有缓解计划 + 需求与设计无矛盾

评估输入如下：

$ARGUMENTS
