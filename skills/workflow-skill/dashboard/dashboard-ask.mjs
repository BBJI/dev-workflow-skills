#!/usr/bin/env node
// dashboard-ask.mjs — Dashboard Q&A helper: push question(s) + wait for answer via SSE + clear
// Usage:
//   Push + wait:  node dashboard-ask.mjs --project-root ... --project-name ... --question "text" --header "title" --options '[...]'
//   Push + wait:  node dashboard-ask.mjs --project-root ... --project-name ... --questions '[{...},{...}]'
//   Listen only:  node dashboard-ask.mjs --project-root ... --project-name ... --listen-only [--timeout 1800]
//
// Exit codes / output prefixes (parsed by CC):
//   ANSWER_RECEIVED:<json>  — got an answer, return immediately
//   DASHBOARD_NOT_RUNNING   — port file missing at startup, fall back to AskUserQuestion
//   DASHBOARD_GONE          — dashboard died mid-wait (SSE connection closed), fall back to AskUserQuestion
//   ANSWER_TIMEOUT          — no answer within --timeout, fall back to AskUserQuestion
//
// Why SSE instead of file polling? The dashboard already broadcasts every state
// mutation to /events subscribers. Subscribing gives us sub-second answer
// latency and free death detection (connection closes when the dashboard
// process dies) without polling the state file every 2s.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { request } from 'http';
import { parseArgs, toWinPath } from './lib/shared.mjs';

function readPid(projectRoot, projectName) {
  const pidFile = join(projectRoot, '.dws', projectName, '.dashboard.pid');
  try {
    if (existsSync(pidFile)) return parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
  } catch {}
  return null;
}

function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readPort(projectRoot, projectName) {
  const portFile = join(projectRoot, '.dws', projectName, '.dashboard.port');
  try {
    if (existsSync(portFile)) {
      const port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
      if (port > 0 && port < 65536) return port;
    }
  } catch {}
  return null;
}

function isDashboardRunning(projectRoot, projectName) {
  const port = readPort(projectRoot, projectName);
  if (!port) return false;
  const pid = readPid(projectRoot, projectName);
  return isProcessAlive(pid);
}

// ── SSE subscriber: connects to /events, parses state events, resolves when
// pendingQuestion.status === 'answered'. Connection close → DASHBOARD_GONE.
function waitForAnswerViaSse(port, timeoutSec) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch {}
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({ kind: 'timeout' });
    }, timeoutSec * 1000);

    const handleEventBlock = (block) => {
      let eventType = '';
      let dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      // Heartbeat comments (': heartbeat\n\n') produce empty event blocks — skip.
      if (eventType !== 'state' || !dataStr) return;
      try {
        const state = JSON.parse(dataStr);
        const pq = state.pendingQuestion;
        if (pq && pq.status === 'answered') {
          finish({ kind: 'answer', answer: pq.answer });
        }
      } catch {}
    };

    const req = request({
      hostname: 'localhost',
      port,
      path: '/events',
      method: 'GET',
      headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
      timeout: 5000,
    }, (res) => {
      if (res.statusCode !== 200) {
        finish({ kind: 'gone' });
        return;
      }
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (block.trim()) handleEventBlock(block);
        }
      });
      res.on('close', () => finish({ kind: 'gone' }));
      res.on('error', () => finish({ kind: 'gone' }));
    });

    req.on('error', () => finish({ kind: 'gone' }));
    req.on('timeout', () => finish({ kind: 'gone' }));
    req.end();
  });
}

async function main() {
  const args = parseArgs();
  const projectRoot = resolve(toWinPath(args['project-root']) || process.cwd());
  const projectName = args['project-name'] || 'default';
  // --listen-only skips the push step and just waits. (--poll-only is accepted
  // as a deprecated alias from when this script polled the state file.)
  const listenOnly = !!(args['listen-only'] || args['poll-only']);

  if (!isDashboardRunning(projectRoot, projectName)) {
    console.log('DASHBOARD_NOT_RUNNING');
    process.exit(0);
  }

  const { execSync } = await import('child_process');
  const scriptDir = resolve(import.meta.dirname);
  const notifyState = join(scriptDir, 'notify-state.mjs');

  // Step 1: Push question (skip if --listen-only)
  if (!listenOnly) {
    let pushCmd;
    if (args.questions) {
      const tmpFile = join(projectRoot, '.dws', projectName, '.tmp', 'questions.json');
      mkdirSync(join(projectRoot, '.dws', projectName, '.tmp'), { recursive: true });
      writeFileSync(tmpFile, args.questions, 'utf-8');
      pushCmd = `node "${notifyState}" --project-root "${projectRoot}" --project-name "${projectName}" --type question --questions @"${tmpFile}"`;
    } else if (args.question) {
      const question = args.question;
      const header = args.header || 'CC 需要你的决策';
      const multiSelect = args['multi-select'] || 'false';
      const options = args.options || '[]';

      const tmpFile = join(projectRoot, '.dws', projectName, '.tmp', 'question-opts.json');
      mkdirSync(join(projectRoot, '.dws', projectName, '.tmp'), { recursive: true });

      const payload = { question, header, multiSelect: multiSelect === 'true', options: JSON.parse(options) };
      writeFileSync(tmpFile, JSON.stringify([payload]), 'utf-8');
      pushCmd = `node "${notifyState}" --project-root "${projectRoot}" --project-name "${projectName}" --type question --questions @"${tmpFile}"`;
    } else {
      console.error('Usage: --question "text" --options [...] or --questions [...]  or --listen-only');
      process.exit(1);
    }

    try {
      execSync(pushCmd, { stdio: 'pipe', timeout: 5000 });
    } catch (e) {
      console.error('Push failed:', e.message);
      process.exit(1);
    }
  }

  // Step 2: Wait for answer via SSE
  const port = readPort(projectRoot, projectName);
  if (!port) {
    console.log('DASHBOARD_GONE');
    process.exit(2);
  }

  const timeout = parseInt(args.timeout) || 86400;
  const result = await waitForAnswerViaSse(port, timeout);

  if (result.kind === 'timeout') {
    console.log('ANSWER_TIMEOUT');
    process.exit(1);
  }
  if (result.kind === 'gone') {
    console.log('DASHBOARD_GONE');
    process.exit(2);
  }

  // result.kind === 'answer'
  const answer = result.answer;
  if (answer.answers && Array.isArray(answer.answers)) {
    console.log('ANSWER_RECEIVED:' + JSON.stringify(answer.answers));
  } else {
    console.log('ANSWER_RECEIVED:' + JSON.stringify({
      selectedValues: answer.selectedValues,
      customText: answer.customText || ''
    }));
  }

  // Step 3: Clear question
  try {
    execSync(`node "${notifyState}" --project-root "${projectRoot}" --project-name "${projectName}" --type question-clear`, { stdio: 'pipe', timeout: 5000 });
  } catch {}

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
