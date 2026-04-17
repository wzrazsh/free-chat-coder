#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const cp = require('child_process');

const sharedConfig = require('./shared/config');
const { discoverQueueServer } = require('./shared/queue-server');
const {
  HOST_NAME,
  detectExtensionIdFromProfile,
  getDefaultProfileCandidatesForWorkspace,
  getNativeHostManifestCandidates
} = require('./chromevideo/host/install_host');

const REPO_ROOT = __dirname;
const STATUS_ICON = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
  info: 'ℹ️'
};
const WEB_CONSOLE_PORT = 5173;

function parseArgs(argv) {
  const options = {
    profile: null,
    json: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--profile') {
      options.profile = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith('--profile=')) {
      options.profile = arg.slice('--profile='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsage() {
  console.log('Usage: node validate-environment.js [options]\n');
  console.log('Options:');
  console.log('  --profile <path>  Check a specific Chromium/Chrome profile first');
  console.log('  --json            Print the diagnostic report as JSON');
  console.log('  --help            Show this help message');
}

function resolveInputPath(repoRoot, targetPath) {
  if (!targetPath) {
    return null;
  }

  if (path.isAbsolute(targetPath)) {
    return path.resolve(targetPath);
  }

  return path.resolve(repoRoot, targetPath);
}

function displayPath(repoRoot, targetPath) {
  if (!targetPath) {
    return '(not set)';
  }

  const relative = path.relative(repoRoot, targetPath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative || '.';
  }

  return targetPath;
}

function dedupe(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function runCommand(command, args, options = {}) {
  const result = cp.spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8'
  });

  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

function resolveCommandPath(binary) {
  if (process.platform === 'win32') {
    const result = runCommand('where', [binary]);
    const resolved = (result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return result.ok ? resolved || null : null;
  }

  const result = runCommand('bash', ['-lc', `command -v ${binary}`]);
  return result.ok && result.stdout ? result.stdout.split(/\r?\n/)[0].trim() : null;
}

function findBrowserExecutable(homeDir = os.homedir()) {
  const overridePath = process.env.FCC_BROWSER_BIN;
  if (overridePath && fs.existsSync(overridePath)) {
    return {
      path: overridePath,
      source: 'FCC_BROWSER_BIN'
    };
  }

  const playwrightRoot = path.join(homeDir, '.cache', 'ms-playwright');
  if (fs.existsSync(playwrightRoot)) {
    const versions = fs.readdirSync(playwrightRoot)
      .filter((entry) => entry.startsWith('chromium-'))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    for (let index = versions.length - 1; index >= 0; index -= 1) {
      const candidate = path.join(playwrightRoot, versions[index], 'chrome-linux64', 'chrome');
      if (fs.existsSync(candidate)) {
        return {
          path: candidate,
          source: 'playwright-cache'
        };
      }
    }
  }

  for (const binary of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'google-chrome-for-testing']) {
    const resolved = resolveCommandPath(binary);
    if (resolved) {
      return {
        path: resolved,
        source: binary
      };
    }
  }

  return null;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function addCheck(section, name, status, value, options = {}) {
  section.checks.push({
    name,
    status,
    value,
    details: options.details || [],
    fixes: options.fixes || [],
    reportFixes: options.reportFixes !== false
  });
}

async function httpRequest(options, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({
        ok: true,
        statusCode: res.statusCode,
        body
      }));
    });

    req.on('error', (error) => resolve({
      ok: false,
      errorCode: error.code || 'UNKNOWN'
    }));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

async function probeTcpPort(port, host = '127.0.0.1', timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ open: true }));
    socket.once('timeout', () => finish({ open: false, errorCode: 'TIMEOUT' }));
    socket.once('error', (error) => finish({ open: false, errorCode: error.code || 'UNKNOWN' }));
  });
}

function inspectManifestFile(manifestPath, extensionId, expectedLauncherPath) {
  const detail = {
    manifestPath,
    exists: fs.existsSync(manifestPath),
    validJson: false,
    issues: []
  };

  if (!detail.exists) {
    return detail;
  }

  const manifest = readJsonFile(manifestPath);
  if (!manifest) {
    detail.issues.push('invalid JSON');
    return detail;
  }

  detail.validJson = true;
  detail.manifest = manifest;
  detail.matchesHostName = manifest.name === HOST_NAME;
  if (!detail.matchesHostName) {
    detail.issues.push(`unexpected host name: ${manifest.name || '(missing)'}`);
  }

  detail.allowedOrigins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [];
  detail.expectedOrigin = extensionId ? `chrome-extension://${extensionId}/` : null;
  detail.matchesOrigin = !detail.expectedOrigin || detail.allowedOrigins.includes(detail.expectedOrigin);
  if (detail.expectedOrigin && !detail.matchesOrigin) {
    detail.issues.push(`missing allowed origin ${detail.expectedOrigin}`);
  }

  detail.launcherPath = manifest.path || null;
  detail.launcherExists = !!detail.launcherPath && fs.existsSync(detail.launcherPath);
  if (!detail.launcherExists) {
    detail.issues.push(`launcher not found: ${detail.launcherPath || '(missing path)'}`);
  }

  detail.launcherMatchesExpected = !!detail.launcherPath && path.resolve(detail.launcherPath) === path.resolve(expectedLauncherPath);
  if (detail.launcherExists && !detail.launcherMatchesExpected) {
    detail.issues.push(`launcher points to ${detail.launcherPath}`);
  }

  detail.isUsable = detail.validJson && detail.matchesHostName && detail.matchesOrigin && detail.launcherExists && detail.launcherMatchesExpected;
  return detail;
}

function buildCheckSections() {
  return [
    { title: 'Dependencies', checks: [] },
    { title: 'Extension', checks: [] },
    { title: 'Native Host', checks: [] },
    { title: 'Services', checks: [] }
  ];
}

async function detectExtensionInstallation(repoRoot, options = {}) {
  const extensionDir = path.join(repoRoot, 'chromevideo');
  const homeDir = options.homeDir || os.homedir();
  const explicitProfile = options.profile ? resolveInputPath(repoRoot, options.profile) : null;
  const candidates = explicitProfile
    ? [explicitProfile]
    : getDefaultProfileCandidatesForWorkspace(repoRoot, homeDir);
  const errors = [];

  for (const candidate of candidates) {
    try {
      const detected = detectExtensionIdFromProfile(candidate, extensionDir);
      if (detected) {
        return {
          extensionId: detected.extensionId,
          preferencesPath: detected.preferencesPath,
          profilePath: path.resolve(candidate),
          checkedProfiles: candidates,
          errors
        };
      }
    } catch (error) {
      errors.push(`${path.resolve(candidate)}: ${error.message}`);
    }
  }

  return {
    extensionId: null,
    preferencesPath: null,
    profilePath: explicitProfile,
    checkedProfiles: candidates,
    errors
  };
}

async function collectEnvironmentDiagnostics(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const homeDir = options.homeDir || os.homedir();
  const sections = buildCheckSections();
  const dependencies = sections[0];
  const extension = sections[1];
  const nativeHost = sections[2];
  const services = sections[3];
  const queueDir = path.join(repoRoot, 'queue-server');
  const webConsoleDir = path.join(repoRoot, 'web-console');
  const extensionDir = path.join(repoRoot, 'chromevideo');
  const hostDir = path.join(extensionDir, 'host');
  const expectedLauncherPath = process.platform === 'win32'
    ? path.join(hostDir, 'host.bat')
    : path.join(hostDir, 'host.sh');
  const requestedProfile = resolveInputPath(repoRoot, options.profile);
  const effectiveProfile = requestedProfile || path.join(repoRoot, '.browser-profile');
  const detectedExtension = await detectExtensionInstallation(repoRoot, {
    profile: options.profile,
    homeDir
  });

  addCheck(
    dependencies,
    'Node.js version',
    Number((process.version.match(/^v(\d+)/) || [])[1] || 0) >= 16 ? 'pass' : 'fail',
    process.version,
    {
      fixes: ['Install Node.js 16 or newer, then rerun `node validate-environment.js`.']
    }
  );

  const npmVersion = runCommand('npm', ['--version']);
  addCheck(
    dependencies,
    'npm',
    npmVersion.ok ? 'pass' : 'fail',
    npmVersion.ok ? npmVersion.stdout : 'Not found',
    {
      fixes: ['Install npm so per-module dependencies can be installed and updated.']
    }
  );

  addCheck(
    dependencies,
    'Queue Server launcher dependency',
    fs.existsSync(path.join(queueDir, 'node_modules', 'nodemon', 'bin', 'nodemon.js')) ? 'pass' : 'fail',
    displayPath(repoRoot, path.join(queueDir, 'node_modules', 'nodemon', 'bin', 'nodemon.js')),
    {
      fixes: ['Run `cd queue-server && npm install` to install Queue Server dependencies.']
    }
  );

  addCheck(
    dependencies,
    'Web Console launcher dependency',
    fs.existsSync(path.join(webConsoleDir, 'node_modules', 'vite', 'bin', 'vite.js')) ? 'pass' : 'fail',
    displayPath(repoRoot, path.join(webConsoleDir, 'node_modules', 'vite', 'bin', 'vite.js')),
    {
      fixes: ['Run `cd web-console && npm install` to install Web Console dependencies.']
    }
  );

  const browserExecutable = findBrowserExecutable(homeDir);
  addCheck(
    dependencies,
    'Chromium/Chrome executable',
    browserExecutable ? 'pass' : 'fail',
    browserExecutable ? `${browserExecutable.path} (${browserExecutable.source})` : 'Not found',
    {
      fixes: ['Install Chromium/Chrome or set `FCC_BROWSER_BIN=/absolute/path/to/browser` before rerunning diagnostics.']
    }
  );

  const xvfbPath = resolveCommandPath('Xvfb');
  addCheck(
    dependencies,
    'Xvfb',
    xvfbPath ? 'pass' : 'warn',
    xvfbPath || 'Not found',
    {
      details: ['Only required for `node test-playwright-e2e.js` in headless Linux environments.'],
      fixes: ['Install `Xvfb` if you want to run the headless startup regression on this machine.'],
      reportFixes: false
    }
  );

  addCheck(
    extension,
    'Extension directory',
    fs.existsSync(extensionDir) ? 'pass' : 'fail',
    displayPath(repoRoot, extensionDir),
    {
      fixes: ['Ensure the `chromevideo/` directory exists and contains the unpacked extension files.']
    }
  );

  addCheck(
    extension,
    'Extension manifest',
    fs.existsSync(path.join(extensionDir, 'manifest.json')) ? 'pass' : 'fail',
    displayPath(repoRoot, path.join(extensionDir, 'manifest.json')),
    {
      fixes: ['Restore `chromevideo/manifest.json` before loading the extension in Chromium.']
    }
  );

  if (detectedExtension.extensionId) {
    addCheck(
      extension,
      'Extension ID',
      'pass',
      `${detectedExtension.extensionId} (from ${displayPath(repoRoot, detectedExtension.preferencesPath)})`
    );
  } else {
    addCheck(
      extension,
      'Extension ID',
      'fail',
      'Not detected',
      {
        details: [
          `Checked profiles: ${detectedExtension.checkedProfiles.map((candidate) => displayPath(repoRoot, path.resolve(candidate))).join(', ') || '(none)'}`,
          ...detectedExtension.errors
        ],
        fixes: [
          `Load \`${displayPath(repoRoot, extensionDir)}\` as an unpacked extension in Chromium, ideally with \`${displayPath(repoRoot, effectiveProfile)}\` as the browser profile, then rerun \`node validate-environment.js${requestedProfile ? ` --profile ${displayPath(repoRoot, requestedProfile)}` : ''}\`.`
        ]
      }
    );
  }

  addCheck(
    extension,
    'Profile target',
    fs.existsSync(effectiveProfile) ? 'pass' : 'warn',
    displayPath(repoRoot, effectiveProfile),
    {
      details: requestedProfile
        ? ['Using the explicitly requested profile for extension/host checks.']
        : ['Defaulting to the workspace `.browser-profile` first, then common Chromium/Chrome locations.']
    }
  );

  addCheck(
    nativeHost,
    'Native Host launcher',
    fs.existsSync(expectedLauncherPath) ? 'pass' : 'fail',
    displayPath(repoRoot, expectedLauncherPath),
    {
      fixes: [
        `Run \`node chromevideo/host/install_host.js${requestedProfile ? ` --profile ${displayPath(repoRoot, requestedProfile)}` : ' --profile .browser-profile'}${detectedExtension.extensionId ? ' --auto-detect' : ''}\` to regenerate the launcher and manifest.`
      ]
    }
  );

  addCheck(
    nativeHost,
    'Native Host backend script',
    fs.existsSync(path.join(hostDir, 'host.js')) ? 'pass' : 'fail',
    displayPath(repoRoot, path.join(hostDir, 'host.js')),
    {
      fixes: ['Restore `chromevideo/host/host.js`; the extension cannot start local services without it.']
    }
  );

  const manifestCandidates = getNativeHostManifestCandidates({
    workspaceDir: repoRoot,
    homeDir,
    platform: process.platform
  });
  const manifestDetails = manifestCandidates.map((manifestPath) => inspectManifestFile(
    manifestPath,
    detectedExtension.extensionId,
    expectedLauncherPath
  ));
  const installedManifestDetails = manifestDetails.filter((detail) => detail.exists);
  const usableManifestDetails = installedManifestDetails.filter((detail) => detail.isUsable);

  if (usableManifestDetails.length > 0) {
    addCheck(
      nativeHost,
      'Native Host manifest installation',
      'pass',
      `${usableManifestDetails.length} usable manifest(s)`,
      {
        details: usableManifestDetails.map((detail) => displayPath(repoRoot, detail.manifestPath))
      }
    );
  } else if (installedManifestDetails.length > 0) {
    addCheck(
      nativeHost,
      'Native Host manifest installation',
      'fail',
      `${installedManifestDetails.length} manifest(s) found, but none match the current extension/launcher`,
      {
        details: installedManifestDetails.map((detail) => {
          const issueText = detail.issues.length > 0 ? ` (${detail.issues.join('; ')})` : '';
          return `${displayPath(repoRoot, detail.manifestPath)}${issueText}`;
        }),
        fixes: [
          `Run \`node chromevideo/host/install_host.js --profile ${displayPath(repoRoot, effectiveProfile)}${detectedExtension.extensionId ? ' --auto-detect' : ''}\` to refresh the Native Messaging manifests for the current extension ID.`
        ]
      }
    );
  } else {
    addCheck(
      nativeHost,
      'Native Host manifest installation',
      'fail',
      'No installed manifest found',
      {
        details: [`Checked locations: ${manifestCandidates.map((target) => displayPath(repoRoot, target)).join(', ')}`],
        fixes: [
          `Run \`node chromevideo/host/install_host.js --profile ${displayPath(repoRoot, effectiveProfile)}${detectedExtension.extensionId ? ' --auto-detect' : ''}\` to install the Native Messaging manifest.`
        ]
      }
    );
  }

  const queueTarget = await discoverQueueServer({
    host: sharedConfig.queueServer.host,
    timeoutMs: 1200
  });
  if (queueTarget) {
    addCheck(
      services,
      'Queue Server',
      'pass',
      `${queueTarget.httpUrl}/health`,
      {
        details: [`service=${queueTarget.health?.service || sharedConfig.queueServer.serviceName}`, `port=${queueTarget.port}`]
      }
    );
  } else {
    const preferredPortProbe = await probeTcpPort(sharedConfig.queueServer.preferredPort, sharedConfig.queueServer.host);
    addCheck(
      services,
      'Queue Server',
      preferredPortProbe.open ? 'warn' : 'info',
      preferredPortProbe.open
        ? `Not healthy; preferred port ${sharedConfig.queueServer.preferredPort} is already occupied`
        : `Not running; preferred port ${sharedConfig.queueServer.preferredPort} is free`,
      {
        fixes: preferredPortProbe.open
          ? [`Stop the process using port ${sharedConfig.queueServer.preferredPort}, or let Queue Server start on a fallback port and confirm `/health` returns the expected service name.`]
          : []
      }
    );
  }

  const webConsoleResponse = await httpRequest({
    hostname: '127.0.0.1',
    port: WEB_CONSOLE_PORT,
    path: '/',
    method: 'HEAD'
  });
  if (webConsoleResponse.ok) {
    addCheck(
      services,
      'Web Console',
      'pass',
      `http://127.0.0.1:${WEB_CONSOLE_PORT}/`,
      {
        details: [`HTTP ${webConsoleResponse.statusCode}`]
      }
    );
  } else {
    const webConsolePortProbe = await probeTcpPort(WEB_CONSOLE_PORT);
    addCheck(
      services,
      'Web Console',
      webConsolePortProbe.open ? 'warn' : 'info',
      webConsolePortProbe.open
        ? `Port ${WEB_CONSOLE_PORT} is open but did not answer an HTTP probe`
        : `Not running; port ${WEB_CONSOLE_PORT} is free`,
      {
        fixes: webConsolePortProbe.open
          ? [`Stop or inspect the process using port ${WEB_CONSOLE_PORT} before starting \`cd web-console && npm run dev\`.`]
          : []
      }
    );
  }

  const checks = sections.flatMap((section) => section.checks);
  const failures = checks.filter((check) => check.status === 'fail');
  const warnings = checks.filter((check) => check.status === 'warn');
  const fixSteps = dedupe(
    checks
      .filter((check) => check.reportFixes !== false && (check.status === 'fail' || check.status === 'warn'))
      .flatMap((check) => check.fixes)
  );
  const nextSteps = dedupe([
    failures.length === 0 && !queueTarget ? 'Start Queue Server with `cd queue-server && npm run dev`.' : null,
    failures.length === 0 && !webConsoleResponse.ok ? 'Start Web Console with `cd web-console && npm run dev`.' : null,
    failures.length === 0 ? 'Reload the unpacked extension if Chromium was already open.' : null
  ]);

  return {
    ok: failures.length === 0,
    summary: {
      failures: failures.length,
      warnings: warnings.length
    },
    requestedProfile: requestedProfile,
    effectiveProfile,
    sections,
    fixSteps,
    nextSteps
  };
}

function formatReport(report) {
  const lines = [
    '=== Free Chat Coder Installation Diagnostics ===',
    `Workspace: ${displayPath(REPO_ROOT, REPO_ROOT)}`,
    `Profile target: ${displayPath(REPO_ROOT, report.effectiveProfile)}`,
    ''
  ];

  for (const section of report.sections) {
    lines.push(`[${section.title}]`);
    for (const check of section.checks) {
      lines.push(`${STATUS_ICON[check.status] || '-'} ${check.name}: ${check.value}`);
      for (const detail of check.details) {
        lines.push(`   ${detail}`);
      }
    }
    lines.push('');
  }

  lines.push(`Overall status: ${report.ok ? 'PASS' : 'FAIL'}`);
  lines.push(`Blocking issues: ${report.summary.failures}`);
  lines.push(`Warnings: ${report.summary.warnings}`);

  if (report.fixSteps.length > 0) {
    lines.push('');
    lines.push('Repair steps:');
    report.fixSteps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
  }

  if (report.nextSteps.length > 0) {
    lines.push('');
    lines.push('Next steps:');
    report.nextSteps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
  }

  return lines.join('\n');
}

async function validateEnvironment(options = {}) {
  return collectEnvironmentDiagnostics(options);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const report = await validateEnvironment(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(formatReport(report));
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  collectEnvironmentDiagnostics,
  formatReport,
  parseArgs,
  validateEnvironment
};
