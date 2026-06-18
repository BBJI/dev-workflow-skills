// hook-common.mjs — Shared utilities for the AskUserQuestion Pre/PostToolUse hooks.
// Extracted to keep push-question.mjs and clear-question.mjs in sync without
// copy-paste drift. All functions here are side-effect-light and synchronous
// where possible (hooks run on every AskUserQuestion call; latency matters).

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { request } from 'http';

// ── Find .dws root ─────────────────────────────────
// Walks up from cwd looking for a `.dws` directory. Bounded at 10 levels so
// a misconfigured cwd doesn't walk the whole filesystem.
export function findDwsRoot() {
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
// Reads `.dashboard.port` from every project subdir under `.dws/`. When
// `includePortScan` is true and no port files are found, falls back to
// scanning the default port range 3456-3465 — this catches dashboards
// started from a different cwd whose .dws we can't locate.
export function findDashboardPorts({ includePortScan = false } = {}) {
  const dwsRoot = findDwsRoot();
  const ports = [];
  if (dwsRoot) {
    try {
      const entries = readdirSync(dwsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const portFile = join(dwsRoot, entry.name, '.dashboard.port');
        if (!existsSync(portFile)) continue;
        const port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
        if (port > 0 && port < 65536) ports.push(port);
      }
    } catch {}
  }
  if (ports.length === 0 && includePortScan) {
    for (let p = 3456; p <= 3465; p++) ports.push(p);
  }
  return ports;
}

// ── Find project root and name from .dws ───────────
// Returns the first project subdir that has a `.dashboard.port` file.
// Used by push-question to pass --project-root/--project-name to dashboard-ask.
export function findProjectInfo() {
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

// ── Debug logging with size-based rotation ─────────
// Append-only debug log at `.dws/.hook-debug.log`. When the file crosses
// LOG_SOFT_CAP_BYTES, it gets truncated to the last LOG_KEEP_BYTES — this
// keeps the log useful for recent debugging without growing unbounded across
// long-running workflows (the original code never truncated at all).
const LOG_SOFT_CAP_BYTES = 1 * 1024 * 1024;  // 1 MB
const LOG_KEEP_BYTES = 256 * 1024;             // 256 KB

export function debug(tag, msg) {
  const dwsRoot = findDwsRoot();
  if (!dwsRoot) return;
  try {
    const logFile = join(dwsRoot, '.hook-debug.log');
    const line = `[${new Date().toISOString()}] [${tag}] ${msg}\n`;
    // Rotate if the file is over the soft cap. statSync may fail for a fresh
    // log; treat that as "no rotation needed".
    try {
      const st = statSync(logFile);
      if (st.size > LOG_SOFT_CAP_BYTES) {
        const tail = readFileSync(logFile, { encoding: 'utf-8' }).slice(-LOG_KEEP_BYTES);
        writeFileSync(logFile, tail, 'utf-8');
      }
    } catch {}
    writeFileSync(logFile, line, { flag: 'a' });
  } catch {}
}

// ── HTTP POST helper ───────────────────────────────
// Resolves with { port, status, data }. status=0 means connection failed or
// timed out — caller should treat that port as unreachable.
export function httpPost(port, path, body, { timeoutMs = 2000, readBody = false } = {}) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = request({
      hostname: 'localhost',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: timeoutMs,
    }, (res) => {
      if (!readBody) {
        res.resume();
        res.on('end', () => resolve({ port, status: res.statusCode, data: '' }));
        return;
      }
      let respData = '';
      res.on('data', (chunk) => { respData += chunk; });
      res.on('end', () => resolve({ port, status: res.statusCode, data: respData }));
    });
    req.on('error', () => resolve({ port, status: 0, data: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ port, status: 0, data: '' }); });
    req.write(data);
    req.end();
  });
}

// ── Read stdin with race-free timeout ──────────────
// Waits for stdin 'end' (the normal case — CC closes stdin after sending the
// payload). Falls back to a timeout only if 'end' never fires, e.g. if CC
// leaves stdin open. The timeout is generous (5s) because real payloads are
// small and arrive near-instantly; if we time out, we still return whatever
// chunks arrived, which is safer than the previous 500ms cutoff that could
// fire mid-stream and lose data.
export function readStdin({ timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    let timer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(chunks.join(''));
    };

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { chunks.push(chunk); });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    timer = setTimeout(finish, timeoutMs);
  });
}
