#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const http = require('http');

const { autoDetectExtensionId } = require('./chromevideo/host/install_host');
const { discoverQueueServer } = require('./shared/queue-server');

const REPO_ROOT = __dirname;
const PROFILE_DIR = path.join(REPO_ROOT, '.browser-profile');
const EXTENSION_DIR = path.join(REPO_ROOT, 'chromevideo');
const HOST_MANIFEST_PATH = path.join(PROFILE_DIR, 'NativeMessagingHosts', 'com.trae.freechatcoder.host.json');
const HOST_INSTALL_SCRIPT = path.join(REPO_ROOT, 'chromevideo', 'host', 'install_host.js');
const HOST_PID_FILE = path.join(REPO_ROOT, 'chromevideo', 'host', '.service-pids.json');
const QUEUE_NODemon_PATH = path.join(REPO_ROOT, 'queue-server', 'node_modules', 'nodemon', 'bin', 'nodemon.js');
const WEB_VITE_PATH = path.join(REPO_ROOT, 'web-console', 'node_modules', 'vite', 'bin', 'vite.js');
const WEB_CONSOLE_PORT = 5173;
const DEFAULT_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 250;

let WebSocket;
try {
  WebSocket = require(path.join(REPO_ROOT, 'queue-server', 'node_modules', 'ws'));
} catch (error) {
  process.stderr.write('[E2E] Missing queue-server dependency: queue-server/node_modules/ws\n');
  process.stderr.write('[E2E] Run `cd queue-server && npm install` before executing this regression.\n');
  process.exit(1);
}

function log(message) {
  process.stdout.write(`[E2E] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertFileExists(filePath, message) {
  if (!fs.existsSync(filePath)) {
    throw new Error(message);
  }
}

function httpRequest(options) {
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

    req.on('error', () => resolve({ ok: false, statusCode: null, body: '' }));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve({ ok: false, statusCode: null, body: '' });
    });
    req.end();
  });
}

async function waitFor(fn, timeoutMs, message) {
  const startedAt = Date.now();
  let lastValue;

  while ((Date.now() - startedAt) < timeoutMs) {
    lastValue = await fn();
    if (lastValue) {
      return lastValue;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(message + (lastValue ? ` (last value: ${JSON.stringify(lastValue)})` : ''));
}

function findBrowserExecutable() {
  if (process.env.FCC_BROWSER_BIN && fs.existsSync(process.env.FCC_BROWSER_BIN)) {
    return process.env.FCC_BROWSER_BIN;
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
    const result = cp.spawnSync('bash', ['-lc', `command -v ${binary}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    });
    const resolved = (result.stdout || '').trim();
    if (result.status === 0 && resolved) {
      return resolved;
    }
  }

  throw new Error('Unable to find Chromium/Chrome executable. Set FCC_BROWSER_BIN to a valid browser path.');
}

function assertNoExistingBrowserSession() {
  const output = cp.execFileSync('ps', ['-eo', 'pid=,args='], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });

  const matches = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.includes(`--user-data-dir=${PROFILE_DIR}`));

  if (matches.length > 0) {
    throw new Error(
      'A browser session is already using .browser-profile. Close it before running this regression:\n' +
      matches.map((line) => `  ${line}`).join('\n')
    );
  }
}

function resolveExtensionId() {
  const detected = autoDetectExtensionId(PROFILE_DIR, EXTENSION_DIR);
  if (!detected?.extensionId) {
    throw new Error(
      'Failed to detect the unpacked extension ID from .browser-profile. ' +
      'Load chromevideo/ into Chromium once, then rerun this regression.'
    );
  }

  return detected.extensionId;
}

function ensureNativeHostInstalled(extensionId) {
  assertFileExists(
    HOST_INSTALL_SCRIPT,
    `Missing Native Host installer script: ${HOST_INSTALL_SCRIPT}`
  );

  const installResult = cp.spawnSync(process.execPath, [
    HOST_INSTALL_SCRIPT,
    '--profile',
    PROFILE_DIR,
    '--auto-detect'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });

  if (installResult.status !== 0) {
    throw new Error(
      'Failed to refresh Native Messaging host installation.\n' +
      `${(installResult.stdout || '').trim()}\n${(installResult.stderr || '').trim()}`.trim()
    );
  }

  assertFileExists(
    HOST_MANIFEST_PATH,
    `Missing Native Messaging manifest after install: ${HOST_MANIFEST_PATH}`
  );

  const manifest = JSON.parse(fs.readFileSync(HOST_MANIFEST_PATH, 'utf8'));
  const expectedOrigin = `chrome-extension://${extensionId}/`;
  if (!Array.isArray(manifest.allowed_origins) || !manifest.allowed_origins.includes(expectedOrigin)) {
    throw new Error(
      `Native Messaging manifest does not allow ${expectedOrigin}. ` +
      'Run node chromevideo/host/install_host.js --profile .browser-profile --auto-detect to refresh it.'
    );
  }

  if (!manifest.path || !fs.existsSync(manifest.path)) {
    throw new Error(`Native Messaging launcher path is missing or invalid: ${manifest.path || '(empty path)'}`);
  }
}

async function discoverCurrentServices() {
  const [queueTarget, webResponse] = await Promise.all([
    discoverQueueServer({ timeoutMs: 1200 }),
    httpRequest({
      hostname: '127.0.0.1',
      port: WEB_CONSOLE_PORT,
      path: '/',
      method: 'HEAD'
    })
  ]);

  return {
    queueRunning: !!queueTarget,
    queuePort: queueTarget?.port || null,
    webRunning: !!webResponse.ok
  };
}

async function assertServicesStopped() {
  const status = await discoverCurrentServices();
  if (status.queueRunning || status.webRunning) {
    const details = [];
    if (status.queueRunning) {
      details.push(`Queue Server already running on port ${status.queuePort}`);
    }
    if (status.webRunning) {
      details.push(`Web Console already running on port ${WEB_CONSOLE_PORT}`);
    }
    throw new Error(
      'This regression requires a clean startup state. Stop the existing local services first.\n' +
      details.map((item) => `  - ${item}`).join('\n')
    );
  }
}

async function waitForServicesStopped() {
  await waitFor(async () => {
    const status = await discoverCurrentServices();
    return status.queueRunning || status.webRunning ? null : status;
  }, 10000, 'Timed out waiting for Queue Server and Web Console to stop');
}

async function startXvfb() {
  const displayNumber = await waitFor(async () => {
    for (let number = 110; number < 200; number += 1) {
      if (!fs.existsSync(`/tmp/.X11-unix/X${number}`)) {
        return number;
      }
    }
    return null;
  }, 3000, 'Failed to find a free X display for Xvfb');

  const display = `:${displayNumber}`;
  const child = cp.spawn('Xvfb', [display, '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });

  await waitFor(
    async () => (fs.existsSync(`/tmp/.X11-unix/X${displayNumber}`) ? true : null),
    5000,
    `Timed out waiting for Xvfb display ${display} to be ready`
  );

  return {
    display,
    child
  };
}

function stopChildProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  try {
    process.kill(child.pid, 'SIGTERM');
  } catch (error) {
    return;
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

function readDevToolsPort(activePortPath) {
  const content = fs.readFileSync(activePortPath, 'utf8').trim();
  const [portText] = content.split('\n');
  const port = Number(portText);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid DevToolsActivePort content: ${content}`);
  }
  return port;
}

async function fetchDevToolsTargets(port) {
  const response = await httpRequest({
    hostname: '127.0.0.1',
    port,
    path: '/json/list',
    method: 'GET'
  });

  if (!response.ok || response.statusCode !== 200) {
    return null;
  }

  return JSON.parse(response.body || '[]');
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.wsUrl);
      this.socket = socket;

      socket.on('open', resolve);
      socket.on('error', reject);
      socket.on('close', () => {
        for (const [id, pending] of this.pending.entries()) {
          pending.reject(new Error(`CDP socket closed while waiting for message ${id}`));
        }
        this.pending.clear();
      });
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (!message.id || !this.pending.has(message.id)) {
          return;
        }

        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message || 'Unknown CDP error'));
          return;
        }

        pending.resolve(message.result);
      });
    });

    await this.send('Runtime.enable');
  }

  async send(method, params = {}) {
    const id = this.nextId++;
    const payload = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(payload), (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      const text = result.exceptionDetails.text || 'Runtime.evaluate failed';
      throw new Error(text);
    }

    return result.result ? result.result.value : undefined;
  }

  async close() {
    if (!this.socket) {
      return;
    }

    await new Promise((resolve) => {
      this.socket.once('close', resolve);
      this.socket.close();
    });
  }
}

function createMessageExpression(message) {
  return `new Promise((resolve) => chrome.runtime.sendMessage(${JSON.stringify(message)}, resolve))`;
}

function createHostCommandExpression(command) {
  return `(() => new Promise((resolve) => {
    let settled = false;
    let port;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (port) {
        try {
          port.disconnect();
        } catch (error) {
          // Ignore disconnect races in the popup context.
        }
      }
      resolve(result);
    };

    try {
      port = chrome.runtime.connectNative('com.trae.freechatcoder.host');
    } catch (error) {
      finish({
        ok: false,
        error: error.message || String(error)
      });
      return;
    }

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: 'Timeout waiting for native host response'
      });
    }, 15000);

    port.onMessage.addListener((message) => {
      if (message?.type === 'error') {
        finish({
          ok: false,
          error: message.message || 'Native host returned an error',
          response: message
        });
        return;
      }

      if (message?.type === 'status') {
        finish({
          ok: true,
          response: message
        });
      }
    });

    port.onDisconnect.addListener(() => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        finish({
          ok: false,
          error: runtimeError.message
        });
      }
    });

    try {
      port.postMessage({ command: ${JSON.stringify(command)} });
    } catch (error) {
      finish({
        ok: false,
        error: error.message || String(error)
      });
    }
  }))()`;
}

async function withBrowserPopup({ browserExecutable, display, extensionId }, callback) {
  const activePortPath = path.join(PROFILE_DIR, 'DevToolsActivePort');
  const popupUrl = `chrome-extension://${extensionId}/popup.html?e2e=${Date.now()}`;

  try {
    fs.unlinkSync(activePortPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const browser = cp.spawn(browserExecutable, [
    `--user-data-dir=${PROFILE_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    `--disable-extensions-except=${EXTENSION_DIR}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    popupUrl
  ], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DISPLAY: display
    },
    stdio: 'ignore',
    detached: true
  });

  let client;

  try {
    await waitFor(
      async () => (fs.existsSync(activePortPath) ? true : null),
      10000,
      'Timed out waiting for Chromium DevTools port'
    );

    const port = readDevToolsPort(activePortPath);
    const target = await waitFor(async () => {
      const targets = await fetchDevToolsTargets(port);
      if (!targets) {
        return null;
      }

      return targets.find((item) => item.type === 'page' && item.url.startsWith(`chrome-extension://${extensionId}/popup.html`)) || null;
    }, 10000, 'Timed out waiting for popup target in DevTools');

    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    return await callback(client);
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }

    stopProcessGroup(browser.pid);
    await waitForPidExit(browser.pid).catch(() => {
      try {
        process.kill(browser.pid, 'SIGKILL');
      } catch (error) {
        // Ignore already-exited browser processes.
      }
    });
  }
}

async function waitForOffscreenStatus(client) {
  return waitFor(async () => {
    const status = await client.evaluate(createMessageExpression({ type: 'get_extension_status' }));
    if (!status) {
      return null;
    }

    if (status.wsReadyState === 1) {
      return status;
    }

    return null;
  }, DEFAULT_TIMEOUT_MS, 'Timed out waiting for offscreen WebSocket connection');
}

async function verifyQueueHealth() {
  const queueTarget = await waitFor(async () => {
    const target = await discoverQueueServer({ timeoutMs: 1200 });
    return target || null;
  }, DEFAULT_TIMEOUT_MS, 'Timed out waiting for Queue Server health endpoint');

  const response = await httpRequest({
    hostname: queueTarget.host,
    port: queueTarget.port,
    path: '/health',
    method: 'GET'
  });

  if (!response.ok || response.statusCode !== 200) {
    throw new Error(`Queue Server /health check failed on port ${queueTarget.port}`);
  }

  const payload = JSON.parse(response.body || '{}');
  if (payload.status !== 'ok') {
    throw new Error(`Queue Server returned unexpected health payload: ${response.body}`);
  }

  return {
    port: queueTarget.port,
    payload
  };
}

async function verifyWebConsole() {
  const response = await waitFor(async () => {
    const current = await httpRequest({
      hostname: '127.0.0.1',
      port: WEB_CONSOLE_PORT,
      path: '/',
      method: 'HEAD'
    });

    return current.ok ? current : null;
  }, DEFAULT_TIMEOUT_MS, 'Timed out waiting for Web Console on port 5173');

  return {
    statusCode: response.statusCode
  };
}

function assertBootstrapCoverage(status) {
  if (!status?.ok || !status.response) {
    throw new Error(`Native host status command failed: ${JSON.stringify(status)}`);
  }

  if (!status.response.queueServerRunning || !status.response.webConsoleRunning) {
    throw new Error(`Native host did not report both services as running: ${JSON.stringify(status.response)}`);
  }
}

function readHostPidFile() {
  assertFileExists(HOST_PID_FILE, `Missing Native Host pid file: ${HOST_PID_FILE}`);
  return JSON.parse(fs.readFileSync(HOST_PID_FILE, 'utf8'));
}

function assertHostStartedServices(pidFile, runStartedAt) {
  const queueRecord = pidFile.SOLOCoder_QueueServer || pidFile['SOLOCoder-QueueServer'];
  const webRecord = pidFile.SOLOCoder_WebConsole || pidFile['SOLOCoder-WebConsole'];

  for (const [name, record] of [
    ['Queue Server', queueRecord],
    ['Web Console', webRecord]
  ]) {
    if (!record?.startedAt) {
      throw new Error(`${name} is missing from ${HOST_PID_FILE}: ${JSON.stringify(pidFile)}`);
    }

    const startedAt = Date.parse(record.startedAt);
    if (!Number.isFinite(startedAt)) {
      throw new Error(`${name} has an invalid startedAt in ${HOST_PID_FILE}: ${JSON.stringify(record)}`);
    }

    if (startedAt < (runStartedAt - 2000)) {
      throw new Error(`${name} was not started by this regression run: ${JSON.stringify(record)}`);
    }
  }
}

async function stopServices(client) {
  const queueStop = await client.evaluate(createHostCommandExpression('stop_queue'));
  if (!queueStop?.ok) {
    throw new Error(`Failed to stop Queue Server after test: ${queueStop?.error || 'unknown error'}`);
  }

  const webStop = await client.evaluate(createHostCommandExpression('stop_web'));
  if (!webStop?.ok) {
    throw new Error(`Failed to stop Web Console after test: ${webStop?.error || 'unknown error'}`);
  }

  await waitForServicesStopped();
}

async function main() {
  assertFileExists(PROFILE_DIR, `Missing browser profile directory: ${PROFILE_DIR}`);
  assertFileExists(EXTENSION_DIR, `Missing extension directory: ${EXTENSION_DIR}`);
  assertFileExists(QUEUE_NODemon_PATH, 'Missing queue-server dev dependency. Run `cd queue-server && npm install` first.');
  assertFileExists(WEB_VITE_PATH, 'Missing web-console dependency. Run `cd web-console && npm install` first.');
  assertNoExistingBrowserSession();

  const browserExecutable = findBrowserExecutable();
  const extensionId = resolveExtensionId();
  ensureNativeHostInstalled(extensionId);
  await assertServicesStopped();

  log(`Browser: ${browserExecutable}`);
  log(`Extension ID: ${extensionId}`);
  log('Launching Chromium with the unpacked extension...');

  const xvfb = await startXvfb();
  const runStartedAt = Date.now();

  try {
    const summary = await withBrowserPopup({
      browserExecutable,
      display: xvfb.display,
      extensionId
    }, async (client) => {
      const runtimeId = await client.evaluate('chrome.runtime.id');
      if (runtimeId !== extensionId) {
        throw new Error(`Loaded extension ID mismatch: expected ${extensionId}, received ${runtimeId}`);
      }

      const offscreenStatus = await waitForOffscreenStatus(client);
      const queueHealth = await verifyQueueHealth();
      const webConsole = await verifyWebConsole();
      const nativeHostStatus = await client.evaluate(createHostCommandExpression('status'));
      assertBootstrapCoverage(nativeHostStatus);
      const pidFile = readHostPidFile();
      assertHostStartedServices(pidFile, runStartedAt);

      await stopServices(client);

      return {
        nativeHostStatus,
        pidFile,
        offscreenStatus,
        queueHealth,
        webConsole
      };
    });

    log(`Queue Server started on port ${summary.queueHealth.port}`);
    log(`Offscreen WebSocket connected to ${summary.offscreenStatus.wsUrl}`);
    log(`Web Console responded with HTTP ${summary.webConsole.statusCode}`);
    log('PASS: extension bootstrap, native host startup, queue health, and Web Console readiness verified.');
  } finally {
    stopChildProcess(xvfb.child);
  }
}

main().catch((error) => {
  process.stderr.write(`[E2E] ${error.message || String(error)}\n`);
  process.exit(1);
});
