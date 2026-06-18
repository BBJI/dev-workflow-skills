# Dashboard 集成

工作流支持实时可视化仪表盘，让用户在浏览器中跟踪工作流的执行进度、步骤状态、制品和收敛趋势。

> 本文档从 `SKILL.md` 拆分而来。状态更新命令（阶段转换、共识闭环、TDD 闭环等）见 [state-updates.md](./state-updates.md)。

## 启动仪表盘

**在工作流启动的第一步（步骤1）立即执行以下操作，在任何交互之前：**

1. **创建状态文件**：使用 `notify-state.mjs` 初始化状态文件：
   - 先用 **Write 工具**将初始状态 JSON 写入临时文件（**切勿用 echo/cat 等命令写入，JSON 中的引号会导致 shell 解析错误**）：
     ```
     Write 工具：$PROJECT_ROOT/.dws/$PROJECT_NAME/.tmp/init-state.json ← 完整初始状态JSON
     ```
   - 然后执行初始化并清理：
     ```bash
     node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" --type init --state-json @"$PROJECT_ROOT/.dws/$PROJECT_NAME/.tmp/init-state.json" && rm -f "$PROJECT_ROOT/.dws/$PROJECT_NAME/.tmp/init-state.json"
     ```
   `--state-json` 支持两种方式：1) 直接传 JSON 字符串（短 JSON），2) `@文件路径` 从文件读取（推荐，避免 Windows 命令行长度限制和引号转义问题）。**注意**：临时文件必须放在 `$PROJECT_ROOT/.dws/` 下，不要用 `/tmp/`，因为 Windows 上 `/tmp/` 路径在 Write 工具和 Node.js 之间可能不一致。初始状态 JSON 结构见下方"状态文件结构"。**phases 初始化为空数组**，阶段和步骤在 CC 执行过程中通过 `--type phase --phase-name` 和 `--type step --step-name` 动态创建。consensusTracker 和 bugTracker 设为 null，activityLog 为空数组。

2. **启动仪表盘服务器**：在后台启动 Node.js 服务器：
   ```bash
   node "$SKILL_DIR/dashboard/server.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" --port 3456
   ```
   - `$SKILL_DIR` = 本 SKILL.md 文件所在的目录。使用 Bash 工具执行时定位方法：先执行 `SKILL_DIR=$(find ~/.claude/plugins/cache -path "*/workflow-skill/SKILL.md" -not -path "*/.claude/skills/*" -print -quit 2>/dev/null || find ~/.claude/plugins/cache -path "*/workflow-skill/SKILL.md" -print -quit 2>/dev/null) && SKILL_DIR=$(dirname "$SKILL_DIR")` 获取路径，然后使用 `node "$SKILL_DIR/dashboard/server.mjs" ...` 启动。**注意**：避免在命令中使用嵌套引号（如 `$(dirname "$(find ...)")`），在 Windows Git Bash 中会导致 EOF 错误；应使用 `&&` 链式调用代替嵌套。
   - 使用 Bash 工具以后台方式启动（`&` 后缀，不等待进程结束）
   - 如果端口 3456 被占用，服务器会自动尝试 3457-3465

3. **告知用户**：**醒目地**输出 Dashboard 地址，确保用户不会遗漏。格式如下：

   ```
   ╔══════════════════════════════════════════════════════════╗
   ║  📊 Dashboard 已启动！                                  ║
   ║  请在浏览器中打开：http://localhost:{端口号}              ║
   ║  可实时查看工作流进度、步骤状态、产物和收敛趋势          ║
   ╚══════════════════════════════════════════════════════════╝
   ```

   同时，使用 `notify-state.mjs` 记录 `dashboardUrl`：
   ```bash
   # 等待服务器启动并读取端口号
   PORT=$(cat .dws/{项目名}/.dashboard.port 2>/dev/null || echo 3456)
   # 通过 notify-state.mjs 补充 dashboardUrl
   node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" --type dashboard-url --url "http://localhost:$PORT"
   ```

4. **检查点提醒**：在每个检查点暂停等待用户时，附加一行提示：`📊 Dashboard: http://localhost:{端口号}`，提醒用户可以查看实时进度。

5. **如果 Node.js 不可用**：跳过仪表盘启动，仅输出提示"Dashboard 不可用（需要 Node.js）。工作流将继续正常运行。"

## 状态文件结构

`workflow-state.json` 的完整结构：

```json
{
  "projectName": "项目名",
  "projectType": "existing|new",
  "dashboardUrl": "http://localhost:3456",
  "currentPhase": 0,
  "currentIteration": 1,
  "totalIterations": null,
  "overallStatus": "in-progress",
  "autonomyLevel": "semi",
  "startedAt": "ISO时间戳",
  "updatedAt": "ISO时间戳",
  "completedAt": null,
  "phases": [],
  "consensusTracker": null,
  "bugTracker": null,
  "activityLog": []
}
```

各阶段的 steps 列表（初始化时写入，执行时更新 status）：

每个 step 的完整结构：
```json
{
  "id": "step-id",
  "name": "步骤名称",
  "status": "pending|in-progress|completed|blocked|skipped",
  "startedAt": null,
  "completedAt": null,
  "detail": "简要描述（单行，用于步骤列表内联显示）",
  "result": "步骤执行结果的详细内容（支持纯文本或结构化JSON，在Dashboard中点击步骤可展开查看）"
}
```

**`result` 字段说明**：记录步骤执行的详细结果，供用户在 Dashboard 中点击查看。可以是：
- 纯文本字符串：简要描述本步骤的产出和关键数据
- 结构化 JSON 对象：`{ "summary": "概述", "items": ["条目1", "条目2"], "metrics": { "需求数": 15, "NFR数": 8 }, "errors": ["错误信息"] }`

**重要**：每个步骤完成时，**必须**填写 `result` 字段，确保用户在 Dashboard 中点击步骤能看到有意义的执行详情。

| 阶段 | 推荐 step-id | 步骤 |
|------|-------------|------|
| 0-项目规范 | instruct-step-1~5 | 确定项目类型/收集信息/编写源文档/派生格式/验证输出 |
| 1-需求分析 | req-step-1~6 | 接收解析/澄清/分解/结构化/验证/输出 |
| 2-UI/UX设计 | design-step-1~8 | 理解需求/信息架构/用户流程/设计令牌/组件/页面/交互/无障碍 |
| 3-实现评估 | review-step-1~7 | 需求覆盖/一致性/可行性/缺口分析/风险/技术文档/评审报告 |
| 4-任务拆分 | task-step-1~7 | 识别单元/映射/依赖图/估算/优先级/迭代计划/跟踪 |
| 5-测试用例 | test-write-step-1~6 | 梳理范围/功能/非功能/无障碍/视觉/汇总 |
| 6-TDD开发 | dev-step-1~6 | 理解任务/探索/TDD实现/补充测试/自检/Bug修复 |
| 7-测试验证 | test-verify-step-1~7 | 计划/功能/非功能/视觉/回归/Bug报告/总结 |

**注意**：上表为推荐 step-id 命名规范。阶段和步骤在 Dashboard 中按需创建——CC 通过 `--phase-name` 和 `--step-name` 传入名称，Dashboard 动态生成。如果 CC 使用了不同的 step-id，Dashboard 同样支持。

## 容错

- 如果 `workflow-state.json` 不存在（单独使用子技能时），`notify-state.mjs` 会报错但不影响工作流正常执行
- 如果 Dashboard 服务器未运行，`notify-state.mjs` 自动 fallback 到直接原子文件写入
- 如果写入失败，记录警告但不中断工作流
- 状态更新与工作流执行解耦——状态更新是辅助性的，不是关键路径
- `notify-state.mjs` 支持 Dashboard 未启动时独立运行，确保子技能单独使用时状态也能正确持久化

## Dashboard 问答模式

**当 Dashboard 运行时，`AskUserQuestion` 会被 Hook 自动拦截**——问题推送到 Dashboard，CC 通过 SSE 订阅等待答案。

**为什么拦截？** `AskUserQuestion` 是阻塞式工具，CC 调用后只能等 CLI 输入，Dashboard 的回答无法注入回去。拦截后 CC 用 `dashboard-ask.mjs --listen-only` 订阅 Dashboard 的 SSE 事件流，用户在 Dashboard 回答后 CC 秒级感知并自动继续。

**自动拦截机制**：`PreToolUse` Hook（`push-question.mjs`）检测到 Dashboard 运行时：
1. 将问题推送到 Dashboard
2. **阻止** `AskUserQuestion` 调用
3. 注入 `additionalContext`，指示 CC 用 `dashboard-ask.mjs --listen-only` 等待答案（超时24小时）

**超时处理**：等待24小时无回答 → 回退到 `AskUserQuestion`，用户在 CLI 回答。`dashboard-ask.mjs` 通过 SSE 连接感知 Dashboard 是否存活——若 Dashboard 中途崩溃，SSE 连接立即关闭，脚本返回 `DASHBOARD_GONE` 让 CC 回退到 `AskUserQuestion`，避免傻等 24 小时。

**会话恢复**：如果 CC 会话中断（如关机），恢复时先检查状态文件中是否有遗留的 Dashboard 答案：
```bash
STATE_FILE=".dws/{项目名}/workflow-state.json"
DASHBOARD_ANSWER=$(node -e "try{const s=JSON.parse(require('fs').readFileSync('$STATE_FILE','utf-8'));const pq=s.pendingQuestion;if(pq&&pq.status==='answered'){const a=pq.answer;if(a.answers){process.stdout.write(JSON.stringify(a.answers))}else{process.stdout.write(JSON.stringify({selectedValues:a.selectedValues,customText:a.customText}))}}}catch{}")
if [ -n "$DASHBOARD_ANSWER" ]; then
  echo "发现 Dashboard 遗留答案: $DASHBOARD_ANSWER"
  node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" --type question-clear
fi
```

**决策流程**：

```
CC 调用 AskUserQuestion
    │
    ├─ Hook 检测 Dashboard 端口
    │   │
    │   ├─ Dashboard 运行 → 拦截 AskUserQuestion
    │   │   → 问题自动推送到 Dashboard
    │   │   → CC 用 dashboard-ask.mjs --listen-only 订阅 SSE（24h超时）
    │   │   → 用户在 Dashboard 回答 → CC 自动继续
    │   │   → 24h超时 → 回退 AskUserQuestion
    │   │   → Dashboard 中途崩溃 → DASHBOARD_GONE → 回退 AskUserQuestion
    │   │
    │   └─ Dashboard 未运行 → 放行 AskUserQuestion
    │       → 用户在 CLI 回答
    │
    └─ 会话中断恢复 → 检查状态文件遗留答案
```

**答案格式**：
- 多问题答案: `[{"questionId":"q-0","selectedValues":["opt1"],"customText":""}]`
- 单问题答案: `{"selectedValues":["opt1"],"customText":""}`

**读取答案后清理**：CC 读取答案后，`dashboard-ask.mjs` 自动调用 `--type question-clear` 清理问题面板。

**Hook 自动同步**（仅对 `AskUserQuestion` 生效）：
- `PreToolUse` Hook（`push-question.mjs`）：拦截 + 推送问题到 Dashboard
- `PostToolUse` Hook（`clear-question.mjs`）：`AskUserQuestion` 完成后清理 Dashboard 问题（兜底）

**主动使用 Dashboard 问答**（不经过 `AskUserQuestion`）：CC 也可以主动用 `dashboard-ask.mjs` 推送问题并轮询答案：
```bash
RESULT=$(node "$SKILL_DIR/dashboard/dashboard-ask.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" --question "问题" --header "标题" --options '[...]' --timeout 86400)
if [ "$RESULT" = "DASHBOARD_NOT_RUNNING" ]; then
  # Dashboard 未运行，回退到 AskUserQuestion
elif echo "$RESULT" | grep -q "^ANSWER_TIMEOUT"; then
  # 超时，回退到 AskUserQuestion
elif echo "$RESULT" | grep -q "^DASHBOARD_GONE"; then
  # Dashboard 中途崩溃，回退到 AskUserQuestion
else
  ANSWER=$(echo "$RESULT" | sed 's/^ANSWER_RECEIVED://')
fi
```

**Hook 配置**：Hook 配置在项目 `.claude/settings.json` 中，路径通过 `find` 动态解析插件缓存位置：
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "SKILL_DIR=$(find ~/.claude/plugins/cache -path \"*/workflow-skill/SKILL.md\" -not -path \"*/.claude/skills/*\" -print -quit 2>/dev/null || find ~/.claude/plugins/cache -path \"*/workflow-skill/SKILL.md\" -print -quit 2>/dev/null) && SKILL_DIR=$(dirname \"$SKILL_DIR\") && [ -f \"$SKILL_DIR/dashboard/hooks/push-question.mjs\" ] && node \"$SKILL_DIR/dashboard/hooks/push-question.mjs\" || true"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "SKILL_DIR=$(find ~/.claude/plugins/cache -path \"*/workflow-skill/SKILL.md\" -not -path \"*/.claude/skills/*\" -print -quit 2>/dev/null || find ~/.claude/plugins/cache -path \"*/workflow-skill/SKILL.md\" -print -quit 2>/dev/null) && SKILL_DIR=$(dirname \"$SKILL_DIR\") && [ -f \"$SKILL_DIR/dashboard/hooks/clear-question.mjs\" ] && node \"$SKILL_DIR/dashboard/hooks/clear-question.mjs\" || true"
          }
        ]
      }
    ]
  }
}
```
