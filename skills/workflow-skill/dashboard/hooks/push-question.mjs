#!/usr/bin/env node
// PreToolUse hook for AskUserQuestion — pushes question data to Dashboard server
// Silent-fail: if Dashboard is not running, exits 0 without error

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
function findAllDashboardPorts() {
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
  // Also try default ports if none found
  if (ports.length === 0) {
    for (let p = 3456; p <= 3465; p++) ports.push(p);
  }
  return ports;
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
  const ports = findAllDashboardPorts();
  debug(`Found ports: ${ports.join(', ')}`);

  const body = JSON.stringify(payload);
  debug(`Payload: ${body.substring(0, 120)}`);

  // Try all ports concurrently, push to those that respond
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
}

// ── Adapt AskUserQuestion tool_input to pendingQuestion ──
function adaptQuestion(toolInput) {
  // AskUserQuestion format: { questions: [{ question, header, options, multiSelect }] }
  const questions = toolInput.questions || [];
  if (questions.length === 0) return null;

  // Return array of individual questions — Dashboard will render tabs
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
    // Read stdin (Hook provides tool_input as JSON on stdin)
    const chunks = [];
    const stdinPromise = new Promise((resolve) => {
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (chunk) => { chunks.push(chunk); });
      process.stdin.on('end', resolve);
      process.stdin.on('error', resolve);
      // Timeout: if stdin is not piped, don't hang
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

    await pushQuestion(payload);
  } catch (e) {
    debug(`Fatal: ${e.message}`);
  }

  process.exit(0);
}

main();
