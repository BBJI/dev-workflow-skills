#!/usr/bin/env node
// PreToolUse hook for AskUserQuestion — pushes question to Dashboard and blocks the tool.
// When Dashboard is running: pushes question + BLOCKS AskUserQuestion + tells CC to wait for the answer via SSE.
// When Dashboard is not running: exits silently (AskUserQuestion proceeds normally).

import { join, resolve } from 'path';
import {
  findDashboardPorts, findProjectInfo, httpPost, debug, readStdin,
} from './lib/hook-common.mjs';

const TAG = 'push-question';

// ── Adapt AskUserQuestion tool_input to pendingQuestion ──
function adaptQuestion(toolInput) {
  const questions = toolInput.questions || [];
  if (questions.length === 0) return null;

  return {
    id: `q-${String(Date.now()).slice(-6)}`,
    questions: questions.map((q, i) => ({
      id: `q-${i}`,
      question: q.question || '',
      header: q.header || 'CC 需要你的决策',
      multiSelect: !!q.multiSelect,
      options: (q.options || []).map((opt, j) => ({
        value: opt.value || opt.label || `opt-${j}`,
        label: opt.label || '',
        description: opt.description || ''
      })),
      allowCustom: q.allowCustom !== false
    }))
  };
}

// ── Push question to ALL running Dashboards ─────────
async function pushQuestion(payload) {
  const ports = findDashboardPorts();
  debug(TAG, `Found ports: ${ports.join(', ')}`);

  if (ports.length === 0) return false;

  debug(TAG, `Payload: ${JSON.stringify(payload).substring(0, 120)}`);

  const results = await Promise.all(
    ports.map(port => httpPost(port, '/api/question/push', payload, { readBody: true }))
  );

  for (const r of results) {
    if (r.status === 200) {
      debug(TAG, `Success on port ${r.port}: ${r.data.substring(0, 80)}`);
    } else if (r.status > 0) {
      debug(TAG, `Failed on port ${r.port}: ${r.status}`);
    }
  }

  return results.some(r => r.status === 200);
}

// ── Main ───────────────────────────────────────────
async function main() {
  try {
    const input = await readStdin();

    if (!input.trim()) {
      debug(TAG, 'No stdin input, exiting');
      process.exit(0);
    }

    const data = JSON.parse(input);
    debug(TAG, `Received: tool_name=${data.tool_name}`);

    if (data.tool_name !== 'AskUserQuestion') {
      process.exit(0);
    }

    const payload = adaptQuestion(data.tool_input || {});
    if (!payload) {
      debug(TAG, 'No question data to push');
      process.exit(0);
    }

    // Check if Dashboard is actually running
    const ports = findDashboardPorts();
    if (ports.length === 0) {
      debug(TAG, 'No Dashboard running, allowing AskUserQuestion');
      process.exit(0);
    }

    // Push question to Dashboard
    const pushed = await pushQuestion(payload);
    if (!pushed) {
      debug(TAG, 'Dashboard push failed, allowing AskUserQuestion as fallback');
      process.exit(0);
    }

    // Dashboard running + question pushed → BLOCK AskUserQuestion.
    // CC waits for the answer via dashboard-ask.mjs, which subscribes to the
    // Dashboard's SSE stream for sub-second latency and auto-detects Dashboard
    // crashes (no polling).
    const projectInfo = findProjectInfo();
    const projectRoot = projectInfo ? projectInfo.root : process.cwd();
    const projectName = projectInfo ? projectInfo.name : 'default';
    const askScript = join(resolve(import.meta.dirname), 'dashboard-ask.mjs').replace(/\\/g, '/');

    debug(TAG, 'Blocking AskUserQuestion, redirecting to dashboard-ask.mjs --listen-only');

    console.log(JSON.stringify({
      systemMessage: '问题已推送到 Dashboard，请在 Dashboard 中回答。CC 将通过 SSE 等待答案。',
      continue: false,
      stopReason: '问题已推送到 Dashboard，请在 Dashboard 中回答',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Dashboard 正在运行，请在 Dashboard 中回答问题，CC 将通过 SSE 获取答案',
        additionalContext: [
          'AskUserQuestion 已被拒绝——问题已推送到 Dashboard。',
          '请立即执行以下 Bash 命令等待用户在 Dashboard 中的回答（超时24小时，覆盖隔夜场景）：',
          '',
          `RESULT=$(node "${askScript}" --project-root "${projectRoot}" --project-name "${projectName}" --question-id "${payload.id}" --listen-only --timeout 86400)`,
          'if echo "$RESULT" | grep -q "^ANSWER_RECEIVED:"; then',
          '  ANSWER=$(echo "$RESULT" | sed \'s/^ANSWER_RECEIVED://\')',
          '  # 解析 ANSWER JSON 并继续工作流',
          'elif [ "$RESULT" = "ANSWER_TIMEOUT" ]; then',
          '  # 超时24小时，回退到 AskUserQuestion 让用户在 CLI 回答',
          'elif [ "$RESULT" = "DASHBOARD_GONE" ]; then',
          '  # Dashboard 中途崩溃，回退到 AskUserQuestion 让用户在 CLI 回答',
          'fi',
          '',
          '如果等待超时或 Dashboard 崩溃，必须回退使用 AskUserQuestion 让用户在 CLI 中回答。',
          '如果会话中断后恢复，先检查 workflow-state.json 中是否有遗留的 Dashboard 答案。'
        ].join('\n')
      }
    }));
  } catch (e) {
    debug(TAG, `Fatal: ${e.message}`);
  }

  process.exit(0);
}

main();
