#!/usr/bin/env node
// serve-preview.mjs — Start/stop the project-under-test's dev/preview server
// for test-skill's automated browser verification (Playwright MCP).
//
// Subcommands:
//   start  --project-root <path> --project-name <name> [--script <name>] [--timeout <sec>]
//   stop   --project-root <path> --project-name <name>
//   status --project-root <path> --project-name <name>
//
// start spawns `npm run <script>` detached, polls candidate ports for HTTP,
// writes .dws/<name>/test/.serve/status.json on success, then exits 0 while
// the child keeps running. stop kills the recorded pid tree.

import { spawn, spawnSync } from 'child_process';
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync,
} from 'fs';
import { join } from 'path';
import { request } from 'http';
import { toWinPath } from './lib/shared.mjs';

// serve-preview needs positional args (start/stop/status), so it uses a
// slightly different parseArgs than the other scripts. We define it locally
// rather than reuse shared.parseArgs (which only handles --key value).
function parseArgs() {
  const args = { _: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

const args = parseArgs();
const subcommand = args._[0] || 'status';
const projectRoot = toWinPath(args['project-root']);
const projectName = args['project-name'];
const scriptOverride = args.script;
const timeoutSec = parseInt(args.timeout || '60', 10);

if (!projectRoot || !projectName) {
  console.error('Usage: serve-preview.mjs <start|stop|status> --project-root <path> --project-name <name>');
  process.exit(2);
}

const serveDir = join(projectRoot, '.dws', projectName, 'test', '.serve');
const statusFile = join(serveDir, 'status.json');
const logFile = join(serveDir, 'log.txt');

function ensureServeDir() {
  mkdirSync(serveDir, { recursive: true });
}

function readStatus() {
  try {
    if (!existsSync(statusFile)) return null;
    return JSON.parse(readFileSync(statusFile, 'utf-8'));
  } catch { return null; }
}

function writeStatus(obj) {
  ensureServeDir();
  const tmp = statusFile + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  renameSync(tmp, statusFile);
}

// ── HTTP probe: any response (even non-2xx) means server is listening ──
function probe(port) {
  return new Promise((resolve) => {
    const req = request({
      hostname: 'localhost', port, path: '/', method: 'GET', timeout: 1500,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

const CANDIDATE_PORTS = [5173, 4173, 3000, 8080, 5000, 8888, 3456];

// ── Snapshot all listening TCP ports via netstat (Win) / ss (Linux) / lsof (mac) ──
function snapshotListeningPorts() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'netstat' : 'ss';
    const args = isWin ? ['-ano'] : ['-ltn'];
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.on('error', () => resolve(new Set()));
    child.on('close', () => {
      const ports = new Set();
      // Match ":PORT" in LISTENING rows (netstat) or local address (ss)
      const re = /[:.](\d{2,5})\b\s+(?:LISTENING|\s)/g;
      let m;
      while ((m = re.exec(out)) !== null) {
        const p = parseInt(m[1], 10);
        if (p > 0 && p < 65536) ports.add(p);
      }
      // ss output marks state as "LISTEN"; netstat as "LISTENING"
      resolve(ports);
    });
  });
}

async function waitForServer(logFilePath, timeoutMs, preExistingPorts) {
  const deadline = Date.now() + timeoutMs;
  let detectedPort = null;
  const seenPorts = new Set();
  const portRe = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::):(\d{2,5})/g;

  const scanLog = () => {
    try {
      if (!existsSync(logFilePath)) return;
      const txt = readFileSync(logFilePath, 'utf-8');
      let m;
      portRe.lastIndex = 0;
      while ((m = portRe.exec(txt)) !== null) {
        const p = parseInt(m[1], 10);
        if (p > 0 && p < 65536) seenPorts.add(p);
      }
    } catch {}
  };

  while (Date.now() < deadline) {
    scanLog();
    // Priority 1: ports the server explicitly announced in its log (last-mentioned wins)
    const logPorts = Array.from(seenPorts).reverse();
    for (const p of logPorts) {
      if (preExistingPorts.has(p)) continue;
      if (await probe(p)) { detectedPort = p; break; }
    }
    if (detectedPort) break;
    // Priority 2: candidate ports that were NOT responding before spawn
    for (const p of CANDIDATE_PORTS) {
      if (preExistingPorts.has(p)) continue;
      if (await probe(p)) { detectedPort = p; break; }
    }
    if (detectedPort) break;
    // Priority 3: any newly-listening port (netstat diff) — catches unusual ports
    const nowPorts = await snapshotListeningPorts();
    for (const p of nowPorts) {
      if (preExistingPorts.has(p)) continue;
      if (await probe(p)) { detectedPort = p; break; }
    }
    if (detectedPort) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  return detectedPort;
}

function pickScript(pkg) {
  if (scriptOverride) return scriptOverride;
  const scripts = (pkg && pkg.scripts) || {};
  for (const candidate of ['preview', 'dev', 'start']) {
    if (scripts[candidate]) return candidate;
  }
  return null;
}

async function cmdStart() {
  ensureServeDir();
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) {
    writeStatus({ ok: false, error: 'package.json not found at ' + pkgPath, startedAt: new Date().toISOString() });
    console.error('package.json not found at', pkgPath);
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const script = pickScript(pkg);
  if (!script) {
    writeStatus({ ok: false, error: 'No preview/dev/start script in package.json', startedAt: new Date().toISOString() });
    console.error('No preview/dev/start script found in', pkgPath);
    process.exit(1);
  }

  // Use shell-mode spawn with redirection in the command string.
  // - shell:true lets Node quote the command correctly on Windows.
  // - Forward slashes in the redirected path: backslashes inside the cmd
  //   string get misinterpreted as escape chars.
  // - detached:false on Windows: Volta's npm.cmd misbehaves under detached:true
  //   (exits immediately). Windows doesn't auto-kill children on parent exit,
  //   so the server survives anyway. POSIX uses detached:true so the server
  //   survives terminal close.
  const isWin = process.platform === 'win32';
  const logPathForShell = logFile.replace(/\\/g, '/');
  const child = spawn(`npm run ${script} > "${logPathForShell}" 2>&1`, {
    cwd: projectRoot,
    detached: !isWin,
    stdio: 'ignore',
    shell: true,
    windowsHide: false,
  });
  if (!isWin) child.unref();

  child.on('error', (err) => {
    writeStatus({ ok: false, error: 'spawn failed: ' + err.message, startedAt: new Date().toISOString() });
    console.error('spawn failed:', err.message);
    process.exit(1);
  });

  // Snapshot pre-existing listening ports so we only accept newly-bound ones.
  // Uses netstat/ss for a full picture (not just candidate ports), so a server
  // that binds to an unusual port is correctly attributed.
  const preExistingPorts = await snapshotListeningPorts();

  const port = await waitForServer(logFile, timeoutSec * 1000, preExistingPorts);
  if (!port) {
    try {
      if (isWin) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      else process.kill(child.pid, 'SIGTERM');
    } catch {}
    writeStatus({
      ok: false,
      error: `server did not respond within ${timeoutSec}s`,
      script, pid: child.pid, logFile,
      startedAt: new Date().toISOString(),
    });
    console.error(`server did not respond within ${timeoutSec}s — see ${logFile}`);
    process.exit(1);
  }

  const status = {
    ok: true,
    pid: child.pid,
    port,
    url: `http://localhost:${port}`,
    script,
    logFile,
    startedAt: new Date().toISOString(),
  };
  writeStatus(status);
  console.log(JSON.stringify(status));
  process.exit(0);
}

function findPidOnPort(port) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'netstat' : 'ss';
    const args = isWin ? ['-ano'] : ['-ltnp'];
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const lines = out.split(/\r?\n/);
      for (const line of lines) {
        if (!/LISTENING|LISTEN/.test(line)) continue;
        if (!line.includes(`:${port}`) && !line.includes(`:${port} `)) continue;
        // netstat: last column is pid; ss: pid/users column
        const m = line.match(/(\d+)\s*$/) || line.match(/pid=(\d+)/);
        if (m) {
          const pid = parseInt(m[1], 10);
          if (pid > 0) return resolve(pid);
        }
      }
      resolve(null);
    });
  });
}

async function cmdStop() {
  const status = readStatus();
  if (!status || !status.pid) {
    console.log('not running');
    return;
  }
  const isWin = process.platform === 'win32';

  // Volta/npm.cmd may launch node detached from the shell's process tree,
  // so taskkill /T on the shell pid misses the actual server. Find the pid
  // listening on status.port via netstat and kill that tree first.
  if (status.port) {
    const listenerPid = await findPidOnPort(status.port);
    if (listenerPid) {
      try {
        if (isWin) spawnSync('taskkill', ['/PID', String(listenerPid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(listenerPid, 'SIGTERM');
      } catch {}
    }
  }

  // Also kill the recorded shell pid tree as a fallback
  try {
    if (isWin) spawnSync('taskkill', ['/PID', String(status.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(status.pid, 'SIGTERM'); } catch {} }
  } catch {}

  // POSIX: escalate to SIGKILL after grace
  if (!isWin) {
    await new Promise(r => setTimeout(r, 1500));
    try { process.kill(status.pid, 'SIGKILL'); } catch {}
  }

  try { unlinkSync(statusFile); } catch {}
  console.log('stopped');
}

function cmdStatus() {
  const status = readStatus();
  if (!status) {
    console.log(JSON.stringify({ ok: false, running: false }));
    return;
  }
  console.log(JSON.stringify(status));
}

switch (subcommand) {
  case 'start': cmdStart().catch(e => { console.error(e); process.exit(1); }); break;
  case 'stop': cmdStop().catch(e => { console.error(e); process.exit(1); }); break;
  case 'status': cmdStatus(); break;
  default:
    console.error('Unknown subcommand:', subcommand);
    process.exit(2);
}
