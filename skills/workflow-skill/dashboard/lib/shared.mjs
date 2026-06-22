// shared.mjs — Common utilities used by server.mjs, notify-state.mjs, and the
// other dashboard scripts. Extracted to keep the previously-duplicated logic
// (parseArgs, toWinPath, state file I/O, phase/step helpers, auto-advance)
// in one place so bug fixes only need to happen once.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, mkdirSync, unlinkSync, openSync, closeSync } from 'fs';
import { join, resolve, dirname, basename, relative } from 'path';
import { createHash } from 'crypto';

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
// Empty string is treated as missing — Number('') === 0 would otherwise turn
// an absent phaseId into phase 0.
export function parseId(val) {
  if (val === undefined || val === null || val === '') return undefined;
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
  // Depth limit guards against runaway recursion into deep/symlinked trees.
  const MAX_DEPTH = 5;
  const walk = (d, depth) => {
    if (depth > MAX_DEPTH) return;
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (name === '.serve' || name === 'screenshots' || name === '.tmp') continue;
        walk(full, depth + 1);
      } else {
        if (config.pattern && !config.pattern.test(name)) continue;
        const rel = relative(dwsDir, full).replace(/\\/g, '/');
        out.push({ path: rel, name });
      }
    }
  };
  walk(dir, 0);
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
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    renameSync(tmp, stateFile);
  } catch (e) {
    // Clean up the tmp file on failure — otherwise it lingers and the next
    // successful write sees a stale tmp sibling (harmless but messy).
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    throw e;
  }
}

// ── File lock for fallback (direct-write) path ──────
// notify-state.mjs falls back to read-modify-write when the Dashboard API is
// unreachable. CC frequently spawns multiple notify-state processes in
// parallel (e.g. step + activity back-to-back), and without serialization
// the second write wins, losing the first mutation. The Dashboard server
// doesn't need this — its mutations are single-threaded in-process — but
// fallback writers do.
//
// Strategy: O_EXCL create a sibling lock file, retry for up to ~2s with
// exponential backoff. Stale locks (owner process dead) are reclaimed by
// mtime check — if the lock is older than STALE_LOCK_MS, steal it.
const LOCK_RETRY_MS = 2000;
const LOCK_BASE_DELAY = 25;
const STALE_LOCK_MS = 10000;

export async function withStateLock(stateFile, fn) {
  const lockFile = stateFile + '.lock';
  const dir = dirname(stateFile);
  try { mkdirSync(dir, { recursive: true }); } catch {}

  const acquire = () => {
    try {
      // O_EXCL: create exclusively. Throws EEXIST if already held.
      const fd = openSync(lockFile, 'wx');
      // Write our pid so a stuck lock can be attributed later (debugging).
      try { writeFileSync(fd, String(process.pid)); } catch {}
      try { closeSync(fd); } catch {}
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Existing lock — check staleness.
      try {
        const st = statSync(lockFile);
        if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
          // Stale: unlink and retry. Best-effort; if unlink fails (race with
          // another thief), the next attempt will see a fresh lock and wait.
          try { unlinkSync(lockFile); } catch {}
          return false;
        }
      } catch {}
      return false;
    }
  };

  const deadline = Date.now() + LOCK_RETRY_MS;
  let delay = LOCK_BASE_DELAY;
  let held = false;
  while (Date.now() < deadline) {
    if (acquire()) { held = true; break; }
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 2, 200);
  }
  if (!held) {
    // Could not acquire — proceed without lock rather than block the workflow.
    // Worst case is a lost mutation, same as the pre-lock behavior.
    return fn();
  }

  try {
    return fn();
  } finally {
    try { unlinkSync(lockFile); } catch {}
  }
}

// ── Hashing (for change detection) ─────────────────
// Used to detect state-file changes between chokidar polls. Cryptographic
// strength isn't required, but the previous hand-rolled DJB2 had measurable
// collision rates on large state files (which would cause missed broadcasts).
// md5 is fast, available everywhere, and collision-free for our use case.
export function computeHash(str) {
  return createHash('md5').update(str).digest('hex');
}

// ── Dynamic phase/step creation ────────────────────
export function isDefaultPhaseName(name, phaseId) {
  return !name || name === `阶段 ${phaseId}`;
}

export function ensurePhase(state, phaseId, name) {
  if (!Array.isArray(state.phases)) state.phases = [];
  if (phaseId === undefined || phaseId === null) {
    // Defensive guard: callers should resolve a real id before calling.
    // Returning without creating prevents phantom phases with id=undefined
    // that render as "undefined" in the Dashboard timeline.
    return null;
  }
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
