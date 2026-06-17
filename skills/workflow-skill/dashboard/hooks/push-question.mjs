#!/usr/bin/env node
// PreToolUse hook for AskUserQuestion — pushes question to Dashboard and blocks the tool
// When Dashboard is running: pushes question + BLOCKS AskUserQuestion + tells CC to poll
// When Dashboard is not running: exits silently (AskUserQuestion proceeds normally)

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { request } from 'http';

// ── Find .dws root ─────────────────────────────────
function findDwsRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.dws'))) return join(dir, '.dws');
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ── Find ALL Dashboard ports ───────────────────────
function findDashboardPorts() {
  const dwsRoot = findDwsRoot();
  const ports = [];
  if (!dwsRoot) return ports;
  try {
    const entries = readdirSync(dwsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const portFile = join(dwsRoot, entry.name, '.dashboard.port');
        if (existsSync(portFile)) {
          const port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
          if (port > 0 && port < 65536) ports.push(port);
        }
      }
    }
  } catch {}
  return ports;
}

// ── Find project root and name from .dws ───────────
function findProjectInfo() {
  const dwsRoot = findDwsRoot();
  if (!dwsRoot) return null;
  const root = resolve(dwsRoot, '..');
  try {
    const entries = readdirSync(dwsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && existsSync(join(dwsRoot, entry.name, '.dashboard.port'))) {
        return { root, name: entry.name };
      }
    }
  } catch {}
  return null;
}

// ── Debug logging ──────────────────────────────────
function debug(msg) {
  const dwsRoot = findDwsRoot();
  if (!dwsRoot) return;
  try {
    const logFile = join(dwsRoot, '.hook-debug.log');
    const ts = new Date().toISOString();
    writeFileSync(logFile, `[${ts}] [push-question] ${msg}\n`, { flag: 'a' });
  } catch {}
}

// ── HTTP POST helper ───────────────────────────────
function httpPost(port, path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = request({
      hostname: 'localhost',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 2000
    }, (res) => {
      let respData = '';
      res.on('data', (chunk) => { respData += chunk; });
      res.on('end', () => {
        resolve({ port, status: res.statusCode, data: respData });
      });
    });
    req.on('error', () => resolve({ port, status: 0, data: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ port, status: 0, data: '' }); });
    req.write(data);
    req.end();
  });
}

// ── Push question to ALL running Dashboards ─────────
async function pushQuestion(payload) {
  const ports = findDashboardPorts();
  debug(`Found ports: ${ports.join(', ')}`);

  if (ports.length === 0) return false;

  const body = JSON.stringify(payload);
  debug(`Payload: ${body.substring(0, 120)}`);

  const results = await Promise.all(
    ports.map(port => httpPost(port, '/api/question/push', payload))
  );

  for (const r of results) {
    if (r.status === 200) {
      debug(`Success on port ${r.port}: ${r.data.substring(0, 80)}`);
    } else if (r.status > 0) {
      debug(`Failed on port ${r.port}: ${r.status}`);
    }
  }

  return results.some(r => r.status === 200);
}

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

// ── Main ───────────────────────────────────────────
async function main() {
  try {
    const chunks = [];
    const stdinPromise = new Promise((resolve) => {
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (chunk) => { chunks.push(chunk); });
      process.stdin.on('end', resolve);
      process.stdin.on('error', resolve);
      setTimeout(resolve, 500);
    });
    await stdinPromise;
    const input = chunks.join('');

    if (!input.trim()) {
      debug('No stdin input, exiting');
      process.exit(0);
    }

    const data = JSON.parse(input);
    debug(`Received: tool_name=${data.tool_name}`);

    if (data.tool_name !== 'AskUserQuestion') {
      process.exit(0);
    }

    const payload = adaptQuestion(data.tool_input || {});
    if (!payload) {
      debug('No question data to push');
      process.exit(0);
    }

    // Check if Dashboard is actually running
    const ports = findDashboardPorts();
    if (ports.length === 0) {
      debug('No Dashboard running, allowing AskUserQuestion');
      process.exit(0);
    }

    // Push question to Dashboard
    const pushed = await pushQuestion(payload);
    if (!pushed) {
      debug('Dashboard push failed, allowing AskUserQuestion as fallback');
      process.exit(0);
    }

    // Dashboard running + question pushed → BLOCK AskUserQuestion
    // CC should use dashboard-ask.mjs --poll-only to get the answer
    const projectInfo = findProjectInfo();
    const projectRoot = projectInfo ? projectInfo.root : process.cwd();
    const projectName = projectInfo ? projectInfo.name : 'default';
    const askScript = join(resolve(import.meta.dirname), 'dashboard-ask.mjs').replace(/\\/g, '/');

    debug('Blocking AskUserQuestion, redirecting to dashboard-ask.mjs --poll-only');

    console.log(JSON.stringify({
      continue: false,
      stopReason: '问题已推送到 Dashboard，请在 Dashboard 中回答。CC 将轮询等待答案。',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: [
          'AskUserQuestion 已被拦截——问题已推送到 Dashboard。',
          '请立即执行以下 Bash 命令轮询等待用户在 Dashboard 中的回答（超时24小时，覆盖隔夜场景）：',
          '',
          `RESULT=$(node "${askScript}" --project-root "${projectRoot}" --project-name "${projectName}" --poll-only --timeout 86400)`,
          'if echo "$RESULT" | grep -q "^ANSWER_RECEIVED:"; then',
          '  ANSWER=$(echo "$RESULT" | sed \'s/^ANSWER_RECEIVED://\')',
          '  # 解析 ANSWER JSON 并继续工作流',
          'elif [ "$RESULT" = "ANSWER_TIMEOUT" ]; then',
          '  # 超时24小时，回退到 AskUserQuestion 让用户在 CLI 回答',
          'fi',
          '',
          '如果轮询超时，必须回退使用 AskUserQuestion 让用户在 CLI 中回答。',
          '如果会话中断后恢复，先检查 workflow-state.json 中是否有遗留的 Dashboard 答案。'
        ].join('\n')
      }
    }));
  } catch (e) {
    debug(`Fatal: ${e.message}`);
  }

  process.exit(0);
}

main();
