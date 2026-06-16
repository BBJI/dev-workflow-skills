#!/usr/bin/env node
// dashboard-ask.mjs — Dashboard Q&A helper: push question(s) + poll for answer + clear
// Usage: node dashboard-ask.mjs --project-root ... --project-name ... --question "text" --header "title" --options '[...]'
//    OR: node dashboard-ask.mjs --project-root ... --project-name ... --questions '[{...},{...}]'

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

function toWinPath(p) {
  if (!p) return p;
  if (process.platform !== 'win32') return p;
  return p.replace(/^\/([a-zA-Z])(\/|$)/, (_, drive, sep) => drive.toUpperCase() + ':' + (sep ? '\\' : ''));
}

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

function isDashboardRunning(projectRoot, projectName) {
  const portFile = join(projectRoot, '.dws', projectName, '.dashboard.port');
  try {
    if (existsSync(portFile)) {
      const port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
      if (port > 0 && port < 65536) return true;
    }
  } catch {}
  return false;
}

async function main() {
  const args = parseArgs();
  const projectRoot = resolve(toWinPath(args['project-root']) || process.cwd());
  const projectName = args['project-name'] || 'default';

  if (!isDashboardRunning(projectRoot, projectName)) {
    // Dashboard not running — output special marker so CC knows to use AskUserQuestion
    console.log('DASHBOARD_NOT_RUNNING');
    process.exit(0);
  }

  // Find notify-state.mjs (sibling of this script)
  const scriptDir = resolve(import.meta.dirname);
  const notifyState = join(scriptDir, 'notify-state.mjs');

  // Step 1: Push question
  const { execSync } = await import('child_process');

  let pushCmd;
  if (args.questions) {
    // Write questions to temp file to avoid shell quoting issues
    const tmpFile = join(projectRoot, '.dws', projectName, '.tmp', 'questions.json');
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(join(projectRoot, '.dws', projectName, '.tmp'), { recursive: true });
    writeFileSync(tmpFile, args.questions, 'utf-8');
    pushCmd = `node "${notifyState}" --project-root "${projectRoot}" --project-name "${projectName}" --type question --questions @"${tmpFile}"`;
  } else {
    // Single question — use --question flag
    const question = args.question || '';
    const header = args.header || 'CC 需要你的决策';
    const multiSelect = args['multi-select'] || 'false';
    const options = args.options || '[]';

    // Write options to temp file
    const tmpFile = join(projectRoot, '.dws', projectName, '.tmp', 'question-opts.json');
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(join(projectRoot, '.dws', projectName, '.tmp'), { recursive: true });

    // Build the full question payload and write to file
    const payload = JSON.stringify({
      question,
      header,
      multiSelect: multiSelect === 'true',
      options: JSON.parse(options)
    });
    writeFileSync(tmpFile, JSON.stringify([JSON.parse(payload)]), 'utf-8');

    pushCmd = `node "${notifyState}" --project-root "${projectRoot}" --project-name "${projectName}" --type question --questions @"${tmpFile}"`;
  }

  try {
    execSync(pushCmd, { stdio: 'pipe', timeout: 5000 });
  } catch (e) {
    console.error('Push failed:', e.message);
    process.exit(1);
  }

  // Step 2: Poll for answer
  const stateFile = join(projectRoot, '.dws', projectName, 'workflow-state.json');
  const timeout = parseInt(args.timeout) || 1800;
  const interval = 3;
  let elapsed = 0;

  while (elapsed < timeout) {
    try {
      if (existsSync(stateFile)) {
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        const pq = state.pendingQuestion;
        if (pq && pq.status === 'answered') {
          // Step 3: Output answer
          const answer = pq.answer;
          if (answer.answers && Array.isArray(answer.answers)) {
            console.log('ANSWER_RECEIVED:' + JSON.stringify(answer.answers));
          } else {
            console.log('ANSWER_RECEIVED:' + JSON.stringify({
              selectedValues: answer.selectedValues,
              customText: answer.customText || ''
            }));
          }

          // Step 4: Clear question
          try {
            execSync(`node "${notifyState}" --project-root "${projectRoot}" --project-name "${projectName}" --type question-clear`, { stdio: 'pipe', timeout: 5000 });
          } catch {}

          process.exit(0);
        }
      }
    } catch {}

    // Wait
    await new Promise(r => setTimeout(r, interval * 1000));
    elapsed += interval;
  }

  console.log('ANSWER_TIMEOUT');
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
