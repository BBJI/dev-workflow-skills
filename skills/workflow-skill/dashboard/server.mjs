// ── Node.js version check (top-level, before any work) ──
const nodeVersion = parseInt(process.version.slice(1).split('.')[0]);
if (nodeVersion < 14) {
  console.error(`Dashboard requires Node.js 14+. Current: ${process.version}`);
  process.exit(1);
}

// ── Dependency check ─────────────────────────────────
try {
  await import('express');
  await import('chokidar');
} catch (e) {
  console.error('Missing dependencies. Run: cd ' + import.meta.dirname + ' && npm install --production');
  process.exit(1);
}

import express from 'express';
import { watch } from 'chokidar';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { resolve, join, extname } from 'path';
import { createServer } from 'http';
import { exec } from 'child_process';
import {
  parseArgs, toWinPath, parseId, computeHash,
  scanPhaseArtifacts, readStateFile as readStateFileShared,
  writeStateFileAtomic, ensurePhase, ensureStep, pushActivity,
  markSiblingsCompleted, promoteNextPending,
} from './lib/shared.mjs';

const args = parseArgs();
const PORT = args.port || parseInt(process.env.DWS_PORT) || 3456;
const PROJECT_ROOT = resolve(toWinPath(args['project-root']) || process.cwd());
const PROJECT_NAME = args['project-name'] || 'default';
const DWS_DIR = join(PROJECT_ROOT, '.dws', PROJECT_NAME);
const STATE_FILE = join(DWS_DIR, 'workflow-state.json');
const PID_FILE = join(DWS_DIR, '.dashboard.pid');
const PORT_FILE = join(DWS_DIR, '.dashboard.port');

const app = express();
const server = createServer(app);

// Cap request body at 1 MB — state files are small (<100 KB typical), anything
// larger is either a bug or an abuse attempt. Without this, express.json() will
// happily buffer arbitrarily large payloads into memory.
app.use(express.json({ limit: '1mb' }));

const clients = new Set();
let currentState = null;
let lastStateHash = '';

// ── MIME types ──────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

// ── State file reading (delegates to shared; closes over STATE_FILE) ──
function readStateFile() {
  return readStateFileShared(STATE_FILE);
}

// ── Atomic state file write ─────────────────────────
function writeStateFile(state) {
  writeStateFileAtomic(STATE_FILE, state);
}

// ── Shared: apply state mutation + persist + broadcast ──
// Prefer in-memory currentState: every API-driven mutation we apply updates
// currentState synchronously, and chokidar keeps it in sync with external
// writes (notify-state.mjs fallback path) within ~300ms. Reading from disk
// on every mutation is wasted I/O when we already hold the authoritative
// copy in memory. Fall back to disk only on cold start (currentState null)
// or if the on-disk file is somehow newer than what we have.
function mutateState(fn) {
  let state = currentState;
  if (!state) {
    state = readStateFile();
    if (!state) return null;
  }
  fn(state);
  state.updatedAt = new Date().toISOString();
  writeStateFile(state);
  currentState = state;
  lastStateHash = computeHash(JSON.stringify(state));
  broadcastState(state);
  return state;
}

// ── SSE broadcast ───────────────────────────────────
// Broadcasts are deferred via setImmediate so request handlers return fast
// instead of blocking on N client writes. Slow clients whose write buffer
// stays full (res.write returns false) get disconnected after a short grace
// period — without this, one stuck browser tab blocks the whole server.
function broadcastState(state) {
  setImmediate(() => {
    const data = JSON.stringify(state);
    for (const res of clients) {
      try {
        const ok = res.write(`event: state\ndata: ${data}\n\n`);
        if (!ok) handleBackpressure(res);
      } catch {
        forceDisconnect(res);
      }
    }
  });
}

function broadcastError(message) {
  setImmediate(() => {
    const payload = `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
    for (const res of clients) {
      try {
        const ok = res.write(payload);
        if (!ok) handleBackpressure(res);
      } catch {
        forceDisconnect(res);
      }
    }
  });
}

// Track how long a client has been under backpressure. If it persists beyond
// BACKPRESSURE_GRACE_MS, drop the connection rather than let it stall the
// broadcast loop indefinitely.
const backpressureSince = new WeakMap();
const BACKPRESSURE_GRACE_MS = 2000;

function handleBackpressure(res) {
  const now = Date.now();
  const since = backpressureSince.get(res);
  if (!since) {
    backpressureSince.set(res, now);
    res.once('drain', () => backpressureSince.delete(res));
    return;
  }
  if (now - since > BACKPRESSURE_GRACE_MS) {
    forceDisconnect(res);
  }
}

function forceDisconnect(res) {
  try { res.destroy(); } catch {}
  clients.delete(res);
}

// ── File change detection ────────────────────────────
function checkAndBroadcast() {
  const state = readStateFile();
  if (!state) {
    if (existsSync(STATE_FILE)) broadcastError('State file temporarily unreadable');
    return;
  }
  const hash = computeHash(JSON.stringify(state));
  if (hash !== lastStateHash) {
    lastStateHash = hash;
    currentState = state;
    broadcastState(state);
  }
}

function startWatcher() {
  const watcher = watch(STATE_FILE, {
    persistent: true,
    ignoreInitial: false,
    usePolling: true,
    interval: 300,
  });

  watcher.on('add', checkAndBroadcast);
  watcher.on('change', checkAndBroadcast);

  watcher.on('error', (err) => {
    console.error('Watcher error:', err.message);
  });

  // chokidar uses usePolling:true with 300ms interval — that already catches
  // all writes (including API-driven ones), so no redundant 1s fallback is
  // needed. Adding one would just double-broadcast on every change.
}

// ══════════════════════════════════════════════════════
// ── Routes ──────────────────────────────────────────
// ══════════════════════════════════════════════════════

// Dashboard page
app.get('/', (_req, res) => {
  res.sendFile(join(import.meta.dirname, 'public', 'index.html'));
});

// Current state API
app.get('/api/state', (_req, res) => {
  const state = readStateFile();
  if (state) {
    res.json(state);
  } else {
    res.status(404).json({ error: 'State file not found' });
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', project: PROJECT_NAME, uptime: process.uptime() });
});

// ══════════════════════════════════════════════════════
// ── State Mutation API ──────────────────────────────
// ══════════════════════════════════════════════════════

// Initialize state file
app.post('/api/state/init', (req, res) => {
  const state = req.body;
  if (!state || !state.projectName) {
    return res.status(400).json({ success: false, error: 'Missing state object' });
  }
  mkdirSync(DWS_DIR, { recursive: true });
  writeStateFile(state);
  currentState = state;
  lastStateHash = computeHash(JSON.stringify(state));
  broadcastState(state);
  res.json({ success: true });
});

// Update step status
app.post('/api/state/step', (req, res) => {
  const { phaseId, stepId, status, detail, result, phaseName, stepName } = req.body;
  const normPhaseId = parseId(phaseId);
  if (stepId === undefined || !status) {
    return res.status(400).json({ success: false, error: 'Missing stepId or status' });
  }
  const updated = mutateState(state => {
    ensurePhase(state, normPhaseId, phaseName);
    const phase = (state.phases || []).find(p => p.id === normPhaseId);
    if (!phase) return;
    ensureStep(phase, stepId, stepName);
    const step = (phase.steps || []).find(s => s.id === stepId);
    if (!step) return;

    const prevStatus = step.status;
    step.status = status;
    const now = new Date().toISOString();

    if (status === 'in-progress' && !step.startedAt) {
      step.startedAt = now;
      // Only one in-progress step per phase — complete any stale ones
      // (CC often forgets to send completed for the previous step)
      markSiblingsCompleted(phase, stepId, now);
    }
    if (['completed', 'blocked', 'skipped'].includes(status)) {
      step.completedAt = now;
    }
    if (detail !== undefined) step.detail = detail;
    if (result !== undefined) step.result = result;

    // Auto-advance: when a step reaches a terminal state, promote the next
    // pending step in the same phase so the dashboard always reflects what
    // CC is doing now — even when CC only sends `completed` notifications.
    if (['completed', 'blocked', 'skipped'].includes(status)) {
      promoteNextPending(phase, now);
    }

    // Activity log for state transitions
    if (prevStatus !== status) {
      const level = status === 'completed' ? 'success' : status === 'blocked' ? 'error' : 'info';
      pushActivity(state, normPhaseId ?? state.currentPhase, 'step-' + status, step.name, level);
    }
  });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found or step not found' });
  res.json({ success: true });
});

// Update phase status
app.post('/api/state/phase', (req, res) => {
  const { phaseId, status, artifacts, phaseName } = req.body;
  const normPhaseId = parseId(phaseId);
  if (normPhaseId === undefined || !status) {
    return res.status(400).json({ success: false, error: 'Missing phaseId or status' });
  }
  const updated = mutateState(state => {
    ensurePhase(state, normPhaseId, phaseName);
    const phase = (state.phases || []).find(p => p.id === normPhaseId);
    if (!phase) return;

    phase.status = status;
    const now = new Date().toISOString();

    if (status === 'in-progress' && !phase.startedAt) {
      phase.startedAt = now;
      // Mark first step as in-progress
      if (phase.steps && phase.steps.length > 0 && phase.steps[0].status === 'pending') {
        phase.steps[0].status = 'in-progress';
        phase.steps[0].startedAt = now;
      }
    }
    if (['completed', 'skipped'].includes(status)) {
      phase.completedAt = now;
      // Mark all incomplete steps as completed
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
      const scanned = scanPhaseArtifacts(PROJECT_ROOT, PROJECT_NAME, normPhaseId);
      if (scanned.length > 0) {
        if (!Array.isArray(phase.artifacts)) phase.artifacts = [];
        const existing = new Set(phase.artifacts.map(a => typeof a === 'string' ? a : a.path));
        for (const a of scanned) {
          if (!existing.has(a.path)) phase.artifacts.push(a);
        }
      }
    }

    const level = status === 'completed' ? 'success' : status === 'blocked' ? 'error' : 'info';
    pushActivity(state, normPhaseId, 'phase-' + status, phase.name, level);
  });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found or phase not found' });
  res.json({ success: true });
});

// Update overall workflow status
app.post('/api/state/overall', (req, res) => {
  const { currentPhase, overallStatus, currentIteration, totalIterations } = req.body;
  const normCurrentPhase = parseId(currentPhase);
  const updated = mutateState(state => {
    if (normCurrentPhase !== undefined) state.currentPhase = normCurrentPhase;
    if (overallStatus !== undefined) state.overallStatus = overallStatus;
    if (currentIteration !== undefined) state.currentIteration = currentIteration;
    if (totalIterations !== undefined) state.totalIterations = totalIterations;

    const activityPhase = normCurrentPhase ?? state.currentPhase ?? 0;
    pushActivity(state, activityPhase, 'status-update', overallStatus || 'in-progress', 'info');
  });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found' });
  res.json({ success: true });
});

// Add activity log entry (supports single or batch)
app.post('/api/state/activity', (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : [req.body];
  if (entries.length === 0) {
    return res.status(400).json({ success: false, error: 'Empty activity entries' });
  }
  const updated = mutateState(state => {
    for (const entry of entries) {
      if (!entry.action || !entry.message) continue;
      const phaseId = parseId(entry.phase) ?? state.currentPhase ?? 0;
      pushActivity(state, phaseId, entry.action, entry.message, entry.level || 'info');
    }
    // Auto-advance: ensure the current in-progress phase always has an in-progress step
    // so the Dashboard header indicator shows what CC is doing right now.
    // Reuses promoteNextPending so the rule is identical to the step handler's.
    // NEVER creates a new step from an activity message — that previously produced
    // phantom steps like "开始需求分析阶段" when informational activities arrived
    // between steps. If there's no pending step, the header simply shows no active step.
    const currentPhase = (state.phases || []).find(p => p.id === state.currentPhase);
    if (currentPhase && currentPhase.status === 'in-progress') {
      promoteNextPending(currentPhase, new Date().toISOString());
    }
  });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found' });
  res.json({ success: true });
});

// Update consensus tracker (phase 3)
app.post('/api/state/consensus', (req, res) => {
  const { round, fatalIssues, highIssues, mediumIssues, lowIssues, status, reqAdjustments, designAdjustments, details } = req.body;
  if (round === undefined) {
    return res.status(400).json({ success: false, error: 'Missing round' });
  }
  const updated = mutateState(state => {
    // Guard: don't revert a terminal overallStatus (completed/failed). A late
    // consensus update arriving after the workflow finished would otherwise
    // rewind the dashboard into "consensus-loop" forever.
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
      details: details || null
    });
    if (status === 'consensus-reached') {
      state.consensusTracker.status = 'consensus-reached';
      state.overallStatus = 'in-progress';
    } else if (round >= 5) {
      state.consensusTracker.status = 'escalated';
    }
    const level = status === 'consensus-reached' ? 'success' : fatalIssues > 0 ? 'warning' : 'info';
    pushActivity(state, 3, 'review-round', `第${round}轮: ${fatalIssues}致命, ${highIssues}高优先级问题`, level);
  });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found' });
  res.json({ success: true });
});

// Update bug tracker (phases 6-7)
//
// Convergence state machine (mirrored in notify-state.mjs fallbackBug):
//   remainingBugs === 0                         → 'stable'      (iteration converged)
//   fatalBug=true OR escalateReason provided    → 'escalated'   (force-escalate, e.g. dev server failed)
//   trend: last 2 rounds newBugs non-decreasing → 'escalated'   (not converging — escalate early)
//   round >= maxRounds (3) && remainingBugs > 0 → 'escalated'   (max rounds exhausted)
//   otherwise                                   → 'converging'
//
// 'escalated' means: pause the TDD loop, surface to user with diagnostics.
// The workflow-skill orchestrator is responsible for actually halting —
// this API just records the state.
app.post('/api/state/bug', (req, res) => {
  const { round, newBugs, fixedBugs, remainingBugs, iterationId, details, fatalBug, escalateReason } = req.body;
  if (round === undefined) {
    return res.status(400).json({ success: false, error: 'Missing round' });
  }
  const updated = mutateState(state => {
    // Guard: don't revert a terminal overallStatus (completed/failed). A late
    // bug update arriving after the workflow finished would otherwise rewind
    // the dashboard into "tdd-loop" forever.
    if (!['completed', 'failed'].includes(state.overallStatus)) {
      state.overallStatus = 'tdd-loop';
    }
    if (!state.bugTracker) {
      state.bugTracker = { rounds: [], currentRound: 0, maxRounds: 3, status: 'in-progress', escalationReason: null };
    }
    state.bugTracker.currentRound = round;
    if (!Array.isArray(state.bugTracker.rounds)) state.bugTracker.rounds = [];
    state.bugTracker.rounds.push({
      round,
      newBugs: newBugs || 0,
      fixedBugs: fixedBugs || 0,
      remainingBugs: remainingBugs || 0,
      iterationId: iterationId || null,
      details: details || null
    });
    // Determine convergence status using priority rules.
    const rounds = state.bugTracker.rounds;
    const maxRounds = state.bugTracker.maxRounds || 3;
    let status;
    let reason = null;
    if (remainingBugs === 0) {
      status = 'stable';
    } else if (fatalBug || escalateReason) {
      // Force-escalate: dev server failed to start, or orchestrator-flagged fatal issue.
      // These block the entire main workflow — no point cycling through fix rounds.
      status = 'escalated';
      reason = escalateReason || 'fatal-bug';
    } else if (rounds.length >= 2) {
      // Trend detection: if newBugs is non-decreasing across the last 2 rounds
      // (both > 0), the loop is not converging. Escalate before hitting maxRounds
      // to avoid wasting cycles on a fundamentally broken area.
      const prev = rounds[rounds.length - 2].newBugs || 0;
      const curr = rounds[rounds.length - 1].newBugs || 0;
      if (prev > 0 && curr >= prev) {
        status = 'escalated';
        reason = `trend-not-converging (newBugs ${prev}→${curr})`;
      } else if (round >= maxRounds && remainingBugs > 0) {
        status = 'escalated';
        reason = `max-rounds (${maxRounds}) exhausted`;
      } else {
        status = 'converging';
      }
    } else if (round >= maxRounds && remainingBugs > 0) {
      status = 'escalated';
      reason = `max-rounds (${maxRounds}) exhausted`;
    } else {
      status = 'converging';
    }
    state.bugTracker.status = status;
    state.bugTracker.escalationReason = reason;
    const level = status === 'stable' ? 'success'
      : status === 'escalated' ? 'error'
      : (newBugs > 0 ? 'error' : 'info');
    const msg = reason
      ? `第${round}轮: ${newBugs}新Bug, ${fixedBugs}已修复, ${remainingBugs}剩余 → ${status} (${reason})`
      : `第${round}轮: ${newBugs}新Bug, ${fixedBugs}已修复, ${remainingBugs}剩余 → ${status}`;
    pushActivity(state, 7, 'test-round', msg, level);
  });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found' });
  res.json({ success: true });
});

// Set a single field on the state
app.post('/api/state/field', (req, res) => {
  const { field, value } = req.body;
  if (!field) return res.status(400).json({ success: false, error: 'Missing field' });
  const updated = mutateState(state => { state[field] = value; });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found' });
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════
// ── Question API ────────────────────────────────────
// ══════════════════════════════════════════════════════

// Question answer API
app.post('/api/question/answer', (req, res) => {
  const { questionId, selectedValues, customText, answers } = req.body;
  let answerData = null;
  const updated = mutateState(state => {
    if (!state.pendingQuestion) return;
    if (state.pendingQuestion.id !== questionId) return;
    if (state.pendingQuestion.status === 'answered') return;

    state.pendingQuestion.status = 'answered';

    if (answers && Array.isArray(answers)) {
      // Multi-question answers: [{ questionId, selectedValues, customText }]
      state.pendingQuestion.answer = {
        answers,
        answeredAt: new Date().toISOString()
      };
      answerData = state.pendingQuestion.answer;
      const allValues = answers.flatMap(a => a.selectedValues || []);
      pushActivity(state, state.currentPhase ?? 0, 'question-answered', `回答: ${allValues.join(', ')}`, 'info');
    } else if (Array.isArray(selectedValues)) {
      // Legacy single answer
      state.pendingQuestion.answer = {
        selectedValues,
        customText: customText || '',
        answeredAt: new Date().toISOString()
      };
      answerData = state.pendingQuestion.answer;
      pushActivity(state, state.currentPhase ?? 0, 'question-answered', `回答: ${selectedValues.join(', ')}${customText ? ' + 自定义' : ''}`, 'info');
    }
  });
  if (!updated || !answerData) return res.status(404).json({ success: false, error: 'Question not found or already answered' });
  res.json({ success: true, answer: answerData });
});

// Question push API
app.post('/api/question/push', (req, res) => {
  const { id, question, header, multiSelect, options, allowCustom, questions } = req.body;
  if (!questions?.length && !question) {
    return res.status(400).json({ success: false, error: 'Missing question(s)' });
  }
  let questionId = null;
  const updated = mutateState(state => {
    if (state.pendingQuestion && state.pendingQuestion.status === 'pending') {
      const prevQ = state.pendingQuestion.questions
        ? state.pendingQuestion.questions.map(q => q.question?.substring(0, 20)).join('; ')
        : state.pendingQuestion.question?.substring(0, 40);
      pushActivity(state, state.currentPhase ?? 0, 'question-superseded', `前一个问题被新问题取代: ${prevQ}`, 'warning');
    }
    questionId = id || `q-${String(Date.now()).slice(-6)}`;

    if (questions && Array.isArray(questions) && questions.length > 0) {
      // New format: multiple questions with tabs
      state.pendingQuestion = {
        id: questionId,
        questions: questions.map((q, i) => ({
          id: q.id || `q-${i}`,
          question: q.question || '',
          header: q.header || 'CC 需要你的决策',
          multiSelect: !!q.multiSelect,
          options: (q.options || []).map((opt, j) => ({
            value: opt.value || `opt-${j}`,
            label: opt.label || opt.value || `选项 ${j + 1}`,
            description: opt.description || ''
          })),
          allowCustom: q.allowCustom !== false,
        })),
        status: 'pending',
        answer: null,
        createdAt: new Date().toISOString()
      };
      const summary = questions.map(q => q.question?.substring(0, 30)).join('; ');
      pushActivity(state, state.currentPhase ?? 0, 'question-pushed', `CC 提问 (${questions.length}个问题): ${summary}`, 'info');
    } else {
      // Legacy format: single question → wrap in questions array
      state.pendingQuestion = {
        id: questionId,
        questions: [{
          id: 'q-0',
          question,
          header: header || 'CC 需要你的决策',
          multiSelect: !!multiSelect,
          options: (options || []).map((opt, i) => ({
            value: opt.value || `opt-${i}`,
            label: opt.label || opt.value || `选项 ${i + 1}`,
            description: opt.description || ''
          })),
          allowCustom: allowCustom !== false,
        }],
        status: 'pending',
        answer: null,
        createdAt: new Date().toISOString()
      };
      pushActivity(state, state.currentPhase ?? 0, 'question-pushed', `CC 提问: ${question.substring(0, 50)}`, 'info');
    }
  });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found' });
  res.json({ success: true, questionId });
});

// Question clear API
app.post('/api/question/clear', (_req, res) => {
  const updated = mutateState(state => {
    if (state.pendingQuestion) {
      if (state.pendingQuestion.status !== 'answered') {
        state.pendingQuestion = null;
        pushActivity(state, state.currentPhase ?? 0, 'question-cleared', '问题已清理（CLI 已处理）', 'info');
      } else {
        // Already answered, just clean up
        state.pendingQuestion = null;
      }
    }
  });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found' });
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════
// ── SSE endpoint ────────────────────────────────────
// ══════════════════════════════════════════════════════

app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send current state on connect
  if (currentState) {
    res.write(`event: state\ndata: ${JSON.stringify(currentState)}\n\n`);
  } else {
    const state = readStateFile();
    if (state) {
      currentState = state;
      res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Waiting for state file...' })}\n\n`);
    }
  }

  clients.add(res);

  // Heartbeat — keeps the SSE connection alive through proxies and lets us
  // detect dead clients quickly. Tunable via DWS_HEARTBEAT_MS for environments
  // with aggressive idle timeouts.
  const heartbeatMs = parseInt(process.env.DWS_HEARTBEAT_MS) || 30000;
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      clients.delete(res);
    }
  }, heartbeatMs);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// ══════════════════════════════════════════════════════
// ── Artifact serving ────────────────────────────────
// ══════════════════════════════════════════════════════

app.get('/artifacts/*', (req, res) => {
  const reqPath = req.params[0];
  const filePath = resolve(PROJECT_ROOT, reqPath);
  const root = resolve(PROJECT_ROOT);

  // Prevent directory traversal — must use separator boundary, otherwise
  // `/artifacts/../sibling-secret` would pass `startsWith(root)` check.
  const sep = process.platform === 'win32' ? '\\' : '/';
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    return res.status(403).send('Forbidden');
  }

  if (!existsSync(filePath)) {
    return res.status(404).send('Not found');
  }

  const ext = extname(filePath).toLowerCase();
  const mime = ext === '.md' ? 'text/plain; charset=utf-8' : (MIME[ext] || 'application/octet-stream');

  res.setHeader('Content-Type', mime);

  if (!MIME[ext] && ext !== '.md') {
    res.setHeader('Content-Disposition', `attachment; filename="${reqPath.split('/').pop()}"`);
  }
  res.sendFile(filePath);
});

// ── Open browser ────────────────────────────────────
function openBrowser(url) {
  // Quote URL to prevent shell metacharacter interpretation. On Windows,
  // `start` treats the first quoted arg as a window title, so pass empty "".
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.log(`  (Could not auto-open browser: ${err.message})`);
  });
}

// ── Server startup ──────────────────────────────────
function startServer(port) {
  server.listen(port, () => {
    console.log(`DWS Dashboard running at http://localhost:${port}`);
    console.log(`  Project: ${PROJECT_NAME}`);
    console.log(`  Project root: ${PROJECT_ROOT}`);
    console.log(`  State file: ${STATE_FILE}`);

    // Write PID and port files
    mkdirSync(DWS_DIR, { recursive: true });
    writeFileSync(PID_FILE, String(process.pid));
    writeFileSync(PORT_FILE, String(port));

    // Start watching state file (watcher loads initial state via 'add' event)
    startWatcher();

    // Auto-open browser
    openBrowser(`http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < 3466) {
      console.log(`Port ${port} in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error(`Failed to start server: ${err.message}`);
      process.exit(1);
    }
  });
}

// ── Cleanup ─────────────────────────────────────────
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

function shutdown() {
  console.log('\nShutting down dashboard...');
  for (const res of clients) {
    try { res.end(); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

startServer(PORT);
