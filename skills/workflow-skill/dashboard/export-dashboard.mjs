#!/usr/bin/env node
// export-dashboard.mjs — Generate a self-contained static HTML snapshot of the Dashboard
// Usage: node export-dashboard.mjs --project-root ... --project-name ...

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { parseArgs, toWinPath } from './lib/shared.mjs';

// Escape JSON output for safe embedding inside <script>...</script>.
//   '<'   -> < prevents '</script>' from closing the element
//   U+2028/U+2029 (line/paragraph separator) -> JS string terminators in pre-ES2019 engines
// We use String.fromCharCode to avoid putting raw U+2028/U+2029 in source (which would
// break the regex literal in this file).
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
function safeJsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029');
}

async function main() {
  const args = parseArgs();
  const projectRoot = resolve(toWinPath(args['project-root']) || process.cwd());
  const projectName = args['project-name'] || 'default';
  const stateFile = join(projectRoot, '.dws', projectName, 'workflow-state.json');

  if (!existsSync(stateFile)) {
    console.error(`State file not found: ${stateFile}`);
    process.exit(1);
  }

  let state;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf-8'));
  } catch (e) {
    console.error(`Failed to read state file: ${e.message}`);
    process.exit(1);
  }

  // Remove pendingQuestion (not needed in archive)
  state.pendingQuestion = null;

  // Read index.html template
  const scriptDir = resolve(import.meta.dirname);
  const templateFile = join(scriptDir, 'public', 'index.html');
  if (!existsSync(templateFile)) {
    console.error(`Template not found: ${templateFile}`);
    process.exit(1);
  }
  const template = readFileSync(templateFile, 'utf-8');

  // Inject static state before the main <script> tag (so IS_STATIC is defined before execution)
  const injection = `<script>window.__STATIC_STATE__ = ${safeJsonForScript(state)};</script>\n`;
  const output = template.replace('<script>', `${injection}<script>`);

  // Write output
  const outputDir = join(projectRoot, '.dws', projectName);
  mkdirSync(outputDir, { recursive: true });
  const outputFile = join(outputDir, 'dashboard-final.html');
  writeFileSync(outputFile, output, 'utf-8');

  console.log(`OK static dashboard exported: ${outputFile}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
