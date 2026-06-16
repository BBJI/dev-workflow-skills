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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, extname, relative } from 'path';
import { createServer } from 'http';

const args = parseArgs();
const PORT = args.port || parseInt(process.env.DWS_PORT) || 3456;
const PROJECT_ROOT = resolve(args['project-root'] || process.cwd());
const PROJECT_NAME = args['project-name'] || 'default';
const DWS_DIR = join(PROJECT_ROOT, '.dws', PROJECT_NAME);
const STATE_FILE = join(DWS_DIR, 'workflow-state.json');
const PID_FILE = join(DWS_DIR, '.dashboard.pid');
const PORT_FILE = join(DWS_DIR, '.dashboard.port');

const app = express();
const server = createServer(app);

app.use(express.json());

const clients = new Set();
let currentState = null;
let debounceTimer = null;

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

// ── State file reading ──────────────────────────────
function readStateFile() {
  try {
    if (!existsSync(STATE_FILE)) return null;
    const raw = readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
let lastStateHash = '';

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
  // Primary: chokidar with polling for cross-platform reliability
  const watcher = watch(STATE_FILE, {
    persistent: true,
    ignoreInitial: false,
    usePolling: true,
    interval: 500,
  });

  watcher.on('add', checkAndBroadcast);
  watcher.on('change', checkAndBroadcast);

  watcher.on('error', (err) => {
    console.error('Watcher error:', err.message);
  });

  // Fallback: periodic poll (catches changes chokidar may miss on Windows)
  setInterval(checkAndBroadcast, 2000);
}

// ── Routes ──────────────────────────────────────────

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

// Question answer API
app.post('/api/question/answer', (req, res) => {
  const { questionId, selectedValues, customText } = req.body;
  if (!questionId || !Array.isArray(selectedValues)) {
    return res.status(400).json({ success: false, error: 'Missing questionId or selectedValues' });
  }
  const state = readStateFile();
  if (!state || !state.pendingQuestion) {
    return res.status(404).json({ success: false, error: 'Question not found' });
  }
  if (state.pendingQuestion.id !== questionId) {
    return res.status(404).json({ success: false, error: 'Question not found' });
  }
  if (state.pendingQuestion.status === 'answered') {
    return res.status(409).json({ success: false, error: 'Question already answered' });
  }

  state.pendingQuestion.status = 'answered';
  state.pendingQuestion.answer = {
    selectedValues,
    customText: customText || '',
    answeredAt: new Date().toISOString()
  };
  state.updatedAt = new Date().toISOString();

  state.activityLog.push({
    timestamp: new Date().toISOString(),
    phase: state.currentPhase,
    action: 'question-answered',
    message: `回答: ${selectedValues.join(', ')}${customText ? ' + 自定义' : ''}`,
    level: 'info'
  });
  if (state.activityLog.length > 200) {
    state.activityLog = state.activityLog.slice(-200);
  }

  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to write state' });
  }
  currentState = state;
  broadcastState(state);
  res.json({ success: true, answer: state.pendingQuestion.answer });
});

// Question push API — Hook pushes AskUserQuestion data here
app.post('/api/question/push', (req, res) => {
  const { id, question, header, multiSelect, options, allowCustom } = req.body;
  if (!question) {
    return res.status(400).json({ success: false, error: 'Missing question' });
  }
  const state = readStateFile();
  if (!state) {
    return res.status(404).json({ success: false, error: 'State file not found' });
  }

  // If there's already a pending question, clear it first
  if (state.pendingQuestion && state.pendingQuestion.status === 'pending') {
    state.activityLog.push({
      timestamp: new Date().toISOString(),
      phase: state.currentPhase,
      action: 'question-superseded',
      message: `前一个问题被新问题取代: ${state.pendingQuestion.question?.substring(0, 40)}`,
      level: 'warning'
    });
  }

  const questionId = id || `q-${String(Date.now()).slice(-6)}`;
  state.pendingQuestion = {
    id: questionId,
    question,
    header: header || 'CC 需要你的决策',
    multiSelect: !!multiSelect,
    options: (options || []).map((opt, i) => ({
      value: opt.value || `opt-${i}`,
      label: opt.label || opt.value || `选项 ${i + 1}`,
      description: opt.description || ''
    })),
    allowCustom: allowCustom !== false,
    status: 'pending',
    answer: null,
    createdAt: new Date().toISOString()
  };
  state.updatedAt = new Date().toISOString();

  state.activityLog.push({
    timestamp: new Date().toISOString(),
    phase: state.currentPhase,
    action: 'question-pushed',
    message: `CC 提问: ${question.substring(0, 50)}`,
    level: 'info'
  });
  if (state.activityLog.length > 200) {
    state.activityLog = state.activityLog.slice(-200);
  }

  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to write state' });
  }
  currentState = state;
  broadcastState(state);
  res.json({ success: true, questionId });
});

// Question clear API — Hook clears question after AskUserQuestion completes
app.post('/api/question/clear', (_req, res) => {
  const state = readStateFile();
  if (!state) {
    return res.status(404).json({ success: false, error: 'State file not found' });
  }

  // Only clear if not answered (if answered, let the frontend handle it)
  if (state.pendingQuestion && state.pendingQuestion.status !== 'answered') {
    state.pendingQuestion = null;
    state.updatedAt = new Date().toISOString();

    state.activityLog.push({
      timestamp: new Date().toISOString(),
      phase: state.currentPhase,
      action: 'question-cleared',
      message: '问题已清理（CLI 已处理）',
      level: 'info'
    });
    if (state.activityLog.length > 200) {
      state.activityLog = state.activityLog.slice(-200);
    }

    try {
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Failed to write state' });
    }
    currentState = state;
    broadcastState(state);
  }
  res.json({ success: true });
});

// SSE endpoint
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

// Artifact serving — paths are relative to PROJECT_ROOT (e.g. .dws/{project}/req/requirements.md)
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
    // Serve markdown as raw text for client-side rendering
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
