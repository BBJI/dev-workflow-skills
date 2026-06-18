// shared.mjs — Common utilities used by server.mjs, notify-state.mjs, and the
// other dashboard scripts. Extracted to keep the previously-duplicated logic
// (parseArgs, toWinPath, state file I/O, phase/step helpers, auto-advance)
// in one place so bug fixes only need to happen once.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, mkdirSync } from 'fs';
import { join, resolve, dirname, basename, relative } from 'path';

// ── CLI arg parsing ────────────────────────────────
// Parses --key value (or --key flag) into an object. Used by every dashboard
// script — keeping it here avoids 5 near-identical copies drifting apart.
export function parseArgs() {
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

// ── Windows Git Bash path conversion ───────────────
// Converts /d/project/... to D:\project\... on Windows. Git Bash passes paths
// in Unix form; Node.js on Windows needs the native form for fs APIs.
export function toWinPath(p) {
  if (!p) return p;
  if (process.platform !== 'win32') return p;
  return p.replace(/^\/([a-zA-Z])(\/|$)/, (_, drive, sep) => drive.toUpperCase() + ':' + (sep ? '\\' : ''));
}

// ── ID normalization ───────────────────────────────
// CLI/hook callers pass IDs as strings ("1"); state stores them as numbers (1).
// Without normalization, `p.id === phaseId` matches fail silently. Numeric
// strings become numbers; everything else (e.g. "req-step-1") stays a string.
export function parseId(val) {
  if (val === undefined || val === null) return val;
  const n = Number(val);
  return Number.isNaN(n) ? val : n;
}

// ── Phase → artifact directory mapping ─────────────
// When a phase is marked completed, its artifact subdirectory under
// .dws/{project}/ is auto-scanned and files are registered into phase.artifacts.
// Phase 5 and 7 both write to test/ — pattern distinguishes write-mode vs
// verify-mode outputs.
export const PHASE_ARTIFACT_DIRS = {
  0: { dir: 'instruct' },
  1: { dir: 'req' },
  2: { dir: 'design' },
  3: { dir: 'review' },
  4: { dir: 'task' },
  5: { dir: 'test', pattern: /^test-cases\.md$/ },
  6: { dir: 'dev' },
  7: { dir: 'test', pattern: /^(test-plan|test-summary|verification-report|bug-report-.*)\.md$/ },
};

export function scanPhaseArtifacts(projectRoot, projectName, phaseId) {
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

// ── State file I/O ─────────────────────────────────
// Reads state file with retry for atomic writes (tmp + rename can be observed
// mid-flight). Also handles double-encoded JSON (file contains a JSON string
// instead of an object) — a bug from older writers that we keep tolerating.
export function readStateFile(stateFile) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!existsSync(stateFile)) return null;
      let parsed = JSON.parse(readFileSync(stateFile, 'utf-8'));
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return parsed;
    } catch {
      if (attempt === 0) continue;
    }
  }
  return null;
}

export function writeStateFileAtomic(stateFile, state) {
  const tmp = stateFile + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  renameSync(tmp, stateFile);
}

// ── Hashing (for change detection) ─────────────────
export function computeHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

// ── Dynamic phase/step creation ────────────────────
export function isDefaultPhaseName(name, phaseId) {
  return !name || name === `阶段 ${phaseId}`;
}

export function ensurePhase(state, phaseId, name) {
  if (!Array.isArray(state.phases)) state.phases = [];
  const existing = state.phases.find(p => p.id === phaseId);
  if (existing) {
    // Update name if currently default and a real name is now provided.
    // Fixes phases that were pre-created (by an activity or step event) with
    // the default "阶段 N" name before the skill sent the proper --phase-name.
    if (name && isDefaultPhaseName(existing.name, phaseId)) {
      existing.name = name;
    }
    return existing;
  }
  const phase = {
    id: phaseId,
    name: name || `阶段 ${phaseId}`,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    steps: [],
    artifacts: [],
  };
  state.phases.push(phase);
  // Sort by id (numeric or string); non-numeric IDs go last
  state.phases.sort((a, b) => {
    const na = typeof a.id === 'number' ? a.id : Infinity;
    const nb = typeof b.id === 'number' ? b.id : Infinity;
    return na - nb;
  });
  return phase;
}

export function ensureStep(phase, stepId, name) {
  if (!Array.isArray(phase.steps)) phase.steps = [];
  const existing = phase.steps.find(s => s.id === stepId);
  if (existing) {
    if (name && (!existing.name || existing.name === stepId)) {
      existing.name = name;
    }
    return existing;
  }
  const step = {
    id: stepId,
    name: name || stepId,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    detail: '',
  };
  phase.steps.push(step);
  return step;
}

// ── Activity log ───────────────────────────────────
// Trim happens lazily: only slice when length crosses 250, then drop back to
// 200. This amortizes the O(n) slice across ~50 pushes instead of running it
// on every single entry, which matters when a caller batches many activities
// into one mutateState call.
const ACTIVITY_LOG_SOFT_CAP = 250;
const ACTIVITY_LOG_TRIM_TO = 200;

export function pushActivity(state, phase, action, message, level) {
  if (!Array.isArray(state.activityLog)) state.activityLog = [];
  state.activityLog.push({
    timestamp: new Date().toISOString(),
    phase,
    action,
    message,
    level: level || 'info'
  });
  if (state.activityLog.length > ACTIVITY_LOG_SOFT_CAP) {
    state.activityLog = state.activityLog.slice(-ACTIVITY_LOG_TRIM_TO);
  }
}

// ── Step auto-advance helpers ──────────────────────
// CC is unreliable about sending --status in-progress. It often jumps straight
// to --status completed without ever marking the step (or the previous one) as
// in-progress. These helpers keep the dashboard honest:
//   - markSiblingsCompleted: when a step goes in-progress, complete any other
//     in-progress step in the same phase (you can't have two at once)
//   - promoteNextPending: when a step reaches a terminal state, promote the
//     next pending step so the dashboard always shows what CC is doing now
export function markSiblingsCompleted(phase, exceptStepId, now) {
  if (!Array.isArray(phase.steps)) return;
  for (const s of phase.steps) {
    if (s.id === exceptStepId) continue;
    if (s.status === 'in-progress') {
      s.status = 'completed';
      if (!s.startedAt) s.startedAt = now;
      s.completedAt = now;
    }
  }
}

export function promoteNextPending(phase, now) {
  if (!Array.isArray(phase.steps)) return;
  const hasActive = phase.steps.some(s => s.status === 'in-progress');
  if (hasActive) return;
  const next = phase.steps.find(s => s.status === 'pending');
  if (next) {
    next.status = 'in-progress';
    next.startedAt = now;
  }
}
