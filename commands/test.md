---
description: 测试用例编写/测试验证 — 开发前编写测试用例驱动TDD，开发后验证交付物
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, AskUserQuestion, LSP, Agent, mcp__plugin_playwright_playwright__browser_navigate, mcp__plugin_playwright_playwright__browser_click, mcp__plugin_playwright_playwright__browser_type, mcp__plugin_playwright_playwright__browser_snapshot, mcp__plugin_playwright_playwright__browser_evaluate, mcp__plugin_playwright_playwright__browser_take_screenshot, mcp__plugin_playwright_playwright__browser_console_messages, mcp__plugin_playwright_playwright__browser_resize, mcp__plugin_playwright_playwright__browser_press_key, mcp__plugin_playwright_playwright__browser_select_option, mcp__plugin_playwright_playwright__browser_wait_for, mcp__plugin_playwright_playwright__browser_hover, mcp__plugin_playwright_playwright__browser_close
---

请使用 `test-skill` 技能执行测试任务。

读取技能文件：`SKILL.md` 位于 `skills/test-skill/` 目录下（相对于本插件根目录）。

根据上下文自动判断模式：

**模式一：测试用例编写**（开发前）— 基于需求文档、设计规范、原型图、设计稿、交互说明、技术实现文档编写完整测试用例
1. 梳理测试范围
2. 编写功能测试用例
3. 编写非功能测试用例
4. 编写无障碍测试用例
5. 编写视觉一致性测试用例
6. 汇总测试用例文档

**模式二：测试验证**（开发后）— 对照需求和设计验证开发交付物
1. 制定测试计划
1.5. 自动化浏览器环境准备（启动被测应用 + Playwright MCP 自检；不可用时降级）
2. 功能测试（由 Playwright MCP 自动执行）
3. 非功能测试（性能/无障碍/响应式/安全，由 Playwright MCP 自动执行）
4. 视觉/设计一致性测试（由 Playwright MCP 自动执行）
5. 回归测试
6. Bug报告
7. 测试总结报告（仅降级时输出"需人工补测项"）

待测试的内容如下：

$ARGUMENTS
