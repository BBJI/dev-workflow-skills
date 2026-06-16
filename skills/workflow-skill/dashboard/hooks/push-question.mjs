#!/usr/bin/env node
// PreToolUse hook for AskUserQuestion — pushes question data to Dashboard server
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

// ── Find SKILL_DIR ─────────────────────────────────
function findSkillDir() {
  // Try from this script's location
  const scriptDir = resolve(import.meta.dirname, '..');
  if (existsSync(join(scriptDir, 'SKILL.md'))) return scriptDir;
  // Try from dws root
  const dwsRoot = findDwsRoot();
  if (!dwsRoot) return null;
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

// ── Find project root and name ──────────────────────
function findProjectInfo() {
  const dwsRoot = findDwsRoot();
  if (!dwsRoot) return { root: process.cwd(), name: 'default' };
  // dwsRoot is .../.dws, project root is parent
  const root = resolve(dwsRoot, '..');
  // Find which project has a .dashboard.port (use first one)
  try {
    const entries = readdirSync(dwsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && existsSync(join(dwsRoot, entry.name, '.dashboard.port'))) {
        return { root, name: entry.name };
      }
    }
  } catch {}
  return { root, name: 'default' };
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

// ── Output hook result JSON ─────────────────────────
function outputHookResult(block, message, additionalContext) {
  const result = {};
  if (block) {
    result.continue = false;
    result.stopReason = message;
    result.hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      additionalContext
    };
  }
  // If not blocking, output nothing (empty output = allow)
  if (Object.keys(result).length > 0) {
    console.log(JSON.stringify(result));
  }
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

    // Check if Dashboard is actually running (has port file)
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

    // Dashboard is running and question was pushed successfully.
    // BLOCK AskUserQuestion and tell CC to use dashboard-ask.mjs instead.
    const { root, name } = findProjectInfo();
    const skillDir = findSkillDir();
    const askScript = skillDir
      ? join(skillDir, 'dashboard', 'dashboard-ask.mjs').replace(/\\/g, '/')
      : 'dashboard-ask.mjs';

    debug('Blocking AskUserQuestion, redirecting to dashboard-ask.mjs');

    outputHookResult(
      true,
      '问题已推送到 Dashboard，请在 Dashboard 中回答。使用 dashboard-ask.mjs 轮询答案。',
      `AskUserQuestion 已被拦截——问题已推送到 Dashboard。请改用以下 Bash 命令轮询等待用户在 Dashboard 中的回答：\n\nRESULT=$(node "${askScript}" --project-root "${root}" --project-name "${name}" --poll-only --timeout 1800)\nif echo "$RESULT" | grep -q "^ANSWER_RECEIVED:"; then\n  ANSWER=$(echo "$RESULT" | sed 's/^ANSWER_RECEIVED://')\n  # 解析 ANSWER（JSON 格式）并继续执行工作流\nelse\n  # 超时，改用 AskUserQuestion 作为备选\nfi\n\n用户正在 Dashboard 中回答问题，轮询会自动检测答案。`
    );
  } catch (e) {
    debug(`Fatal: ${e.message}`);
  }

  process.exit(0);
}

main();
