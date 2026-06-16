#!/usr/bin/env node
// notify-state.mjs — Helper script for CC to update workflow state via Dashboard API
// Falls back to direct file write when Dashboard is not running

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { request } from 'http';

// ── Git Bash path conversion (Windows) ──────────────
function toWinPath(p) {
  if (!p) return p;
  if (process.platform !== 'win32') return p;
  return p.replace(/^\/([a-zA-Z])(\/|$)/, (_, drive, sep) => drive.toUpperCase() + ':' + (sep ? '\\' : ''));
}

// ── Parse CLI args ──────────────────────────────────
function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ── HTTP POST helper ────────────────────────────────
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
      timeout: 3000
    }, (res) => {
      let respData = '';
      res.on('data', (chunk) => { respData += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(respData) });
        } catch {
          resolve({ status: res.statusCode, data: respData });
        }
      });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.write(data);
    req.end();
  });
}

// ── Find Dashboard port ────────────────────────────
function findDashboardPort(projectRoot, projectName) {
  const portFile = join(projectRoot, '.dws', projectName, '.dashboard.port');
  try {
    if (existsSync(portFile)) {
      const port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
      if (port > 0 && port < 65536) return port;
    }
  } catch {}
  // Try default range
  return null;
}

// ── Direct file write fallback ──────────────────────
function readStateFile(stateFile) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!existsSync(stateFile)) return null;
      return JSON.parse(readFileSync(stateFile, 'utf-8'));
    } catch {
      if (attempt === 0) continue;
    }
  }
  return null;
}

function writeStateFileAtomic(stateFile, state) {
  const tmp = stateFile + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  renameSync(tmp, stateFile);
}

function pushActivity(state, phase, action, message, level) {
  state.activityLog.push({
    timestamp: new Date().toISOString(),
    phase,
    action,
    message,
    level: level || 'info'
  });
  if (state.activityLog.length > 200) {
    state.activityLog = state.activityLog.slice(-200);
  }
}

// ── Direct file mutation fallbacks ─────────────────
function fallbackStep(stateFile, phaseId, stepId, status, detail, result) {
  const state = readStateFile(stateFile);
  if (!state) { console.error('State file not found:', stateFile); process.exit(1); }

  const phase = (state.phases || []).find(p => p.id === phaseId);
  if (!phase) { console.error('Phase not found:', phaseId); process.exit(1); }
  const step = (phase.steps || []).find(s => s.id === stepId);
  if (!step) { console.error('Step not found:', stepId); process.exit(1); }

  const prevStatus = step.status;
  step.status = status;
  const now = new Date().toISOString();
  if (status === 'in-progress' && !step.startedAt) step.startedAt = now;
  if (['completed', 'blocked', 'skipped'].includes(status)) step.completedAt = now;
  if (detail !== undefined) step.detail = detail;
  if (result !== undefined) step.result = result;

  if (prevStatus !== status) {
    const level = status === 'completed' ? 'success' : status === 'blocked' ? 'error' : 'info';
    pushActivity(state, phaseId, 'step-' + status, step.name, level);
  }

  state.updatedAt = now;
  writeStateFileAtomic(stateFile, state);
  console.log(`OK step ${stepId} -> ${status}`);
}

function fallbackPhase(stateFile, phaseId, status, artifacts) {
  const state = readStateFile(stateFile);
  if (!state) { console.error('State file not found:', stateFile); process.exit(1); }

  const phase = (state.phases || []).find(p => p.id === phaseId);
  if (!phase) { console.error('Phase not found:', phaseId); process.exit(1); }

  phase.status = status;
  const now = new Date().toISOString();
  if (status === 'in-progress' && !phase.startedAt) {
    phase.startedAt = now;
    if (phase.steps && phase.steps.length > 0 && phase.steps[0].status === 'pending') {
      phase.steps[0].status = 'in-progress';
      phase.steps[0].startedAt = now;
    }
  }
  if (['completed', 'skipped'].includes(status)) {
    phase.completedAt = now;
    if (phase.steps) {
      for (const step of phase.steps) {
        if (step.status !== 'completed' && step.status !== 'skipped') {
          step.status = status === 'skipped' ? 'skipped' : 'completed';
          if (!step.startedAt) step.startedAt = now;
          step.completedAt = now;
        }
      }
    }
  }
  if (artifacts) phase.artifacts = artifacts;

  const level = status === 'completed' ? 'success' : status === 'blocked' ? 'error' : 'info';
  pushActivity(state, phaseId, 'phase-' + status, phase.name, level);
  state.updatedAt = now;
  writeStateFileAtomic(stateFile, state);
  console.log(`OK phase ${phaseId} -> ${status}`);
}

function fallbackOverall(stateFile, currentPhase, overallStatus, currentIteration, totalIterations) {
  const state = readStateFile(stateFile);
  if (!state) { console.error('State file not found:', stateFile); process.exit(1); }

  if (currentPhase !== undefined) state.currentPhase = currentPhase;
  if (overallStatus !== undefined) state.overallStatus = overallStatus;
  if (currentIteration !== undefined) state.currentIteration = currentIteration;
  if (totalIterations !== undefined) state.totalIterations = totalIterations;

  pushActivity(state, currentPhase ?? state.currentPhase, 'status-update', overallStatus || 'in-progress', 'info');
  state.updatedAt = new Date().toISOString();
  writeStateFileAtomic(stateFile, state);
  console.log(`OK overall status=${overallStatus || 'unchanged'}`);
}

function fallbackActivity(stateFile, phase, action, message, level) {
  const state = readStateFile(stateFile);
  if (!state) { console.error('State file not found:', stateFile); process.exit(1); }

  pushActivity(state, phase ?? state.currentPhase, action, message, level || 'info');
  state.updatedAt = new Date().toISOString();
  writeStateFileAtomic(stateFile, state);
  console.log(`OK activity: ${action}`);
}

function fallbackInit(stateFile, initialState) {
  const dir = resolve(stateFile, '..');
  mkdirSync(dir, { recursive: true });
  writeStateFileAtomic(stateFile, initialState);
  console.log('OK state initialized');
}

function fallbackSetField(stateFile, field, value) {
  if (!existsSync(stateFile)) {
    console.error('State file not found:', stateFile);
    process.exit(1);
  }
  const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
  state[field] = value;
  writeStateFileAtomic(stateFile, state);
  console.log(`OK ${field} set`);
}

// ── Resolve state-json value (inline, @file, or stdin) ────
function resolveStateJson(val) {
  if (!val) return null;
  // @path → read from file
  if (val.startsWith('@')) {
    const filePath = val.slice(1);
    try {
      return readFileSync(filePath, 'utf-8');
    } catch (e) {
      console.error(`Cannot read state file: ${filePath}: ${e.message}`);
      process.exit(1);
    }
  }
  return val;
}

// ── Main ────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const type = args.type;
  const projectRoot = resolve(toWinPath(args['project-root']) || process.cwd());
  const projectName = args['project-name'] || 'default';
  const stateFile = join(projectRoot, '.dws', projectName, 'workflow-state.json');

  if (!type) {
    console.error('Usage: notify-state.mjs --type step|phase|overall|activity|init|dashboard-url [options]');
    console.error('  --type step          --phase-id N --step-id xxx --status in-progress|completed [--detail ...] [--result ...]');
    console.error('  --type phase         --phase-id N --status in-progress|completed [--artifacts ...]');
    console.error('  --type overall       [--current-phase N] [--overall-status ...] [--current-iteration N] [--total-iterations N]');
    console.error('  --type activity      --phase N --action xxx --message xxx [--level info|success|warning|error]');
    console.error('  --type init          --state-json \'{"projectName":...}\'  or --state-json @path/to/file.json');
    console.error('  --type dashboard-url --url http://localhost:PORT');
    process.exit(1);
  }

  // Try Dashboard API first
  const port = findDashboardPort(projectRoot, projectName);
  if (port) {
    let path, body;
    switch (type) {
      case 'step':
        path = '/api/state/step';
        body = {
          phaseId: parseInt(args['phase-id']),
          stepId: args['step-id'],
          status: args.status,
        };
        if (args.detail !== undefined) body.detail = args.detail;
        if (args.result !== undefined) body.result = args.result;
        break;
      case 'phase':
        path = '/api/state/phase';
        body = {
          phaseId: parseInt(args['phase-id']),
          status: args.status,
        };
        if (args.artifacts) {
          try { body.artifacts = JSON.parse(args.artifacts); } catch { body.artifacts = []; }
        }
        break;
      case 'overall':
        path = '/api/state/overall';
        body = {};
        if (args['current-phase'] !== undefined) body.currentPhase = parseInt(args['current-phase']);
        if (args['overall-status'] !== undefined) body.overallStatus = args['overall-status'];
        if (args['current-iteration'] !== undefined) body.currentIteration = parseInt(args['current-iteration']);
        if (args['total-iterations'] !== undefined) body.totalIterations = parseInt(args['total-iterations']);
        break;
      case 'activity':
        path = '/api/state/activity';
        body = {
          phase: parseInt(args.phase),
          action: args.action,
          message: args.message,
          level: args.level || 'info',
        };
        break;
      case 'init':
        path = '/api/state/init';
        try {
          body = JSON.parse(resolveStateJson(args['state-json']));
        } catch {
          console.error('Invalid --state-json'); process.exit(1);
        }
        break;
      case 'dashboard-url':
        path = '/api/state/field';
        body = { field: 'dashboardUrl', value: args.url };
        break;
      default:
        console.error('Unknown type:', type); process.exit(1);
    }

    const result = await httpPost(port, path, body);
    if (result.status === 200 && result.data?.success) {
      console.log(`OK ${type} via API (port ${port})`);
      process.exit(0);
    }
    // API call failed, fall through to direct file write
    console.warn(`API call failed (status ${result.status}), falling back to file write`);
  }

  // Fallback: direct file write
  switch (type) {
    case 'step':
      fallbackStep(stateFile, parseInt(args['phase-id']), args['step-id'], args.status, args.detail, args.result);
      break;
    case 'phase':
      fallbackPhase(stateFile, parseInt(args['phase-id']), args.status, args.artifacts ? JSON.parse(args.artifacts) : undefined);
      break;
    case 'overall':
      fallbackOverall(stateFile,
        args['current-phase'] !== undefined ? parseInt(args['current-phase']) : undefined,
        args['overall-status'],
        args['current-iteration'] !== undefined ? parseInt(args['current-iteration']) : undefined,
        args['total-iterations'] !== undefined ? parseInt(args['total-iterations']) : undefined
      );
      break;
    case 'activity':
      fallbackActivity(stateFile, parseInt(args.phase), args.action, args.message, args.level);
      break;
    case 'init':
      try {
        fallbackInit(stateFile, JSON.parse(resolveStateJson(args['state-json'])));
      } catch {
        console.error('Invalid --state-json'); process.exit(1);
      }
      break;
    case 'dashboard-url':
      fallbackSetField(stateFile, 'dashboardUrl', args.url);
      break;
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
