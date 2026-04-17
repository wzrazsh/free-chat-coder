#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const {
  DEFAULT_ORIGIN,
  DEFAULT_PROFILE_PATH,
  DEFAULT_STORE_PATH,
  captureAuthState,
  resolveProfilePath,
  saveAuthState,
  summarizeCapture
} = require('../queue-server/providers/deepseek-web/auth');

const DEFAULT_LAUNCH_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 250;

function parseArgs(argv) {
  const options = {
    profile: DEFAULT_PROFILE_PATH,
    origin: DEFAULT_ORIGIN,
    storePath: DEFAULT_STORE_PATH,
    browserBin: null,
    launchBrowser: false,
    waitMs: DEFAULT_LAUNCH_WAIT_MS,
    json: false,
    noStore: false,
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

    if (arg === '--launch-browser') {
      options.launchBrowser = true;
      continue;
    }

    if (arg === '--no-store') {
      options.noStore = true;
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

    if (arg === '--browser-bin') {
      options.browserBin = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith('--browser-bin=')) {
      options.browserBin = arg.slice('--browser-bin='.length);
      continue;
    }

    if (arg === '--wait-ms') {
      options.waitMs = Number(argv[index + 1] || DEFAULT_LAUNCH_WAIT_MS);
      index += 1;
      continue;
    }

    if (arg.startsWith('--wait-ms=')) {
      options.waitMs = Number(arg.slice('--wait-ms='.length));
      continue;
    }

    if (arg === '--origin') {
      options.origin = argv[index + 1] || DEFAULT_ORIGIN;
      index += 1;
      continue;
    }

    if (arg.startsWith('--origin=')) {
      options.origin = arg.slice('--origin='.length);
      continue;
    }

    if (arg === '--store-path') {
      options.storePath = argv[index + 1] || DEFAULT_STORE_PATH;
      index += 1;
      continue;
    }

    if (arg.startsWith('--store-path=')) {
      options.storePath = arg.slice('--store-path='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.waitMs) || options.waitMs <= 0) {
    throw new Error('--wait-ms must be a positive integer');
  }

  return options;
}

function printUsage() {
  console.log('Usage: node scripts/onboard-deepseek-web.js [options]\n');
  console.log('Options:');
  console.log(`  --profile <path>     Chromium/Chrome profile to inspect (default: ${DEFAULT_PROFILE_PATH})`);
  console.log(`  --origin <url>       DeepSeek origin to inspect (default: ${DEFAULT_ORIGIN})`);
  console.log(`  --store-path <path>  Local auth snapshot path (default: ${DEFAULT_STORE_PATH})`);
  console.log('  --launch-browser     Auto-launch Chromium with remote debugging and open the DeepSeek page before capture');
  console.log('  --browser-bin <path> Override the Chromium/Chrome executable used by --launch-browser');
  console.log(`  --wait-ms <n>        Max wait for --launch-browser capture (default: ${DEFAULT_LAUNCH_WAIT_MS})`);
  console.log('  --no-store           Do not persist the captured auth state');
  console.log('  --json               Print a JSON summary instead of human-readable output');
  console.log('  --help               Show this help message');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs, message) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    const value = await fn();
    if (value) {
      return value;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(message);
}

function resolveCommandPath(binary) {
  if (!binary) {
    return null;
  }

  const result = cp.spawnSync('bash', ['-lc', `command -v ${binary}`], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });
  const resolved = (result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return result.status === 0 ? resolved || null : null;
}

function findBrowserExecutable(explicitPath) {
  if (explicitPath) {
    const resolvedPath = path.resolve(explicitPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Browser executable not found: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  const overridePath = process.env.FCC_BROWSER_BIN;
  if (overridePath && fs.existsSync(overridePath)) {
    return overridePath;
  }

  const playwrightRoot = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(playwrightRoot)) {
    const versions = fs.readdirSync(playwrightRoot)
      .filter((entry) => entry.startsWith('chromium-'))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    for (let index = versions.length - 1; index >= 0; index -= 1) {
      const candidate = path.join(playwrightRoot, versions[index], 'chrome-linux64', 'chrome');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  for (const binary of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'google-chrome-for-testing']) {
    const resolved = resolveCommandPath(binary);
    if (resolved) {
      return resolved;
    }
  }

  throw new Error('Unable to find Chromium/Chrome executable. Set FCC_BROWSER_BIN or pass --browser-bin.');
}

async function startXvfbIfNeeded() {
  if (process.env.DISPLAY) {
    return {
      display: process.env.DISPLAY,
      child: null,
      usingXvfb: false
    };
  }

  const xvfbPath = resolveCommandPath('Xvfb');
  if (!xvfbPath) {
    throw new Error('DISPLAY is not set and Xvfb is not installed. Set DISPLAY or install Xvfb before using --launch-browser.');
  }

  const displayNumber = await waitFor(async () => {
    for (let number = 110; number < 200; number += 1) {
      if (!fs.existsSync(`/tmp/.X11-unix/X${number}`)) {
        return number;
      }
    }
    return null;
  }, 3000, 'Failed to find a free X display for Xvfb');

  const display = `:${displayNumber}`;
  const child = cp.spawn(xvfbPath, [display, '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore'
  });

  await waitFor(
    async () => (fs.existsSync(`/tmp/.X11-unix/X${displayNumber}`) ? true : null),
    5000,
    `Timed out waiting for Xvfb display ${display} to be ready`
  );

  return {
    display,
    child,
    usingXvfb: true
  };
}

function stopChildProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  try {
    process.kill(child.pid, 'SIGTERM');
  } catch (error) {
    // Ignore already-exited processes.
  }
}

function stopProcessGroup(pid) {
  if (!pid) {
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
    return;
  } catch (error) {
    // Fall back to the direct pid when the process is not a group leader.
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    // Ignore already-exited processes.
  }
}

async function waitForPidExit(pid, timeoutMs = 5000) {
  await waitFor(async () => {
    try {
      process.kill(pid, 0);
      return null;
    } catch (error) {
      return true;
    }
  }, timeoutMs, `Timed out waiting for pid ${pid} to exit`);
}

function shouldLaunchBrowser(capture) {
  return !capture?.debug?.devToolsReachable || !capture?.debug?.deepseekTarget;
}

async function launchBrowserSession(options) {
  const profilePath = resolveProfilePath(options.profile);
  const browserExecutable = findBrowserExecutable(options.browserBin);
  const displaySession = await startXvfbIfNeeded();
  const activePortPath = path.join(profilePath, 'DevToolsActivePort');

  try {
    fs.unlinkSync(activePortPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const child = cp.spawn(browserExecutable, [
    `--user-data-dir=${profilePath}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    options.origin
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      DISPLAY: displaySession.display
    },
    stdio: 'ignore',
    detached: true
  });

  await waitFor(
    async () => (fs.existsSync(activePortPath) ? true : null),
    options.waitMs,
    `Timed out waiting for Chromium DevTools port in ${activePortPath}`
  );

  return {
    activePortPath,
    browserExecutable,
    browserPid: child.pid,
    display: displaySession.display,
    usingXvfb: displaySession.usingXvfb,
    xvfbChild: displaySession.child
  };
}

async function cleanupBrowserSession(session) {
  if (!session) {
    return;
  }

  stopProcessGroup(session.browserPid);
  if (session.browserPid) {
    await waitForPidExit(session.browserPid).catch(() => {
      try {
        process.kill(session.browserPid, 'SIGKILL');
      } catch (error) {
        // Ignore already-exited processes.
      }
    });
  }
  stopChildProcess(session.xvfbChild);
}

async function captureWithOptionalBrowserLaunch(options) {
  const captureOptions = {
    profilePath: options.profile,
    origin: options.origin
  };
  let capture = await captureAuthState(captureOptions);
  let launch = null;

  if (!options.launchBrowser || !shouldLaunchBrowser(capture)) {
    return {
      capture,
      launch
    };
  }

  let session = null;
  launch = {
    attempted: true,
    started: false,
    browserExecutable: null,
    display: null,
    usingXvfb: false,
    waitMs: options.waitMs
  };

  try {
    session = await launchBrowserSession(options);
    launch = {
      ...launch,
      started: true,
      browserExecutable: session.browserExecutable,
      display: session.display,
      usingXvfb: session.usingXvfb
    };

    const deadline = Date.now() + options.waitMs;
    do {
      capture = await captureAuthState(captureOptions);
      if (capture.ok) {
        break;
      }
      await sleep(500);
    } while (Date.now() < deadline);
  } catch (error) {
    launch.error = error.message || String(error);
  } finally {
    await cleanupBrowserSession(session);
  }

  return {
    capture,
    launch
  };
}

function printHumanSummary(summary, storeStatus) {
  console.log('DeepSeek Web Zero-Token Onboarding');
  console.log('');
  console.log(`Ready: ${summary.ok ? 'yes' : 'no'}`);
  console.log(`Profile: ${summary.profilePath}`);
  console.log(`Origin: ${summary.origin}`);
  console.log(`DevTools: ${summary.debug.devToolsReachable ? `reachable on ${summary.debug.devToolsPort}` : 'unavailable'}`);
  console.log(`DeepSeek page: ${summary.debug.deepseekTargetUrl || 'not found'}`);
  console.log(`User-Agent: ${summary.auth.userAgent || 'missing'}`);
  console.log(`Cookies: ${summary.auth.cookieCount} ${summary.auth.cookieHeader.present ? `(fingerprint ${summary.auth.cookieHeader.fingerprint})` : ''}`.trim());
  console.log(`Bearer: ${summary.auth.bearerToken.present ? `captured from ${summary.auth.bearerSource || 'unknown source'} (${summary.auth.bearerToken.fingerprint})` : 'missing'}`);
  if (summary.launch?.attempted) {
    if (summary.launch.started) {
      console.log(`Browser launch: ${summary.launch.browserExecutable} on ${summary.launch.display}${summary.launch.usingXvfb ? ' via Xvfb' : ''}`);
    } else {
      console.log(`Browser launch: failed (${summary.launch.error})`);
    }
  }

  if (storeStatus.skipped) {
    console.log(`Store: skipped (${storeStatus.reason})`);
  } else if (storeStatus.saved) {
    console.log(`Store: wrote ${storeStatus.storePath}`);
  }

  if (summary.issues.length > 0) {
    console.log('');
    console.log('Issues:');
    summary.issues.forEach((issue) => {
      console.log(`- ${issue}`);
    });
  }

  if (summary.recommendations.length > 0) {
    console.log('');
    console.log('Next Steps:');
    summary.recommendations.forEach((recommendation) => {
      console.log(`- ${recommendation}`);
    });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const { capture, launch } = await captureWithOptionalBrowserLaunch(options);

  let storeStatus = {
    saved: false,
    skipped: false,
    storePath: path.resolve(options.storePath)
  };

  if (options.noStore) {
    storeStatus = {
      ...storeStatus,
      skipped: true,
      reason: '--no-store'
    };
  } else if (!capture.ok) {
    storeStatus = {
      ...storeStatus,
      skipped: true,
      reason: 'capture incomplete'
    };
  } else {
    const stored = saveAuthState(capture, {
      storePath: options.storePath
    });
    storeStatus = {
      saved: true,
      skipped: false,
      storePath: stored.storePath
    };
  }

  const summary = summarizeCapture(capture, {
    storePath: options.storePath
  });
  if (launch) {
    summary.launch = launch;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ...summary,
      store: storeStatus
    }, null, 2)}\n`);
    return;
  }

  printHumanSummary(summary, storeStatus);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
