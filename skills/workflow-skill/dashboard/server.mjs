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
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, statSync } from 'fs';
import { resolve, join, extname, relative } from 'path';
import { createServer } from 'http';
import { exec } from 'child_process';

// ── Git Bash path conversion (Windows) ──────────────
// Converts /d/project/... to D:\project\... on Windows
function toWinPath(p) {
  if (!p) return p;
  if (process.platform !== 'win32') return p;
  // Match Git Bash /drive-letter/path pattern: /c/Users/... → C:\Users\...
  return p.replace(/^\/([a-zA-Z])(\/|$)/, (_, drive, sep) => drive.toUpperCase() + ':' + (sep ? '\\' : ''));
}

const args = parseArgs();
const PORT = args.port || parseInt(process.env.DWS_PORT) || 3456;
const PROJECT_ROOT = resolve(toWinPath(args['project-root']) || process.cwd());
const PROJECT_NAME = args['project-name'] || 'default';
const DWS_DIR = join(PROJECT_ROOT, '.dws', PROJECT_NAME);
const STATE_FILE = join(DWS_DIR, 'workflow-state.json');
const PID_FILE = join(DWS_DIR, '.dashboard.pid');
const PORT_FILE = join(DWS_DIR, '.dashboard.port');

// Phase → artifact directory mapping. When a phase is marked completed, its
// artifact subdirectory under .dws/{project}/ is auto-scanned and files are
// registered into phase.artifacts. Phase 5 and 7 both write to test/ — pattern
// distinguishes write-mode vs verify-mode outputs.
const PHASE_ARTIFACT_DIRS = {
  0: { dir: 'instruct' },
  1: { dir: 'req' },
  2: { dir: 'design' },
  3: { dir: 'review' },
  4: { dir: 'task' },
  5: { dir: 'test', pattern: /^test-cases\.md$/ },
  6: { dir: 'dev' },
  7: { dir: 'test', pattern: /^(test-plan|test-summary|verification-report|bug-report-.*)\.md$/ },
};

function scanPhaseArtifacts(projectRoot, projectName, phaseId) {
  const config = PHASE_ARTIFACT_DIRS[phaseId];
  if (!config) return [];
  const dwsDir = join(projectRoot, '.dws', projectName);
  const dir = join(dwsDir, config.dir);
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (name === '.serve' || name === 'screenshots' || name === '.tmp') continue;
        walk(full);
      } else {
        if (config.pattern && !config.pattern.test(name)) continue;
        const rel = relative(dwsDir, full).replace(/\\/g, '/');
        out.push({ path: rel, name });
      }
    }
  };
  walk(dir);
  return out;
}

const app = express();
const server = createServer(app);

app.use(express.json());

const clients = new Set();
let currentState = null;
let lastStateHash = '';

// ── CLI arg parser ──────────────────────────────────
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

// ── State file reading (with retry for atomic writes) ──
function readStateFile() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!existsSync(STATE_FILE)) return null;
      const raw = readFileSync(STATE_FILE, 'utf-8');
      let parsed = JSON.parse(raw);
      // Handle double-encoded JSON (file contains a JSON string instead of object)
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return parsed;
    } catch {
      if (attempt === 0) continue; // file may be mid-atomic-rename
    }
  }
  return null;
}

// ── Atomic state file write ─────────────────────────
function writeStateFile(state) {
  const tmp = STATE_FILE + '.tmp';
  const data = JSON.stringify(state, null, 2);
  writeFileSync(tmp, data, 'utf-8');
  renameSync(tmp, STATE_FILE);
}

// ── Dynamic phase/step creation ──────────────────────
// Phases and steps are created on-the-fly from CC execution,
// not from a hardcoded template. Names come from CC via
// --phase-name / --step-name params, or are derived from IDs.

function isDefaultPhaseName(name, phaseId) {
  return !name || name === `阶段 ${phaseId}`;
}

function ensurePhase(state, phaseId, name) {
  if (!Array.isArray(state.phases)) state.phases = [];
  const existing = state.phases.find(p => p.id === phaseId);
  if (existing) {
    // Update name if currently default and a real name is now provided.
    // This fixes phases that were pre-created (by an activity or step event)
    // with the default "阶段 N" name before the skill sent the proper --phase-name.
    if (name && isDefaultPhaseName(existing.name, phaseId)) {
      existing.name = name;
    }
    return;
  }
  state.phases.push({
    id: phaseId,
    name: name || `阶段 ${phaseId}`,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    steps: [],
    artifacts: [],
  });
  // Sort by id (numeric or string); non-numeric IDs go last
  state.phases.sort((a, b) => {
    const na = typeof a.id === 'number' ? a.id : Infinity;
    const nb = typeof b.id === 'number' ? b.id : Infinity;
    return na - nb;
  });
}

function ensureStep(phase, stepId, name) {
  if (!Array.isArray(phase.steps)) phase.steps = [];
  const existing = phase.steps.find(s => s.id === stepId);
  if (existing) {
    // Update name if currently default (empty or equal to id) and a real name is provided.
    if (name && (!existing.name || existing.name === stepId)) {
      existing.name = name;
    }
    return;
  }
  phase.steps.push({
    id: stepId,
    name: name || stepId,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    detail: '',
  });
}

// ── Activity log helper ─────────────────────────────
function pushActivity(state, phase, action, message, level) {
  if (!Array.isArray(state.activityLog)) state.activityLog = [];
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

// ── Shared: apply state mutation + persist + broadcast ──
function mutateState(fn) {
  let state = readStateFile();
  // If file is missing but we have in-memory state, recover from memory
  if (!state && currentState) {
    state = currentState;
    console.warn('State file missing, recovering from in-memory state');
  }
  if (!state) return null;
  fn(state);
  state.updatedAt = new Date().toISOString();
  writeStateFile(state);
  currentState = state;
  lastStateHash = computeHash(JSON.stringify(state));
  broadcastState(state);
  return state;
}

// ── SSE broadcast ───────────────────────────────────
function broadcastState(state) {
  const data = JSON.stringify(state);
  for (const res of clients) {
    try {
      res.write(`event: state\ndata: ${data}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

function broadcastError(message) {
  for (const res of clients) {
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

// ── File change detection ────────────────────────────
function computeHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

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

  // Fallback poll (catches changes API-based writes may trigger chokidar to miss)
  setInterval(checkAndBroadcast, 1000);
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
  if (stepId === undefined || !status) {
    return res.status(400).json({ success: false, error: 'Missing stepId or status' });
  }
  const updated = mutateState(state => {
    ensurePhase(state, phaseId, phaseName);
    const phase = (state.phases || []).find(p => p.id === phaseId);
    if (!phase) return;
    ensureStep(phase, stepId, stepName);
    const step = (phase.steps || []).find(s => s.id === stepId);
    if (!step) return;

    const prevStatus = step.status;
    step.status = status;
    const now = new Date().toISOString();

    if (status === 'in-progress' && !step.startedAt) {
      step.startedAt = now;
    }
    if (['completed', 'blocked', 'skipped'].includes(status)) {
      step.completedAt = now;
    }
    if (detail !== undefined) step.detail = detail;
    if (result !== undefined) step.result = result;

    // Activity log for state transitions
    if (prevStatus !== status) {
      const level = status === 'completed' ? 'success' : status === 'blocked' ? 'error' : 'info';
      pushActivity(state, phaseId ?? state.currentPhase, 'step-' + status, step.name, level);
    }
  });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found or step not found' });
  res.json({ success: true });
});

// Update phase status
app.post('/api/state/phase', (req, res) => {
  const { phaseId, status, artifacts, phaseName } = req.body;
  if (phaseId === undefined || !status) {
    return res.status(400).json({ success: false, error: 'Missing phaseId or status' });
  }
  const updated = mutateState(state => {
    ensurePhase(state, phaseId, phaseName);
    const phase = (state.phases || []).find(p => p.id === phaseId);
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
      const scanned = scanPhaseArtifacts(PROJECT_ROOT, PROJECT_NAME, phaseId);
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
  });
  if (!updated) return res.status(404).json({ success: false, error: 'State file not found or phase not found' });
  res.json({ success: true });
});

// Update overall workflow status
app.post('/api/state/overall', (req, res) => {
  const { currentPhase, overallStatus, currentIteration, totalIterations } = req.body;
  const updated = mutateState(state => {
    if (currentPhase !== undefined) state.currentPhase = currentPhase;
    if (overallStatus !== undefined) state.overallStatus = overallStatus;
    if (currentIteration !== undefined) state.currentIteration = currentIteration;
    if (totalIterations !== undefined) state.totalIterations = totalIterations;

    pushActivity(state, currentPhase ?? state.currentPhase, 'status-update', overallStatus || 'in-progress', 'info');
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
      const phaseId = entry.phase ?? state.currentPhase;
      pushActivity(state, phaseId, entry.action, entry.message, entry.level || 'info');
    }
    // Auto-advance: ensure the current in-progress phase always has an in-progress step
    // so the Dashboard header indicator shows what CC is doing right now.
    // Only promotes an existing pending step; NEVER creates a new step from an
    // activity message — that previously produced phantom steps like "开始需求分析阶段"
    // when informational activities (phase-started, browser-env-ready, etc.) arrived
    // between steps. If there's no pending step, the header simply shows no active step.
    const currentPhase = (state.phases || []).find(p => p.id === state.currentPhase);
    if (currentPhase && currentPhase.status === 'in-progress' && Array.isArray(currentPhase.steps)) {
      const hasActive = currentPhase.steps.some(s => s.status === 'in-progress');
      if (!hasActive) {
        const nextPending = currentPhase.steps.find(s => s.status === 'pending');
        if (nextPending) {
          nextPending.status = 'in-progress';
          nextPending.startedAt = new Date().toISOString();
        }
      }
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
    state.overallStatus = 'consensus-loop';
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
app.post('/api/state/bug', (req, res) => {
  const { round, newBugs, fixedBugs, remainingBugs, iterationId, details } = req.body;
  if (round === undefined) {
    return res.status(400).json({ success: false, error: 'Missing round' });
  }
  const updated = mutateState(state => {
    state.overallStatus = 'tdd-loop';
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
      details: details || null
    });
    if (remainingBugs === 0) {
      state.bugTracker.status = 'stable';
      state.overallStatus = 'in-progress';
    } else if (round >= 3 && remainingBugs > 0) {
      state.bugTracker.status = 'escalated';
    } else {
      state.bugTracker.status = 'converging';
    }
    const level = remainingBugs === 0 ? 'success' : newBugs > 0 ? 'error' : 'info';
    pushActivity(state, 7, 'test-round', `第${round}轮: ${newBugs}新Bug, ${fixedBugs}已修复, ${remainingBugs}剩余`, level);
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
      pushActivity(state, state.currentPhase, 'question-answered', `回答: ${allValues.join(', ')}`, 'info');
    } else if (Array.isArray(selectedValues)) {
      // Legacy single answer
      state.pendingQuestion.answer = {
        selectedValues,
        customText: customText || '',
        answeredAt: new Date().toISOString()
      };
      answerData = state.pendingQuestion.answer;
      pushActivity(state, state.currentPhase, 'question-answered', `回答: ${selectedValues.join(', ')}${customText ? ' + 自定义' : ''}`, 'info');
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
      pushActivity(state, state.currentPhase, 'question-superseded', `前一个问题被新问题取代: ${prevQ}`, 'warning');
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
      pushActivity(state, state.currentPhase, 'question-pushed', `CC 提问 (${questions.length}个问题): ${summary}`, 'info');
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
      pushActivity(state, state.currentPhase, 'question-pushed', `CC 提问: ${question.substring(0, 50)}`, 'info');
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
        pushActivity(state, state.currentPhase, 'question-cleared', '问题已清理（CLI 已处理）', 'info');
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

  // Heartbeat
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      clients.delete(res);
    }
  }, 30000);

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

  // Prevent directory traversal
  if (!filePath.startsWith(resolve(PROJECT_ROOT))) {
    return res.status(403).send('Forbidden');
  }

  if (!existsSync(filePath)) {
    return res.status(404).send('Not found');
  }

  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', mime);

  if (ext === '.md') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    try {
      res.sendFile(filePath);
    } catch {
      res.status(500).send('Error reading file');
    }
  } else if (!MIME[ext]) {
    res.setHeader('Content-Disposition', `attachment; filename="${reqPath.split('/').pop()}"`);
    res.sendFile(filePath);
  } else {
    res.sendFile(filePath);
  }
});

// ── Open browser ────────────────────────────────────
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start ${url}`
    : process.platform === 'darwin' ? `open ${url}`
    : `xdg-open ${url}`;
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

    // Start watching state file
    startWatcher();

    // Try to load initial state
    currentState = readStateFile();

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

// ── Node.js version check ──────────────────────────
const nodeVersion = parseInt(process.version.slice(1).split('.')[0]);
if (nodeVersion < 14) {
  console.error(`Dashboard requires Node.js 14+. Current: ${process.version}`);
  process.exit(1);
}

startServer(PORT);
