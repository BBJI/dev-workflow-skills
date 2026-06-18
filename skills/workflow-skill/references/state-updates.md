# 状态更新机制

所有状态更新通过 `notify-state.mjs` 辅助脚本执行（位于 dashboard 目录下），而非直接操作 JSON 文件。该脚本会优先调用 Dashboard REST API 实现即时广播；若 Dashboard 未运行，则 fallback 到原子文件写入。

> 本文档从 `SKILL.md` 拆分而来。Dashboard 启动流程、状态文件结构、问答模式见 [dashboard.md](./dashboard.md)。

**定位脚本路径**（与 server.mjs 同目录）：
```bash
SKILL_DIR=$(find ~/.claude/plugins/cache -path "*/workflow-skill/SKILL.md" -not -path "*/.claude/skills/*" -print -quit 2>/dev/null || find ~/.claude/plugins/cache -path "*/workflow-skill/SKILL.md" -print -quit 2>/dev/null) && SKILL_DIR=$(dirname "$SKILL_DIR")
```

**约定**：以下所有示例中，`$SKILL_DIR` 为上述路径，`$PROJECT_ROOT` 为项目根目录，`$PROJECT_NAME` 为项目名。

**重要**：每个步骤状态变更时，**必须**立即调用 `notify-state.mjs`，确保 Dashboard 实时反映进度。不要等到阶段结束再批量更新。

## 阶段转换更新

**阶段开始时**（3 条命令，按顺序执行）：
```bash
# 1. 更新整体状态：设置当前阶段
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type overall --current-phase N --overall-status in-progress

# 2. 更新阶段状态：标记阶段进行中（自动创建阶段，自动标记第一步为 in-progress）
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type phase --phase-id N --phase-name "{阶段名}" --status in-progress

# 3. 追加活动日志
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type activity --phase N --action phase-started --message "开始{阶段名}" --level info
```

**阶段完成时**（2 条命令）：
```bash
# 1. 更新阶段状态：标记阶段完成（自动将未完成步骤标为 completed）+ 制品
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type phase --phase-id N --phase-name "{阶段名}" --status completed --artifacts '[{"name":"文件名","path":"相对路径","type":"markdown","generatedAt":"ISO时间戳"}]'

# 2. 追加活动日志
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type activity --phase N --action phase-completed --message "完成{阶段名}" --level success
```

**步骤状态更新**（在每个步骤开始和完成时）：
```bash
# 步骤开始
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id N --step-id {步骤ID} --step-name "{步骤名}" --status in-progress --detail "简要描述当前正在做什么"

# 步骤完成
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id N --step-id {步骤ID} --step-name "{步骤名}" --status completed --result "步骤执行结果摘要"
```

## 共识闭环更新（阶段三）

每轮评审后，调用 consensus API：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type consensus --round N --fatal-issues X --high-issues Y --medium-issues Z --low-issues W \
  --status "consensus-not-reached|consensus-reached" \
  --req-adjustments A --design-adjustments B \
  --details '{"summary":"本轮评审概述","items":["具体问题1","具体问题2"],"metrics":{"覆盖需求%":"85%"}}'
```

- 共识达成时 `--status consensus-reached`，API 自动将 overallStatus 改回 in-progress
- 达到最大轮次仍未达成，API 自动设置 escalated

## TDD 闭环更新（阶段六~七）

每轮测试验证后，调用 bug API：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type bug --round N --new-bugs X --fixed-bugs Y --remaining-bugs Z \
  --iteration-id "iter-N" \
  --details '{"summary":"本轮测试概述","items":["Bug1: 描述","Bug2: 描述"],"metrics":{"通过率":"92%"}}'
```

**致命级强制升级**（dev server 启动失败等阻塞全流程的缺陷）：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type bug --round 1 --new-bugs 1 --fixed-bugs 0 --remaining-bugs 1 \
  --fatal-bug true --escalate-reason "dev server 启动失败: 端口探测超时" \
  --details '{"summary":"应用无法启动","items":["log.txt 显示 Module not found"],"metrics":{"启动耗时":"60s"}}'
```

### bugTracker 状态机

`workflow-state.json` 中的 `bugTracker` 结构：
```json
{
  "rounds": [
    { "round": 1, "newBugs": 8, "fixedBugs": 0, "remainingBugs": 8, "iterationId": "iter-1", "details": {...} },
    { "round": 2, "newBugs": 3, "fixedBugs": 6, "remainingBugs": 5, "iterationId": "iter-1", "details": {...} }
  ],
  "currentRound": 2,
  "maxRounds": 3,
  "status": "converging",
  "escalationReason": null
}
```

**状态转移规则**（按优先级，命中即停止判断）：

| 优先级 | 条件 | 新状态 | escalationReason |
|--------|------|--------|------------------|
| 1 | `remainingBugs === 0` | `stable` | null |
| 2 | `fatalBug=true` 或 `escalateReason` 提供 | `escalated` | 传入的 reason 或 `fatal-bug` |
| 3 | 最近 2 轮 `newBugs` 不递减（均 > 0） | `escalated` | `trend-not-converging (newBugs X→Y)` |
| 4 | `round >= maxRounds(3)` 且 `remainingBugs > 0` | `escalated` | `max-rounds (3) exhausted` |
| 5 | 其他 | `converging` | null |

**为什么有趋势检测（规则 3）**：原始规则只看 `maxRounds`，但 Bug 列表 `[8] → [10] → [12]` 这种"越修越多"的情况要等到第 3 轮才升级，白白浪费 2 轮循环。趋势检测在第 2 轮就能识别不收敛，提前升级。

**升级后的处理**：状态机只负责记录 `escalated` 状态，**不自动暂停工作流**。workflow-skill 编排器在调用 bug API 后必须检查 `state.bugTracker.status`：

- `stable` → 迭代收敛，进入下一迭代或工作流完成
- `converging` → 继续 Bug 修复循环
- `escalated` → **暂停 TDD 闭环**，向用户升级：
  ```bash
  node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
    --type activity --phase 7 --action tdd-loop-escalated --message "TDD 闭环升级: {escalationReason} — 暂停等待用户决策" --level error
  ```
  然后用 AskUserQuestion 询问用户：继续修复 / 调整设计 / 回退到需求评审。**不要继续跑同样的闭环期待不同结果**。

## 工作流完成

```bash
# 1. 更新整体状态为完成
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type overall --overall-status completed

# 2. 追加活动日志
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type activity --phase {currentPhase} --action workflow-completed --message "工作流完成" --level success

# 3. 导出静态 Dashboard（关闭前留档）
node "$SKILL_DIR/dashboard/export-dashboard.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME"

# 4. 主动关闭仪表盘
kill $(cat .dws/{项目名}/.dashboard.pid) 2>/dev/null || taskkill /PID $(cat .dws/{项目名}/.dashboard.pid) 2>/dev/null || true

# 5. 记录 Dashboard 关闭日志
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type activity --phase {currentPhase} --action dashboard-stopped --message "Dashboard 已关闭" --level info
```

## 活动日志管理

- activityLog 最多保留 200 条记录。追加新记录后，如果总数超过 250（软上限），自动 trim 到 200 条。软上限的设计是为了避免每次追加都触发 O(n) 的 slice，将 trim 成本摊销到 ~50 次追加。
- 每条记录包含：timestamp（ISO时间戳）、phase（0-7）、action（动作标识）、message（人类可读描述）、level（info/warning/error/success）

## 制品记录

每个阶段完成后，将产出的文件记录到 `phases[N].artifacts` 数组中。每条记录包含：
- `name`：文件显示名
- `path`：相对于项目根目录的路径（如 `.dws/{项目名}/req/requirements.md`）
- `type`：文件类型（`markdown`|`html`|`image`|`json`|`other`）
- `generatedAt`：生成时间（ISO时间戳）

阶段完成时还会自动扫描该阶段的制品目录（如 `.dws/{项目名}/req/`），将扫描到的文件合并进 `artifacts`——即使 CC 忘记显式传 `--artifacts`，文件也会被注册。
