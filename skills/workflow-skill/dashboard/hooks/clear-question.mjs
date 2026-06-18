#!/usr/bin/env node
// PostToolUse hook for AskUserQuestion — clears question from Dashboard after CLI handles it.

import {
  findDashboardPorts, httpPost, debug, readStdin,
} from './lib/hook-common.mjs';

const TAG = 'clear-question';

// ── Clear question from ALL running Dashboards ──────
// Uses includePortScan so we still attempt cleanup if .dws can't be located
// (e.g. cwd is outside the project). Extra POSTs to closed ports are cheap.
async function clearQuestion() {
  const ports = findDashboardPorts({ includePortScan: true });
  debug(TAG, `Clearing on ports: ${ports.join(', ')}`);

  const results = await Promise.all(
    ports.map(port => httpPost(port, '/api/question/clear', {}))
  );

  for (const r of results) {
    if (r.status === 200) {
      debug(TAG, `Cleared on port ${r.port}`);
    }
  }
}

// ── Main ───────────────────────────────────────────
async function main() {
  try {
    const input = await readStdin();

    if (input.trim()) {
      try {
        const data = JSON.parse(input);
        debug(TAG, `Received: tool_name=${data.tool_name}`);
        if (data.tool_name !== 'AskUserQuestion') {
          process.exit(0);
        }
      } catch {}
    }

    await clearQuestion();
  } catch (e) {
    debug(TAG, `Fatal: ${e.message}`);
  }

  process.exit(0);
}

main();
