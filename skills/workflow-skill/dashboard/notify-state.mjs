#!/usr/bin/env node
// notify-state.mjs — Helper script for CC to update workflow state via Dashboard API
// Falls back to direct file write when Dashboard is not running

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { request } from 'http';
import { createConnection } from 'net';
import {
  parseArgs, toWinPath, parseId,
  scanPhaseArtifacts, readStateFile, writeStateFileAtomic,
  ensurePhase, ensureStep, pushActivity,
  markSiblingsCompleted, promoteNextPending, withStateLock,
} from './lib/shared.mjs';

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
// Reads .dashboard.port, then verifies the dashboard is actually listening.
// Without the probe, a stale port file (left behind by a crashed dashboard)
// causes every notify call to wait 3s for the API timeout before falling
// back to file write — a death spiral that makes the dashboard feel broken.
function readPortFile(projectRoot, projectName) {
  const portFile = join(projectRoot, '.dws', projectName, '.dashboard.port');
  try {
    if (existsSync(portFile)) {
      const port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
      if (port > 0 && port < 65536) return port;
    }
  } catch {}
  return null;
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

async function findDashboardPort(projectRoot, projectName) {
  const port = readPortFile(projectRoot, projectName);
  if (!port) return null;
  if (await probePort(port)) return port;
  return null;
}

// ── Direct file mutation fallbacks ─────────────────
function fallbackStep(stateFile, phaseId, stepId, status, detail, result, phaseName, stepName) {
  const state = readStateFile(stateFile);
  if (!state) { console.error('State file not found:', stateFile); process.exit(1); }

  ensurePhase(state, phaseId, phaseName);
  const phase = (state.phases || []).find(p => p.id === phaseId);
  if (!phase) { console.error('Phase not found:', phaseId); process.exit(1); }
  ensureStep(phase, stepId, stepName);
  const step = (phase.steps || []).find(s => s.id === stepId);
  if (!step) { console.error('Step not found:', stepId); process.exit(1); }

  const prevStatus = step.status;
  step.status = status;
  const now = new Date().toISOString();
  if (status === 'in-progress' && !step.startedAt) {
    step.startedAt = now;
    markSiblingsCompleted(phase, stepId, now);
  }
  if (['completed', 'blocked', 'skipped'].includes(status)) step.completedAt = now;
  if (detail !== undefined) step.detail = detail;
  if (result !== undefined) step.result = result;

  if (['completed', 'blocked', 'skipped'].includes(status)) {
    promoteNextPending(phase, now);
  }

  if (prevStatus !== status) {
    const level = status === 'completed' ? 'success' : status === 'blocked' ? 'error' : 'info';
    pushActivity(state, phaseId, 'step-' + status, step.name, level);
  }

  state.updatedAt = now;
  writeStateFileAtomic(stateFile, state);
  console.log(`OK step ${stepId} -> ${status}`);
}

function fallbackPhase(stateFile, phaseId, status, artifacts, phaseName) {
  const state = readStateFile(stateFile);
  if (!state) { console.error('State file not found:', stateFile); process.exit(1); }

  ensurePhase(state, phaseId, phaseName);
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
  // Auto-scan artifact directory on completion — fulfills the "制品会自动注册"
  // contract documented in each SKILL.md. Merges scanned files into existing
  // artifacts (doesn't overwrite explicit --artifacts entries).
  if (status === 'completed') {
    const projectRoot = resolve(stateFile, '..', '..', '..');
    const projectName = basename(dirname(stateFile));
    const scanned = scanPhaseArtifacts(projectRoot, projectName, phaseId);
    if (scanned.length > 0) {
      if (!Array.isArray(phase.artifacts)) phase.artifacts = [];
      const existing = new Set(phase.artifacts.map(a => typeof a === 'string' ? a : a.path));
      for (const a of scanned) {
        if (!existing.has(a.path)) phase.artifacts.push(a);
      }
    }
  }

  const level = status === 'completed' ? 'success' : status === 'blocked' ? 'error' : 'info';
  pushActivity(state, phaseId, 'phase-' + status, phase.name, level);
  state.updatedAt = now;
  writeStateFileAtomic(stateFile, state);
  console.log(`OK phase ${phaseId} -> ${status}`);
}

function fallbackOverall(stateFile, currentPhase, overallStatus, currentIteration, totalIterations) {
  const state = readStateFile(stateFile);
  if (!state) { console.error('State file not found:', stateFile); process.exit(1); }

  if (currentPhase !== undefined) { ensurePhase(state, currentPhase); state.currentPhase = currentPhase; }
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

  const effectivePhase = phase ?? state.currentPhase;
  if (effectivePhase !== undefined) ensurePhase(state, effectivePhase);
  pushActivity(state, effectivePhase, action, message, level || 'info');
  // Auto-advance: promote next pending step to in-progress when the current phase
  // has no active step. NEVER create a new step from an activity message — that
  // previously produced phantom steps from informational activities.
  const currentPhase = (state.phases || []).find(p => p.id === state.currentPhase);
  if (currentPhase && Array.isArray(currentPhase.steps) && currentPhase.status === 'in-progress') {
    const hasActive = currentPhase.steps.some(s => s.status === 'in-progress');
    if (!hasActive) {
      const nextPending = currentPhase.steps.find(s => s.status === 'pending');
      if (nextPending) {
        nextPending.status = 'in-progress';
        nextPending.startedAt = new Date().toISOString();
      }
    }
  }
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

// ── Fallback: consensus tracker (phase 3) ──────────
// Mirrors server.mjs /api/state/consensus logic. Used when Dashboard API is
// unreachable — keeps the state file usable so the dashboard catches up on
// next start.
function fallbackConsensus(stateFile, round, fatalIssues, highIssues, mediumIssues, lowIssues, status, reqAdjustments, designAdjustments, details) {
  const state = readStateFile(stateFile);
  if (!state) { console.error('State file not found:', stateFile); process.exit(1); }

  if (!['completed', 'failed'].includes(state.overallStatus)) {
    state.overallStatus = 'consensus-loop';
  }
  if (!state.consensusTracker) {
    state.consensusTracker = { rounds: [], currentRound: 0, maxRounds: 5, status: 'in-progress' };
  }
  state.consensusTracker.currentRound = round;
  if (!Array.isArray(state.consensusTracker.rounds)) state.consensusTracker.rounds = [];
  state.consensusTracker.rounds.push({
    round,
    fatalIssues: fatalIssues || 0,
    highIssues: highIssues || 0,
    mediumIssues: mediumIssues || 0,
    lowIssues: lowIssues || 0,
    status: status || 'consensus-not-reached',
    reqAdjustments: reqAdjustments || 0,
    designAdjustments: designAdjustments || 0,
    details: details || null,
  });
  if (status === 'consensus-reached') {
    state.consensusTracker.status = 'consensus-reached';
    if (!['completed', 'failed'].includes(state.overallStatus)) state.overallStatus = 'in-progress';
  } else if (round >= 5) {
    state.consensusTracker.status = 'escalated';
  }
  const level = status === 'consensus-reached' ? 'success' : fatalIssues > 0 ? 'warning' : 'info';
  pushActivity(state, 3, 'review-round', `第${round}轮: ${fatalIssues}致命, ${highIssues}高优先级问题`, level);

  state.updatedAt = new Date().toISOString();
  writeStateFileAtomic(stateFile, state);
  console.log(`OK consensus round ${round} (status=${status || 'consensus-not-reached'})`);
}

// ── Fallback: bug tracker (phases 6-7) ─────────────
// Mirrors server.mjs /api/state/bug logic.
function fallbackBug(stateFile, round, newBugs, fixedBugs, remainingBugs, iterationId, details) {
  const state = readStateFile(stateFile);
  if (!state) { console.error('State file not found:', stateFile); process.exit(1); }

  if (!['completed', 'failed'].includes(state.overallStatus)) {
    state.overallStatus = 'tdd-loop';
  }
  if (!state.bugTracker) {
    state.bugTracker = { rounds: [], currentRound: 0, maxRounds: 3, status: 'in-progress' };
  }
  state.bugTracker.currentRound = round;
  if (!Array.isArray(state.bugTracker.rounds)) state.bugTracker.rounds = [];
  state.bugTracker.rounds.push({
    round,
    newBugs: newBugs || 0,
    fixedBugs: fixedBugs || 0,
    remainingBugs: remainingBugs || 0,
    iterationId: iterationId || null,
    details: details || null,
  });
  if (remainingBugs === 0) {
    state.bugTracker.status = 'stable';
    if (!['completed', 'failed'].includes(state.overallStatus)) state.overallStatus = 'in-progress';
  } else if (round >= 3 && remainingBugs > 0) {
    state.bugTracker.status = 'escalated';
  } else {
    state.bugTracker.status = 'converging';
  }
  const level = remainingBugs === 0 ? 'success' : newBugs > 0 ? 'error' : 'info';
  pushActivity(state, 7, 'test-round', `第${round}轮: ${newBugs}新Bug, ${fixedBugs}已修复, ${remainingBugs}剩余`, level);

  state.updatedAt = new Date().toISOString();
  writeStateFileAtomic(stateFile, state);
  console.log(`OK bug round ${round} (remaining=${remainingBugs})`);
}

// ── Resolve value (inline JSON, @file, or plain string) ────
function resolveJsonOrFile(val) {
  if (!val) return null;
  // @path → read from file
  if (val.startsWith('@')) {
    const filePath = val.slice(1);
    try {
      return readFileSync(filePath, 'utf-8');
    } catch (e) {
      console.error(`Cannot read file: ${filePath}: ${e.message}`);
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
    console.error('Usage: notify-state.mjs --type step|phase|overall|activity|consensus|bug|init|dashboard-url|question|question-clear [options]');
    console.error('  --type step          --phase-id N --step-id xxx --status in-progress|completed [--phase-name ...] [--step-name ...] [--detail ...] [--result ...]');
    console.error('  --type phase         --phase-id N --status in-progress|completed [--phase-name ...] [--artifacts ...]');
    console.error('  --type overall       [--current-phase N] [--overall-status ...] [--current-iteration N] [--total-iterations N]');
    console.error('  --type activity      --phase N --action xxx --message xxx [--level info|success|warning|error]');
    console.error('  --type consensus     --round N --fatal-issues X --high-issues Y [--medium-issues Z] [--low-issues W] --status consensus-not-reached|consensus-reached [--req-adjustments A] [--design-adjustments B] [--details JSON]');
    console.error('  --type bug           --round N --new-bugs X --fixed-bugs Y --remaining-bugs Z [--iteration-id ...] [--details JSON]');
    console.error('  --type init          --state-json \'{"projectName":...}\'  or --state-json @path/to/file.json');
    console.error('  --type dashboard-url --url http://localhost:PORT');
    console.error('  --type question      --question "text" --header "title" [--multi-select false] --options \'[{"value":"v1","label":"L1"}]\' or --options @path/to/file.json');
    console.error('                       OR --questions \'[{"question":"Q1","header":"H1","options":[...]},...]\' or --questions @path/to/file.json');
    console.error('  --type question-clear');
    process.exit(1);
  }

  // Try Dashboard API first
  const port = await findDashboardPort(projectRoot, projectName);
  if (port) {
    let path, body;
    switch (type) {
      case 'step':
        path = '/api/state/step';
        body = {
          phaseId: parseId(args['phase-id']),
          stepId: args['step-id'],
          status: args.status,
        };
        if (args['phase-name'] !== undefined) body.phaseName = args['phase-name'];
        if (args['step-name'] !== undefined) body.stepName = args['step-name'];
        if (args.detail !== undefined) body.detail = args.detail;
        if (args.result !== undefined) body.result = args.result;
        break;
      case 'phase':
        path = '/api/state/phase';
        body = {
          phaseId: parseId(args['phase-id']),
          status: args.status,
        };
        if (args['phase-name'] !== undefined) body.phaseName = args['phase-name'];
        if (args.artifacts) {
          // Parse failure should not silently discard explicit artifacts —
          // pass undefined so the server's scanPhaseArtifacts fallback still
          // registers files from the phase's artifact directory.
          try { body.artifacts = JSON.parse(args.artifacts); }
          catch { console.warn('Invalid --artifacts JSON, relying on auto-scan only'); }
        }
        break;
      case 'overall':
        path = '/api/state/overall';
        body = {};
        if (args['current-phase'] !== undefined) body.currentPhase = parseId(args['current-phase']);
        if (args['overall-status'] !== undefined) body.overallStatus = args['overall-status'];
        if (args['current-iteration'] !== undefined) body.currentIteration = parseInt(args['current-iteration']);
        if (args['total-iterations'] !== undefined) body.totalIterations = parseInt(args['total-iterations']);
        break;
      case 'activity':
        path = '/api/state/activity';
        body = {
          phase: parseId(args.phase),
          action: args.action,
          message: args.message,
          level: args.level || 'info',
        };
        break;
      case 'consensus':
        path = '/api/state/consensus';
        body = {
          round: parseInt(args.round, 10),
          fatalIssues: parseInt(args['fatal-issues'] || '0', 10),
          highIssues: parseInt(args['high-issues'] || '0', 10),
          mediumIssues: parseInt(args['medium-issues'] || '0', 10),
          lowIssues: parseInt(args['low-issues'] || '0', 10),
          status: args.status || 'consensus-not-reached',
          reqAdjustments: parseInt(args['req-adjustments'] || '0', 10),
          designAdjustments: parseInt(args['design-adjustments'] || '0', 10),
        };
        if (args.details) {
          try { body.details = JSON.parse(resolveJsonOrFile(args.details)); } catch {
            console.error('Invalid --details JSON'); process.exit(1);
          }
        }
        break;
      case 'bug':
        path = '/api/state/bug';
        body = {
          round: parseInt(args.round, 10),
          newBugs: parseInt(args['new-bugs'] || '0', 10),
          fixedBugs: parseInt(args['fixed-bugs'] || '0', 10),
          remainingBugs: parseInt(args['remaining-bugs'] || '0', 10),
        };
        if (args['iteration-id'] !== undefined) body.iterationId = args['iteration-id'];
        if (args.details) {
          try { body.details = JSON.parse(resolveJsonOrFile(args.details)); } catch {
            console.error('Invalid --details JSON'); process.exit(1);
          }
        }
        break;
      case 'init':
        path = '/api/state/init';
        try {
          body = JSON.parse(resolveJsonOrFile(args['state-json']));
        } catch {
          console.error('Invalid --state-json'); process.exit(1);
        }
        break;
      case 'dashboard-url':
        path = '/api/state/field';
        body = { field: 'dashboardUrl', value: args.url };
        break;
      case 'question':
        path = '/api/question/push';
        try {
          if (args.questions) {
            // Multi-question format: --questions '[...]' or --questions @path/to/file.json
            const raw = resolveJsonOrFile(args.questions);
            const parsed = JSON.parse(raw);
            body = {
              id: `q-${String(Date.now()).slice(-6)}`,
              questions: parsed
            };
          } else {
            // Legacy single-question format: --options also supports @file
            const rawOptions = resolveJsonOrFile(args.options || '[]');
            body = {
              id: `q-${String(Date.now()).slice(-6)}`,
              question: args.question || '',
              header: args.header || 'CC 需要你的决策',
              multiSelect: !!args['multi-select'] && args['multi-select'] !== 'false',
              options: JSON.parse(rawOptions),
              allowCustom: true
            };
          }
        } catch {
          console.error('Invalid --options or --questions JSON'); process.exit(1);
        }
        break;
      case 'question-clear':
        path = '/api/question/clear';
        body = {};
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

  // Fallback: direct file write. Serialize concurrent fallback writers via
  // a sibling lock file so parallel notify-state processes don't clobber
  // each other's read-modify-write. See withStateLock in lib/shared.mjs.
  await withStateLock(stateFile, () => {
    switch (type) {
      case 'step':
        fallbackStep(stateFile, parseId(args['phase-id']), args['step-id'], args.status, args.detail, args.result, args['phase-name'], args['step-name']);
        break;
    case 'phase':
      fallbackPhase(stateFile, parseId(args['phase-id']), args.status, args.artifacts ? JSON.parse(args.artifacts) : undefined, args['phase-name']);
      break;
    case 'overall':
      fallbackOverall(stateFile,
        args['current-phase'] !== undefined ? parseId(args['current-phase']) : undefined,
        args['overall-status'],
        args['current-iteration'] !== undefined ? parseInt(args['current-iteration']) : undefined,
        args['total-iterations'] !== undefined ? parseInt(args['total-iterations']) : undefined
      );
      break;
    case 'activity':
      fallbackActivity(stateFile, parseId(args.phase), args.action, args.message, args.level);
      break;
    case 'consensus':
      try {
        let details = null;
        if (args.details) details = JSON.parse(resolveJsonOrFile(args.details));
        fallbackConsensus(stateFile,
          parseInt(args.round, 10),
          parseInt(args['fatal-issues'] || '0', 10),
          parseInt(args['high-issues'] || '0', 10),
          parseInt(args['medium-issues'] || '0', 10),
          parseInt(args['low-issues'] || '0', 10),
          args.status,
          parseInt(args['req-adjustments'] || '0', 10),
          parseInt(args['design-adjustments'] || '0', 10),
          details
        );
      } catch {
        console.error('Invalid --details JSON'); process.exit(1);
      }
      break;
    case 'bug':
      try {
        let details = null;
        if (args.details) details = JSON.parse(resolveJsonOrFile(args.details));
        fallbackBug(stateFile,
          parseInt(args.round, 10),
          parseInt(args['new-bugs'] || '0', 10),
          parseInt(args['fixed-bugs'] || '0', 10),
          parseInt(args['remaining-bugs'] || '0', 10),
          args['iteration-id'],
          details
        );
      } catch {
        console.error('Invalid --details JSON'); process.exit(1);
      }
      break;
    case 'init':
      try {
        fallbackInit(stateFile, JSON.parse(resolveJsonOrFile(args['state-json'])));
      } catch {
        console.error('Invalid --state-json'); process.exit(1);
      }
      break;
    case 'dashboard-url':
      fallbackSetField(stateFile, 'dashboardUrl', args.url);
      break;
    case 'question':
      try {
        const state = readStateFile(stateFile);
        if (state) {
          let questions;
          if (args.questions) {
            questions = JSON.parse(resolveJsonOrFile(args.questions));
          } else {
            const rawOptions = resolveJsonOrFile(args.options || '[]');
            questions = [{
              id: 'q-0',
              question: args.question || '',
              header: args.header || 'CC 需要你的决策',
              multiSelect: !!args['multi-select'] && args['multi-select'] !== 'false',
              options: JSON.parse(rawOptions),
              allowCustom: true
            }];
          }
          state.pendingQuestion = {
            id: `q-${String(Date.now()).slice(-6)}`,
            questions,
            status: 'pending',
            answer: null
          };
          writeStateFileAtomic(stateFile, state);
          console.log('OK question pushed');
        }
      } catch {
        console.error('Failed to push question'); process.exit(1);
      }
      break;
    case 'question-clear':
      try {
        const s = readStateFile(stateFile);
        if (s) {
          s.pendingQuestion = null;
          writeStateFileAtomic(stateFile, s);
          console.log('OK question cleared');
        }
      } catch {
        console.error('Failed to clear question'); process.exit(1);
      }
      break;
    }
  });
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
