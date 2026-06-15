# CLAUDE.md — dev-workflow-skills

## 项目概述

Claude Code 插件，基于 Loop Engineering 原则提供全生命周期软件交付工作流。8 个技能串联为自纠错闭环：项目规范 → 需求分析 → UI/UX 设计 → 实现评估 → 任务拆分 → 测试用例 → TDD 开发 → 测试验证。

## 项目结构

```
commands/          # 斜杠命令路由（/req, /design 等）
skills/            # 8 个技能定义，每个含 SKILL.md + references/
  workflow-skill/  # 主编排器 + dashboard/
    dashboard/     # Express + SSE 实时可视化服务器
      server.mjs   # 后端（SSE + REST + 文件监视）
      public/      # 前端（单页 HTML，暗色主题）
      package.json # express ^4.21.0, chokidar ^4.0.0
codex/             # OpenAI Codex 集成 (AGENTS.md)
.claude-plugin/    # 插件注册 (plugin.json, marketplace.json)
install.ps1 / install.sh  # 安装脚本
```

## 关键约定

- **输出目录**: `.dws/{项目名}/` 按技能分子目录（req/, design/, review/, task/, test/, dev/, instruct/）
- **状态文件**: `.dws/{项目名}/workflow-state.json` — 工作流状态机，Dashboard 通过 chokidar 监视此文件
- **Dashboard 端口**: 默认 3456，自动递增至 3465；PID/PORT 文件在 `.dws/{项目名}/` 下
- **制品路径**: 存储为项目根目录的相对路径（如 `.dws/{项目名}/req/requirements.md`）

## 代码模式

- **SKILL.md**: YAML frontmatter（name + description 含触发短语）+ Markdown 正文（角色、步骤、门控条件）
- **commands/*.md**: frontmatter（description + allowed-tools）+ 简要指令读取对应 SKILL.md
- **Dashboard 前端**: 单文件 index.html，所有 CSS/JS 内联，SSE 驱动实时更新
- **Dashboard 后端**: Express server.mjs，无构建步骤，ESM 模块

## Git 规范

- 格式: `type: 描述`（中文描述）
- 类型: feat, fix, docs, refactor
- 默认分支: master

## 注意事项

- 无构建工具、无测试框架、无根 package.json
- Dashboard 需要 Node.js >= 14
- .dws/ 和 node_modules/ 已 gitignore
- 修改 Dashboard 后需手动重启服务器
