const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const http = require('http');

const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, '.workbuddy', 'auto-dev-status.md');
const queueCandidates = [8080, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090];

const priorities = [
  {
    id: 'P0-1',
    title: 'Finish legacy evolution cleanup',
    reason: 'Remove stale extension, Web Console, test, and config entry points from the old self-modification route.',
    files: [
      'chromevideo/offscreen.html',
      'chromevideo/offscreen.js',
      'chromevideo/popup.html',
      'chromevideo/popup.js',
      'chromevideo/controllers/prompt-controller.js',
      'web-console/src/App.tsx',
      'queue-server/test-deepseek-provider.js',
      'shared/config.js',
      'README.md'
    ],
    acceptance: [
      'Legacy evolution message and API entry points are removed.',
      'Web Console builds without calling the removed evolution API.',
      'Deprecated feature flags are removed from shared/config.js.'
    ],
    steps: [
      'Follow doc/refactor-prune-plan-20260425-v1.md only.',
      'Run the validation commands before committing.',
      'Do not add knowledge base, file delivery, or patch review implementation in this cleanup pass.'
    ]
  }
];

function run(command) {
  try {
    return cp.execSync(command, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    return '';
  }
}

function httpRequest(options) {
  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ ok: true, statusCode: res.statusCode, body }));
    });
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(1500, () => { req.destroy(); resolve({ ok: false }); });
    req.end();
  });
}

async function detectQueueServer() {
  for (const port of queueCandidates) {
    const response = await httpRequest({ hostname: '127.0.0.1', port, path: '/health', method: 'GET' });
    if (!response.ok) continue;
    try {
      const data = JSON.parse(response.body || '{}');
      return { running: true, port, service: data.service || 'unknown' };
    } catch (error) {
      return { running: true, port, service: 'unknown' };
    }
  }
  return { running: false, port: null, service: null };
}

async function detectWebConsole() {
  const response = await httpRequest({ hostname: '127.0.0.1', port: 5173, path: '/', method: 'HEAD' });
  return { running: !!response.ok };
}

function buildDirtyList() {
  const status = run('git status --short');
  return status ? status.split('\n').filter(Boolean) : [];
}

async function main() {
  const branch = run('git rev-parse --abbrev-ref HEAD') || 'unknown';
  const lastCommit = run('git log -1 --pretty=format:%h\ %s');
  const dirtyFiles = buildDirtyList();
  const queue = await detectQueueServer();
  const webConsole = await detectWebConsole();
  const lines = [];
  lines.push('# Auto Dev Status', '');
  lines.push('Updated: ' + new Date().toISOString(), '');
  lines.push('## Snapshot', '');
  lines.push('- Branch: `' + branch + '`');
  lines.push('- Last commit: `' + (lastCommit || 'unknown') + '`');
  lines.push('- Queue Server: ' + (queue.running ? 'running on ' + queue.port : 'not running'));
  lines.push('- Web Console: ' + (webConsole.running ? 'running on 5173' : 'not running'));
  lines.push('- Dirty entries: ' + dirtyFiles.length, '');
  lines.push('## Phase', '');
  lines.push('- Base loop exists across extension, Queue Server, Web Console, and Native Host.');
  lines.push('- Current phase: finish cleanup from doc/refactor-prune-plan-20260425-v1.md.');
  lines.push('- The old self-modification route is removed from the active product line.', '');
  lines.push('## Highest Priority', '');
  for (const priority of priorities) {
    lines.push('### ' + priority.id + ' ' + priority.title, '');
    lines.push('- Reason: ' + priority.reason);
    lines.push('- Files: ' + priority.files.map((file) => '`' + file + '`').join(', '));
    lines.push('- Acceptance:');
    for (const item of priority.acceptance) lines.push('  - ' + item);
    lines.push('- Steps:');
    for (const step of priority.steps) lines.push('  - ' + step);
    lines.push('');
  }
  lines.push('## Working Tree', '');
  if (dirtyFiles.length === 0) lines.push('- No uncommitted changes.');
  else for (const file of dirtyFiles.slice(0, 20)) lines.push('- `' + file + '`');
  lines.push('', '## Next Session', '');
  lines.push('- Read this file, README.md, and git status first.');
  lines.push('- Do not restore the removed evolution endpoint or add new feature work in this cleanup pass.');
  lines.push('- Current product line: chat history, knowledge base, file delivery, patch preview, and human confirmation.');
  lines.push('');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  process.stdout.write('Wrote ' + outputPath + '\n');
}

main().catch((error) => {
  process.stderr.write((error.stack || error.message || String(error)) + '\n');
  process.exit(1);
});
