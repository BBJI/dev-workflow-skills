# 子技能 Dashboard 状态更新规则

本文件汇总各子技能（instruction / req-analysis / design / review / task-allocation / test / dev）在 workflow-skill 编排下运行时，更新 `workflow-state.json` 的通用规则。各子技能的 SKILL.md 只保留本技能专属的**阶段映射**和**步骤映射**，更新命令的通用部分统一引用本文件。

> 工作流编排器的完整状态更新文档（阶段转换、共识闭环、TDD 闭环、工作流完成等）见 [state-updates.md](./state-updates.md)。

## 前置条件

当本技能在 workflow-skill 编排下运行时，`.dws/{项目名}/workflow-state.json` 存在。此时需在每个步骤的开始和完成时更新状态文件，使仪表盘能实时反映进度。

**如果 `workflow-state.json` 不存在，跳过所有 Dashboard 状态更新操作，不影响技能正常执行。**

## 定位脚本

通过 `notify-state.mjs` 辅助脚本更新状态（Dashboard 运行时走 API 即时广播，未运行时 fallback 到原子文件写入）。

```bash
SKILL_DIR=$(find ~/.claude/plugins/cache -path "*/workflow-skill/SKILL.md" -not -path "*/.claude/skills/*" -print -quit 2>/dev/null || find ~/.claude/plugins/cache -path "*/workflow-skill/SKILL.md" -print -quit 2>/dev/null) && SKILL_DIR=$(dirname "$SKILL_DIR")
```

`$SKILL_DIR` 即 workflow-skill 目录；`$PROJECT_ROOT` 为项目根目录；`$PROJECT_NAME` 为项目名。

## 通用更新命令

**步骤开始时**（`N` 为本技能对应的阶段 ID，`{步骤ID}` 为本技能步骤映射中定义的 ID）：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id N --step-id {步骤ID} --status in-progress --detail "简要描述当前正在做什么"
```

**步骤完成时**（**必须**填写 `--result`，让用户在 Dashboard 点击步骤能看到有意义的执行详情）：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id N --step-id {步骤ID} --status completed --result "步骤执行结果摘要"
```

**追加活动日志**（步骤开始/完成时可选附加）：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type activity --phase N --action step-started --message "{步骤名}" --level info
```

## 重要约定

- **立即更新**：每个步骤状态变更时**必须**立即调用 `notify-state.mjs`，不要等到阶段结束再批量更新——否则 Dashboard 进度会停滞。
- **`--result` 必填**：步骤完成时务必填写 `--result`，可以是纯文本或结构化 JSON（`{summary, items, metrics, errors}`）。详见 [dashboard.md](./dashboard.md) "状态文件结构"。
- **`--detail` 用于实时进度**：步骤进行中可通过更新 `--detail`（同一 step-id 多次写 in-progress）反映细粒度子步骤，例如 TDD 的 Red/Green/Refactor 阶段。
- **容错**：Dashboard 未运行时 `notify-state.mjs` 自动 fallback 到原子文件写入；写入失败仅记录警告，不中断技能执行。
- **阶段完成由编排器负责**：子技能只需更新步骤状态；阶段（phase）的 in-progress / completed 状态由 workflow-skill 编排器统一更新。
