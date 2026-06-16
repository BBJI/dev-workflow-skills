#!/usr/bin/env node
// PostToolUse hook for AskUserQuestion — clears question from Dashboard after CLI handles it

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
    writeFileSync(logFile, `[${ts}] [clear-question] ${msg}\n`, { flag: 'a' });
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
      res.resume();
      res.on('end', () => resolve({ port, status: res.statusCode }));
    });
    req.on('error', () => resolve({ port, status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ port, status: 0 }); });
    req.write(data);
    req.end();
  });
}

// ── Clear question from ALL running Dashboards ──────
async function clearQuestion() {
  const ports = findAllDashboardPorts();
  debug(`Clearing on ports: ${ports.join(', ')}`);

  const results = await Promise.all(
    ports.map(port => httpPost(port, '/api/question/clear', {}))
  );

  for (const r of results) {
    if (r.status === 200) {
      debug(`Cleared on port ${r.port}`);
    }
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

    if (input.trim()) {
      try {
        const data = JSON.parse(input);
        debug(`Received: tool_name=${data.tool_name}`);
        if (data.tool_name !== 'AskUserQuestion') {
          process.exit(0);
        }
      } catch {}
    }

    await clearQuestion();
  } catch (e) {
    debug(`Fatal: ${e.message}`);
  }

  process.exit(0);
}

main();
