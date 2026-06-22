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

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { request } from 'http';
import { createConnection } from 'net';
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

// ── Find ALL dashboard ports under .dws/*/.dashboard.port ──
// When multiple workflow instances run in the same project root, the hook
// pushes the question to every dashboard but the --project-name passed to us
// might be the FIRST instance's name (see findProjectInfo in hook-common.mjs).
// Listening on every dashboard under .dws/ ensures we hear the answer no
// matter which instance the user actually interacted with.
function findAllDashboardPorts(projectRoot) {
  const dwsDir = join(projectRoot, '.dws');
  const ports = [];
  try {
    if (!existsSync(dwsDir)) return ports;
    for (const entry of readdirSync(dwsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const portFile = join(dwsDir, entry.name, '.dashboard.port');
      if (!existsSync(portFile)) continue;
      const port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
      if (port > 0 && port < 65536) ports.push(port);
    }
  } catch {}
  return ports;
}

function probePort(port) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = createConnection({ host: 'localhost', port }, () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(300);
    socket.on('error', () => {
      if (settled) return;
      settled = true;
      resolve(false);
    });
    socket.on('timeout', () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(false);
    });
  });
}

// ── Listen on multiple SSE ports concurrently, resolve on first matching answer ──
// Each port gets its own waitForAnswerViaSse promise. We race them and resolve
// with the first answer (or the first non-answer failure if all fail).
function waitForAnswerAcrossPorts(ports, timeoutSec, questionId) {
  if (ports.length === 0) return Promise.resolve({ kind: 'gone' });
  if (ports.length === 1) return waitForAnswerViaSse(ports[0], timeoutSec, questionId);
  return new Promise((resolve) => {
    let settled = false;
    const failures = [];
    const tryFinish = (result) => {
      if (settled) return;
      if (result.kind === 'answer') {
        settled = true;
        resolve(result);
        return;
      }
      // Non-answer failure — only resolve if ALL ports have failed.
      failures.push(result);
      if (failures.length === ports.length) {
        resolve(failures[0]);
      }
    };
    for (const port of ports) {
      waitForAnswerViaSse(port, timeoutSec, questionId).then(tryFinish);
    }
  });
}

// ── SSE subscriber: connects to /events, parses state events, resolves when
// pendingQuestion.status === 'answered' (and, if questionId is provided, the
// id matches). Connection close → DASHBOARD_GONE.
//
// No socket inactivity timeout — the server's heartbeat (30s) keeps the
// connection alive, and the overall `timeoutSec` bounds the wait. A previous
// `timeout: 5000` here set a 5s socket inactivity timeout, which fired before
// the first heartbeat and made the listener give up as DASHBOARD_GONE whenever
// the user took more than 5s to answer.
function waitForAnswerViaSse(port, timeoutSec, questionId) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    let connected = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      clearTimeout(connTimer);
      try { req.destroy(); } catch {}
      resolve(result);
    };

    const overallTimer = setTimeout(() => {
      finish({ kind: 'timeout' });
    }, timeoutSec * 1000);

    // Connection-only timeout: if the server doesn't accept the connection
    // within 5s, give up. Cleared once the response headers arrive.
    const connTimer = setTimeout(() => {
      if (!connected) finish({ kind: 'gone' });
    }, 5000);

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
          // When a questionId is provided, only accept the answer if it matches.
          // This prevents cross-workflow interference when multiple dashboards
          // are running and the user answers a different CC's question.
          if (questionId && pq.id !== questionId) return;
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
    }, (res) => {
      connected = true;
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
    req.end();
  });
}

async function main() {
  const args = parseArgs();
  const projectRoot = resolve(toWinPath(args['project-root']) || process.cwd());
  const projectName = args['project-name'] || 'default';
  const questionId = args['question-id'] || null;
  // --listen-only skips the push step and just waits. (--poll-only is accepted
  // as a deprecated alias from when this script polled the state file.)
  const listenOnly = !!(args['listen-only'] || args['poll-only']);

  if (!isDashboardRunning(projectRoot, projectName)) {
    // For --listen-only mode, the --project-name might be the FIRST instance's
    // name (hook's findProjectInfo returns the first subdir). Check if ANY
    // dashboard is running under .dws/ before giving up.
    const anyPorts = findAllDashboardPorts(projectRoot);
    if (anyPorts.length === 0) {
      console.log('DASHBOARD_NOT_RUNNING');
      process.exit(0);
    }
  }

  const { execSync } = await import('child_process');
  const scriptDir = resolve(import.meta.dirname);
  const notifyState = join(scriptDir, 'notify-state.mjs');

  // Step 1: Push question (skip if --listen-only)
  if (!listenOnly) {
    let pushCmd;
    let tmpFile;
    if (args.questions) {
      tmpFile = join(projectRoot, '.dws', projectName, '.tmp', 'questions.json');
      mkdirSync(join(projectRoot, '.dws', projectName, '.tmp'), { recursive: true });
      writeFileSync(tmpFile, args.questions, 'utf-8');
      pushCmd = `node "${notifyState}" --project-root "${projectRoot}" --project-name "${projectName}" --type question --questions @"${tmpFile}"`;
    } else if (args.question) {
      const question = args.question;
      const header = args.header || 'CC 需要你的决策';
      const multiSelect = args['multi-select'] || 'false';
      const options = args.options || '[]';

      tmpFile = join(projectRoot, '.dws', projectName, '.tmp', 'question-opts.json');
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
      try { if (tmpFile) unlinkSync(tmpFile); } catch {}
      process.exit(1);
    }
    // Clean up the temp payload — the question is now persisted in state.
    try { if (tmpFile) unlinkSync(tmpFile); } catch {}
  }

  // Step 2: Wait for answer via SSE.
  // Listen on ALL dashboards under .dws/ — when multiple workflow instances
  // share a project root, the --project-name we were passed might be the
  // FIRST instance's name (hook's findProjectInfo returns the first subdir),
  // but the user may answer in any instance's dashboard. Probing each port
  // filters out stale port files from crashed dashboards.
  const allPorts = findAllDashboardPorts(projectRoot);
  const livePorts = [];
  for (const p of allPorts) {
    if (await probePort(p)) livePorts.push(p);
  }
  if (livePorts.length === 0) {
    console.log('DASHBOARD_GONE');
    process.exit(2);
  }

  const timeout = parseInt(args.timeout) || 86400;
  const result = await waitForAnswerAcrossPorts(livePorts, timeout, questionId);

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

  // Step 3: Clear question on ALL dashboards — the answer might have come from
  // any instance's dashboard, and stale "answered" panels would confuse users.
  for (const p of livePorts) {
    try {
      execSync(`node "${notifyState}" --project-root "${projectRoot}" --project-name "${projectName}" --type question-clear`, { stdio: 'pipe', timeout: 5000 });
      break;
    } catch {}
  }
  // Also clear via direct HTTP to all live ports — notify-state only targets
  // the --project-name dashboard, but the question may live on a different
  // instance's dashboard.
  await Promise.all(livePorts.map(p => clearQuestionOnPort(p)));

  process.exit(0);
}

function clearQuestionOnPort(port) {
  return new Promise((resolve) => {
    const data = JSON.stringify({});
    const req = request({
      hostname: 'localhost',
      port,
      path: '/api/question/clear',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 3000,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve());
    });
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(data);
    req.end();
  });
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
